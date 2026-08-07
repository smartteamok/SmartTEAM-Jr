"use strict";

/**
 * Palette feedback for the program limit.
 *
 * The limit is enforced when a stack is dropped, but enforcement is not feedback:
 * the extra hat could be picked up and simply vanished on release, which for a
 * pre-reader reads as the app losing their block. The hats are greyed out and made
 * undraggable instead, so the ceiling is visible before they try.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const ProgramCompiler = require("../Program/ProgramCompiler.js");
const STX = require("../Program/STXConstants.js");

const LIMIT = STX.MAX_CONTEXTS;

/** A palette holding one hat block and one command block, plus a stubbed tab. */
function loadPalette(options) {
  const opts = options || {};
  const context = {
    console: { log: function() {} },
    FinchBlox: opts.finchBlox !== false,
    ProgramCompiler: ProgramCompiler,
    TabManager: { activeTab: { stackList: [] } },
    Overlay: { closeOverlays: function() {} },
    module: { exports: {} }
  };
  context.window = context;
  vm.createContext(context);
  ["BlockMoveManager.js", "UIParts/BlockPalette/BlockPalette.js"].forEach(
    function(file) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context,
        { filename: file });
    });
  vm.runInContext(
    "globalThis.__BP = BlockPalette; globalThis.__BMM = BlockMoveManager;", context);

  // Minimal stand-ins for DisplayStack: only what updateProgramLimit touches.
  const makeStack = function(hasHat) {
    return {
      firstBlock: { hasHat: hasHat },
      dimmed: false,
      setDimmed: function(value) { this.dimmed = value; }
    };
  };
  const hat = makeStack(true);
  const command = makeStack(false);
  context.__BP.categories = [{ displayStacks: [hat, command] }];

  return {
    BlockPalette: context.__BP,
    hat: hat,
    command: command,
    /** Puts `count` ordinary top-level stacks in the active tab. */
    setStacks: function(count) {
      const list = [];
      for (let i = 0; i < count; i++) {
        list.push({ isDisplayStack: false });
      }
      context.TabManager.activeTab = { stackList: list };
    }
  };
}

test("below the limit the hats stay draggable", function() {
  const p = loadPalette();
  p.setStacks(LIMIT - 1);
  p.BlockPalette.updateProgramLimit();
  assert.strictEqual(p.hat.dimmed, false);
});

test("at the limit the hats are greyed out", function() {
  const p = loadPalette();
  p.setStacks(LIMIT);
  p.BlockPalette.updateProgramLimit();
  assert.strictEqual(p.hat.dimmed, true);
});

test("command blocks stay available at the limit", function() {
  // A child must be able to keep building inside the programs they already have.
  const p = loadPalette();
  p.setStacks(LIMIT);
  p.BlockPalette.updateProgramLimit();
  assert.strictEqual(p.command.dimmed, false);
});

test("deleting a program restores the hats", function() {
  const p = loadPalette();
  p.setStacks(LIMIT);
  p.BlockPalette.updateProgramLimit();
  assert.strictEqual(p.hat.dimmed, true);

  p.setStacks(LIMIT - 1);
  p.BlockPalette.updateProgramLimit();
  assert.strictEqual(p.hat.dimmed, false);
});

test("outside FinchBlox nothing is greyed", function() {
  const p = loadPalette({ finchBlox: false });
  p.setStacks(LIMIT + 5);
  p.BlockPalette.updateProgramLimit();
  assert.strictEqual(p.hat.dimmed, false);
});

test("survives being called before the palette is built", function() {
  // addStack/removeStack fire during startup and while loading a file, when there
  // are no categories yet.
  const p = loadPalette();
  p.BlockPalette.categories = null;
  assert.doesNotThrow(function() { p.BlockPalette.updateProgramLimit(); });
});
