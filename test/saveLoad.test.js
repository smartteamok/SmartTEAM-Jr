"use strict";

/**
 * Opening a saved program.
 *
 * A damaged file used to open as a blank canvas with no explanation: DOMParser does
 * not throw on malformed XML (it returns a document rooted at <parsererror>), and
 * loadData substituted an empty project whenever the <project> tag was missing. The
 * upstream code even carried a TODO about it. For a child that is indistinguishable
 * from the app having lost their work.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

/**
 * Loads XmlWriter and SaveManager with a minimal DOMParser and the UI stubbed.
 * The parser is Node's own XML handling via a tiny hand-rolled check — enough to
 * tell valid from malformed for these cases, and it mimics the browser's habit of
 * returning a parsererror document rather than throwing.
 */
function loadSaveManager() {
  const imported = [];
  const dialogs = [];

  function fakeParse(xmlString) {
    // Deliberately crude: balanced-tag check only. What matters is that malformed
    // input yields a parsererror document, exactly like the browser.
    const tags = [];
    const re = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>/g;
    let m;
    let malformed = false;
    while ((m = re.exec(xmlString)) !== null) {
      if (m[3] === "/") { continue; }
      if (m[1] === "/") {
        if (tags.pop() !== m[2]) { malformed = true; break; }
      } else {
        tags.push(m[2]);
      }
    }
    if (malformed || tags.length > 0) {
      return makeDoc(["parsererror"]);
    }
    const names = [];
    const re2 = /<([A-Za-z_][\w.-]*)/g;
    while ((m = re2.exec(xmlString)) !== null) { names.push(m[1]); }
    return makeDoc(names);
  }

  function makeDoc(tagNames) {
    return {
      tagNames: tagNames,
      getElementsByTagName: function(name) {
        return tagNames.filter(function(t) { return t === name; })
          .map(function(t) { return { nodeName: t }; });
      }
    };
  }

  const context = {
    console: { log: function() {} },
    FinchBlox: true,
    AppName: "SmartTEAM Jr",
    Language: { getStr: function(key) { return "text:" + key; } },
    DialogManager: {
      showAlertDialog: function(title, message) { dialogs.push(message); }
    },
    DOMParser: function() {
      this.parseFromString = function(str) { return fakeParse(str); };
    },
    DebugOptions: {
      safeFunc: function(fn) { return fn; },
      shouldLogErrors: function() { return false; }
    },
    CodeManager: {
      importXml: function(node) { imported.push(node); },
      createXml: function() { return {}; },
      markOpen: function() {},
      markLoading: function() {},
      cancelLoading: function() {},
      updateModified: function() {}
    },
    TitleBar: { setText: function() {}, fileBn: { update: function() {} } },
    LevelManager: { currentLevel: 3, totalLevels: 3, setLevel: function() {} },
    OpenDialog: { closeDialog: function() {} },
    GuiElements: { unblockInteraction: function() {}, alert: function() {} },
    HtmlServer: { sendRequestWithCallback: function() {} },
    // SaveManager()'s constructor builds an autosave timer.
    Timer: function() {
      this.start = function() {};
      this.stop = function() {};
    },
    HttpRequestBuilder: function() { this.toString = function() { return ""; }; },
    module: { exports: {} }
  };
  context.window = context;
  vm.createContext(context);
  ["XmlWriter.js", "SaveManager.js"].forEach(function(file) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context,
      { filename: file });
  });
  // setConstants is where emptyProgData and the autosave interval come from; the
  // constructor alone does not define them.
  vm.runInContext(
    "globalThis.__SM = SaveManager; globalThis.__XW = XmlWriter;" +
    "SaveManager(); SaveManager.setConstants();", context);
  return {
    SaveManager: context.__SM,
    XmlWriter: context.__XW,
    imported: imported,
    dialogs: dialogs
  };
}

test("openDoc returns null for malformed XML instead of a parsererror document",
  function() {
    const s = loadSaveManager();
    assert.strictEqual(s.XmlWriter.openDoc("<project><tabs></project>"), null);
    assert.notStrictEqual(s.XmlWriter.openDoc("<project><tabs></tabs></project>"), null);
  });

test("a valid project is imported", function() {
  const s = loadSaveManager();
  s.SaveManager.loadData("<project><tabs></tabs></project>");
  assert.strictEqual(s.imported.length, 1);
  assert.strictEqual(s.dialogs.length, 0, "a good file must not warn");
});

test("a damaged file says so instead of opening blank in silence", function() {
  const s = loadSaveManager();
  // Unbalanced tags: the browser would hand back a parsererror document.
  s.SaveManager.loadData("<project><tabs></project>");
  assert.deepStrictEqual(s.dialogs, ["text:file_corrupt"],
    "the child has to be told the file is damaged");
});

test("valid XML with no project tag also counts as damaged", function() {
  const s = loadSaveManager();
  s.SaveManager.loadData("<somethingelse></somethingelse>");
  assert.deepStrictEqual(s.dialogs, ["text:file_corrupt"]);
});

test("an empty file is not an error", function() {
  // A new project legitimately has no data.
  const s = loadSaveManager();
  s.SaveManager.loadData("");
  assert.strictEqual(s.dialogs.length, 0);
  assert.strictEqual(s.imported.length, 1, "the empty project should still load");
});

test("the fallback does not warn twice and does not recurse", function() {
  const s = loadSaveManager();
  s.SaveManager.loadData("<project><tabs></project>");
  // One dialog only: the empty fallback must not report itself as damaged too.
  assert.strictEqual(s.dialogs.length, 1);
  // And the empty project did get loaded, so the canvas is usable.
  assert.strictEqual(s.imported.length, 1);
});

test("a malformed empty-project constant cannot loop forever", function() {
  // Guards the recursion: loadData calls itself with emptyProgData, so a broken
  // constant would otherwise recurse until the stack blows.
  const s = loadSaveManager();
  s.SaveManager.emptyProgData = "<project><tabs></project>";
  assert.doesNotThrow(function() {
    s.SaveManager.loadData("<project><tabs></project>");
  });
});
