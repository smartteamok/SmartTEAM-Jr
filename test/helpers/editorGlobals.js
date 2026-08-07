"use strict";

/**
 * Loads editor files that are plain scripts (no module.exports) into a stubbed
 * global environment, so the parts that are pure logic can be tested under Node.
 *
 * BlockMoveManager is the case at hand: most of it drives SVG dragging, but the
 * program-count limit is arithmetic over the active tab's stack list and is
 * worth pinning down.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const ProgramCompiler = require("../../Program/ProgramCompiler.js");

/**
 * @param {object} [stubs] - extra globals to expose to the loaded file.
 * @return {{BlockMoveManager: object, setStacks: function, context: object}}
 */
function loadBlockMoveManager(stubs) {
  const context = Object.assign({
    console: { log: function() {}, warn: function() {}, error: function() {} },
    FinchBlox: true,
    ProgramCompiler: ProgramCompiler,
    TabManager: { activeTab: null },
    Overlay: { closeOverlays: function() {} },
    module: { exports: {} }
  }, stubs || {});
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "BlockMoveManager.js"), "utf8"),
    context, { filename: "BlockMoveManager.js" });

  return {
    BlockMoveManager: context.BlockMoveManager,
    context: context,
    /**
     * Replaces the active tab's stack list with `count` ordinary stacks, plus any
     * extra stubs given (e.g. the stack being dragged, or palette DisplayStacks).
     */
    setStacks: function(count, extras) {
      const list = [];
      for (let i = 0; i < count; i++) {
        list.push({ isDisplayStack: false });
      }
      (extras || []).forEach(function(s) { list.push(s); });
      context.TabManager.activeTab = { stackList: list };
    },
    setNoTab: function() { context.TabManager.activeTab = null; }
  };
}

module.exports = { loadBlockMoveManager: loadBlockMoveManager };
