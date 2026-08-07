"use strict";

/**
 * The concurrent-program limit, which has to be the same number at all three
 * levels: the firmware ISA (STX_MAX_CONTEXTS), the compiler (MAX_HANDLERS) and
 * the editor's drag limit.
 *
 * When the compiler allowed more handlers than the VM has contexts, a program
 * with the surplus stacks compiled, transferred and persisted, and those handlers
 * never ran: no fault, no warning. These tests read the limit from the constants
 * instead of hardcoding it, so they still hold once the firmware raises it.
 */

const test = require("node:test");
const assert = require("node:assert");
const ProgramCompiler = require("../Program/ProgramCompiler.js");
const STX = require("../Program/STXConstants.js");
const { loadBlockMoveManager } = require("./helpers/editorGlobals.js");

const LIMIT = STX.MAX_CONTEXTS;

test("the compiler's limit is STX.MAX_CONTEXTS, not MAX_EVENTS", function() {
  // The image holds MAX_EVENTS entries, but stx_vm_start only assigns a context
  // to the first MAX_CONTEXTS of them and silently drops the rest.
  assert.strictEqual(ProgramCompiler.MAX_HANDLERS, LIMIT);
  assert.strictEqual(ProgramCompiler.MAX_START_HANDLERS, LIMIT);
  assert.ok(STX.MAX_CONTEXTS <= STX.MAX_EVENTS);
});

function handlers(count, trigger) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ trigger: trigger, param: 0, body: [{ op: "ledClear" }] });
  }
  return out;
}

function validationCodes(list) {
  const errors = [];
  ProgramCompiler.validate(list, { allowMotors: true }, errors, []);
  return errors.map(function(e) { return e.code; });
}

test("the maximum number of handlers validates cleanly", function() {
  assert.deepStrictEqual(validationCodes(handlers(LIMIT, "dark")), []);
  assert.deepStrictEqual(validationCodes(handlers(LIMIT, "start")), []);
});

test("one more yields E_TOO_MANY_STACKS", function() {
  assert.ok(validationCodes(handlers(LIMIT + 1, "dark"))
    .includes("E_TOO_MANY_STACKS"));
});

test("the UI blocks the stack that would exceed the limit", function() {
  const editor = loadBlockMoveManager();
  const dragged = { isDisplayStack: false };

  editor.setStacks(LIMIT - 1, [dragged]);
  assert.strictEqual(
    editor.BlockMoveManager.wouldExceedProgramLimit(dragged), false,
    "with LIMIT-1 in the tab, the dragged one is the last allowed");

  editor.setStacks(LIMIT, [dragged]);
  assert.strictEqual(
    editor.BlockMoveManager.wouldExceedProgramLimit(dragged), true);
});

test("the dragged stack does not count itself", function() {
  const editor = loadBlockMoveManager();
  const dragged = { isDisplayStack: false };
  // The stack is already registered with the tab while it flies, so counting it
  // twice would trip the limit one early.
  editor.setStacks(LIMIT, [dragged]);
  assert.strictEqual(editor.BlockMoveManager.countPrograms(dragged), LIMIT);
});

test("palette DisplayStacks do not count as programs", function() {
  const editor = loadBlockMoveManager();
  editor.setStacks(0, [{ isDisplayStack: true }, { isDisplayStack: true }]);
  assert.strictEqual(editor.BlockMoveManager.countPrograms(null), 0);
});

test("no active tab does not blow up", function() {
  const editor = loadBlockMoveManager();
  editor.setNoTab();
  assert.strictEqual(editor.BlockMoveManager.countPrograms(null), 0);
});

test("outside FinchBlox the limit does not apply", function() {
  const editor = loadBlockMoveManager({ FinchBlox: false });
  const dragged = { isDisplayStack: false };
  editor.setStacks(LIMIT + 10, [dragged]);
  assert.strictEqual(
    editor.BlockMoveManager.wouldExceedProgramLimit(dragged), false);
});
