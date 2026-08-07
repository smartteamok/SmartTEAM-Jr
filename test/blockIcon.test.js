"use strict";

/**
 * BlockIcon layout offsets.
 *
 * addObstacle only set icon2xOffset on one of its two branches, and the
 * constructor did not initialise it. The forward arrow is wider than the obstacle
 * bar, so the block took the other branch, the offset stayed undefined, and
 * move() computed x + undefined = NaN. The browser drops a transform containing
 * NaN outright, so the arrow rendered at the group origin — the
 * forward-until-obstacle block drew wrong.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

/**
 * Loads BlockIcon with the drawing layer stubbed out. The icons record the
 * coordinates they were moved to, which is what the assertions look at.
 */
function loadBlockIcon() {
  const moves = [];
  const context = {
    console: { log: function() {} },
    DebugOptions: {
      validateNumbers: function() {},
      validateNonNull: function() {},
      assert: function() {}
    },
    TouchReceiver: { addListenersChild: function() {} },
    GuiElements: {
      create: { group: function() { return {}; }, path: function() { return {}; } },
      draw: { rect: function() { return { moved: null }; } },
      move: {
        element: function(el, x, y) { el.moved = { x: x, y: y }; },
        group: function() {},
        text: function() {}
      }
    },
    Language: { isRTL: false },
    BlockPart: function() {},
    module: { exports: {} }
  };
  // Stand-in for VectorIcon: same width maths, records moves instead of drawing.
  context.VectorIcon = function(x, y, pathId, color, height) {
    this.pathId = pathId;
    this.height = height;
    this.width = context.VectorIcon.computeWidth(pathId, height);
    this.moved = null;
    moves.push(this);
  };
  context.VectorIcon.computeWidth = function(pathId, height) {
    return (height / pathId.height) * pathId.width;
  };
  context.VectorIcon.prototype.move = function(x, y) {
    this.moved = { x: x, y: y };
  };
  context.VectorIcon.prototype.setRotation = function() {};
  context.VectorIcon.prototype.addSecondPath = function() {};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "BlockParts/BlockIcon.js"), "utf8"),
    context, { filename: "BlockIcon.js" });
  vm.runInContext("globalThis.__BlockIcon = BlockIcon;", context);
  return { BlockIcon: context.__BlockIcon, moves: moves };
}

/** The real forward arrow, so the branch taken is the one the app takes. */
function forwardPath() {
  const src = fs.readFileSync(path.join(ROOT, "SVGIcons/VectorPaths.js"), "utf8");
  const width = Number(/VP\.stForward\.width\s*=\s*([\d.]+)/.exec(src)[1]);
  const height = Number(/VP\.stForward\.height\s*=\s*([\d.]+)/.exec(src)[1]);
  return { width: width, height: height, path: "M0 0" };
}

/** Fresh each time: addObstacle appends the bar to the parent's SVG group. */
function makeParent() {
  return { group: { appendChild: function() {} } };
}

test("the offsets are numbers on a plain icon", function() {
  const { BlockIcon } = loadBlockIcon();
  const icon = new BlockIcon(makeParent(), forwardPath(), "#fff", "forward", 25);
  assert.ok(isFinite(icon.icon2xOffset));
  assert.ok(isFinite(icon.icon2yOffset));
});

test("addObstacle keeps the icon position finite when the icon is the wider one",
  function() {
    const { BlockIcon } = loadBlockIcon();
    const forward = forwardPath();
    const icon = new BlockIcon(makeParent(), forward, "#fff", "obstacle", 25);

    // The branch that was broken: arrow (38.4) wider than the 30-wide bar.
    assert.ok(icon.width > 30,
      "the forward arrow must be wider than the bar for this to be the right branch");
    icon.addObstacle("#123456");
    assert.ok(isFinite(icon.icon2xOffset), "icon2xOffset must be a number");

    icon.move(100, 50);
    assert.ok(isFinite(icon.icon.moved.x),
      "the icon x ended up " + icon.icon.moved.x);
    assert.ok(isFinite(icon.icon.moved.y));
    assert.ok(isFinite(icon.obstacle.moved.x), "the bar x must be a number");
  });

test("addObstacle still centres the icon when the bar is the wider one",
  function() {
    const { BlockIcon } = loadBlockIcon();
    // A narrow icon, so w (30) > width and the other branch runs.
    const narrow = { width: 10, height: 10, path: "M0 0" };
    const icon = new BlockIcon(makeParent(), narrow, "#fff", "obstacle", 20);
    assert.ok(icon.width < 30);
    icon.addObstacle("#123456");
    assert.strictEqual(icon.width, 30, "the icon area grows to the bar's width");
    assert.ok(icon.icon2xOffset > 0, "a narrower icon gets centred");
    icon.move(0, 0);
    assert.ok(isFinite(icon.icon.moved.x));
  });

test("the icon sits below the bar", function() {
  const { BlockIcon } = loadBlockIcon();
  const icon = new BlockIcon(makeParent(), forwardPath(), "#fff", "obstacle", 25);
  const heightBefore = icon.height;
  icon.addObstacle("#123456");
  assert.ok(icon.height > heightBefore, "the block grows to fit the bar");
  icon.move(0, 0);
  // The bar is drawn at the top, the arrow shifted down by its height plus margin.
  assert.strictEqual(icon.obstacle.moved.y, 0);
  assert.ok(icon.icon.moved.y > 0, "the arrow must end up under the bar");
});
