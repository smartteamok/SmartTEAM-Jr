"use strict";

/**
 * Undo history handling.
 *
 * Tab.undoDelete returns false when an entry cannot be imported, and the loop in
 * undoDelete only checked for an empty stack once, before it started. So if every
 * entry failed, it popped the whole history and then called undoDelete with
 * undefined, which throws on reading .nodeName: one unimportable entry both wiped
 * the undo history and blew up.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

/**
 * Loads UndoManager with the pieces it talks to stubbed. `restoreResults` queues
 * what TabManager.undoDelete should answer, one per call.
 */
function loadUndoManager(restoreResults, options) {
  const opts = options || {};
  const queued = (restoreResults || []).slice();
  const calls = [];
  const dialogs = [];
  const context = {
    console: { log: function() {} },
    FinchBlox: opts.finchBlox !== false,
    LevelManager: { currentLevel: 3 },
    AppName: "SmartTEAM Jr",
    Language: {
      getStr: function(key) { return "text:" + key; }
    },
    DialogManager: {
      showAlertDialog: function(title, message) { dialogs.push(message); }
    },
    // The tab currently holds this many top-level stacks.
    ProgramCompiler: { MAX_HANDLERS: 4 },
    BlockMoveManager: {
      countPrograms: function() { return opts.currentPrograms || 0; }
    },
    XmlWriter: {
      newDoc: function() { return {}; },
      findSubElement: function(node, tag) {
        return node != null && node[tag] != null ? node[tag] : null;
      },
      findSubElements: function(node) {
        return node != null && node.stack != null ? node.stack : [];
      }
    },
    SaveManager: { markEdited: function() { context.edits++; } },
    TabManager: {
      activeTab: { addStartBlock: function() {}, clear: function() {} },
      undoDelete: function(node) {
        calls.push(node);
        // Undefined reaching here is the bug: the real Tab.undoDelete throws.
        if (node === undefined) {
          throw new TypeError("Cannot read properties of undefined (reading 'nodeName')");
        }
        return queued.length > 0 ? queued.shift() : true;
      }
    },
    module: { exports: {} }
  };
  context.edits = 0;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "UndoManager.js"), "utf8"),
    context, { filename: "UndoManager.js" });
  vm.runInContext("globalThis.__UM = UndoManager;", context);
  const UM = context.__UM;
  UM.undoStack = [];
  UM.undoLimit = 10;
  UM.undoButton = { enable: function() {}, disable: function() {} };
  return { UndoManager: UM, calls: calls, dialogs: dialogs, context: context };
}

test("restores the most recent deletion and keeps the rest of the history",
  function() {
    const u = loadUndoManager([true]);
    u.UndoManager.undoStack = [{ nodeName: "stack" }, { nodeName: "stack" }];
    u.UndoManager.undoDelete();
    assert.strictEqual(u.calls.length, 1, "only one entry should be consumed");
    assert.strictEqual(u.UndoManager.undoStack.length, 1, "the rest must survive");
    assert.strictEqual(u.context.edits, 1);
  });

test("an entry that cannot be imported does not hang or throw", function() {
  // Every entry fails: this is the case that popped past the end of the array.
  const u = loadUndoManager([false, false, false]);
  u.UndoManager.undoStack = [
    { nodeName: "stack" }, { nodeName: "stack" }, { nodeName: "stack" }
  ];
  assert.doesNotThrow(function() { u.UndoManager.undoDelete(); });
  assert.strictEqual(u.UndoManager.undoStack.length, 0);
  // Never called with undefined, which is what threw.
  assert.ok(u.calls.every(function(c) { return c !== undefined; }),
    "undoDelete must not be called past the end of the history");
});

test("skips a broken entry and restores the next one", function() {
  const u = loadUndoManager([false, true]);
  u.UndoManager.undoStack = [
    { nodeName: "stack", ok: true }, { nodeName: "stack", broken: true }
  ];
  u.UndoManager.undoDelete();
  assert.strictEqual(u.calls.length, 2);
  assert.strictEqual(u.UndoManager.undoStack.length, 0);
  assert.strictEqual(u.context.edits, 1);
});

test("undo on an empty history does nothing", function() {
  const u = loadUndoManager([]);
  assert.doesNotThrow(function() { u.UndoManager.undoDelete(); });
  assert.strictEqual(u.calls.length, 0);
  // No edit is marked, because nothing changed.
  assert.strictEqual(u.context.edits, 0);
});

test("a failed undo does not mark the project as edited", function() {
  // Marking an edit that did not happen triggers an autosave of unchanged content.
  const u = loadUndoManager([false]);
  u.UndoManager.undoStack = [{ nodeName: "stack" }];
  u.UndoManager.undoDelete();
  assert.strictEqual(u.context.edits, 0);
});

/* Undo was the one remaining way to exceed the board's program limit: dropping is
 * refused and the palette hats are greyed out, but restoring a deleted program
 * bypassed both and produced a canvas that only failed later, at send time. */

test("undo is refused when there is no room for another program", function() {
  const u = loadUndoManager([true], { currentPrograms: 4 });
  u.UndoManager.undoStack = [{ nodeName: "stack" }];
  u.UndoManager.undoDelete();

  assert.strictEqual(u.calls.length, 0, "nothing should be restored");
  assert.strictEqual(u.UndoManager.undoStack.length, 1,
    "the history must survive so the child can retry after deleting");
  assert.deepStrictEqual(u.dialogs, ["text:undo_program_limit"],
    "the child has to be told what happened");
});

test("undo works when there is exactly one slot left", function() {
  const u = loadUndoManager([true], { currentPrograms: 3 });
  u.UndoManager.undoStack = [{ nodeName: "stack" }];
  u.UndoManager.undoDelete();
  assert.strictEqual(u.calls.length, 1);
  assert.strictEqual(u.dialogs.length, 0);
});

test("restoring a whole tab counts all of its programs", function() {
  // The trash button stores the entire tab as one entry: three stacks need three
  // free slots, not one.
  const u = loadUndoManager([true], { currentPrograms: 2 });
  u.UndoManager.undoStack = [{
    nodeName: "tab",
    stacks: { stack: [{}, {}, {}] }
  }];
  u.UndoManager.undoDelete();
  assert.strictEqual(u.calls.length, 0, "2 + 3 exceeds the limit of 4");
  assert.deepStrictEqual(u.dialogs, ["text:undo_program_limit"]);
});

test("a comment does not count against the program limit", function() {
  const u = loadUndoManager([true], { currentPrograms: 4 });
  u.UndoManager.undoStack = [{ nodeName: "comment" }];
  u.UndoManager.undoDelete();
  assert.strictEqual(u.calls.length, 1, "a comment is not a program");
  assert.strictEqual(u.dialogs.length, 0);
});

test("outside FinchBlox the limit does not apply to undo", function() {
  const u = loadUndoManager([true], { currentPrograms: 40, finchBlox: false });
  u.UndoManager.undoStack = [{ nodeName: "stack" }];
  u.UndoManager.undoDelete();
  assert.strictEqual(u.calls.length, 1);
  assert.strictEqual(u.dialogs.length, 0);
});
