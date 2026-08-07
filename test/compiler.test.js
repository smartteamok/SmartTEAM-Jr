"use strict";

const test = require("node:test");
const assert = require("node:assert");
const ProgramCompiler = require("../Program/ProgramCompiler.js");
const F = require("./fixtures.js");

function compileOk(firstBlocks, options) {
  const result = ProgramCompiler.compile(firstBlocks, options);
  assert.deepStrictEqual(result.errors, [], "esperaba compilar sin errores");
  return result;
}

test("an empty program -> E_EMPTY", function() {
  const result = ProgramCompiler.compile([]);
  assert.strictEqual(result.ir, null);
  assert.deepStrictEqual(result.errors, [{ code: "E_EMPTY" }]);
});

test("a stack with only a hat and no body -> E_EMPTY", function() {
  const result = ProgramCompiler.compile([F.flagHat()]);
  assert.deepStrictEqual(result.errors, [{ code: "E_EMPTY" }]);
});

test("a single note -> tone", function() {
  const result = compileOk([F.sound(60, 5)]);
  assert.strictEqual(result.ir.handlers.length, 1);
  assert.strictEqual(result.ir.handlers[0].trigger, "start");
  assert.deepStrictEqual(result.ir.handlers[0].body, [
    { op: "tone", note: 60, ms: 500 }
  ]);
});

test("every note class shares one encoder", function() {
  const names = ["B_FBC", "B_FBD", "B_FBE", "B_FBF", "B_FBG", "B_FBA",
    "B_FBSoundL2", "B_FBSoundL3"];
  for (const name of names) {
    const result = compileOk([F.sound(64, 2, name)]);
    assert.deepStrictEqual(result.ir.handlers[0].body,
      [{ op: "tone", note: 64, ms: 200 }], name);
  }
});

test("led array -> ledMatrix + wait + ledClear", function() {
  const result = compileOk([F.ledArray(F.SMILEY, 10)]);
  assert.deepStrictEqual(result.ir.handlers[0].body, [
    { op: "ledMatrix", pattern: F.SMILEY },
    { op: "wait", ms: 1000 },
    { op: "ledClear" }
  ]);
});

test("beak -> rgb on + wait + rgb off (target 0)", function() {
  const result = compileOk([F.beak(100, 0, 50, 10)]);
  assert.deepStrictEqual(result.ir.handlers[0].body, [
    { op: "rgb", target: 0, r: 100, g: 0, b: 50 },
    { op: "wait", ms: 1000 },
    { op: "rgb", target: 0, r: 0, g: 0, b: 0 }
  ]);
});

test("tail usa target 1", function() {
  const result = compileOk([F.tail(0, 100, 0, 5)]);
  assert.strictEqual(result.ir.handlers[0].body[0].target, 1);
});

test("wait -> tenths of a second into ms", function() {
  const result = compileOk([F.wait(30)]);
  assert.deepStrictEqual(result.ir.handlers[0].body, [{ op: "wait", ms: 3000 }]);
});

test("a repeat nested inside a forever", function() {
  const inner = F.repeat(3, F.sound(60, 1));
  const outer = F.forever(inner);
  const result = compileOk([outer]);
  assert.deepStrictEqual(result.ir.handlers[0].body, [{
    op: "repeat",
    count: 0,
    body: [{
      op: "repeat",
      count: 3,
      body: [{ op: "tone", note: 60, ms: 100 }]
    }]
  }]);
});

test("a repeat with an empty body does not blow up", function() {
  const result = compileOk([F.chain(F.repeat(5, null), F.wait(10))]);
  assert.deepStrictEqual(result.ir.handlers[0].body, [
    { op: "repeat", count: 5, body: [] },
    { op: "wait", ms: 1000 }
  ]);
});

test("blocks after a forever -> a warning, and they are dropped", function() {
  const first = F.chain(F.forever(F.wait(1)), F.sound(60, 1));
  const result = compileOk([first]);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].code, "W_UNREACHABLE_AFTER_FOREVER");
  assert.strictEqual(result.ir.handlers[0].body.length, 1);
  assert.strictEqual(result.ir.handlers[0].body[0].op, "repeat");
});

test("the flag hat -> a start trigger, with the hat out of the body", function() {
  const result = compileOk([F.chain(F.flagHat(), F.sound(60, 5))]);
  assert.strictEqual(result.ir.handlers[0].trigger, "start");
  assert.strictEqual(result.ir.handlers[0].body.length, 1);
  assert.strictEqual(result.ir.handlers[0].body[0].op, "tone");
});

test("the dark/clap hats -> triggers carrying live mode's thresholds", function() {
  const result = compileOk([
    F.chain(F.darkHat(), F.wait(1)),
    F.chain(F.clapHat(), F.wait(1))
  ]);
  assert.strictEqual(result.ir.handlers[0].trigger, "dark");
  assert.strictEqual(result.ir.handlers[0].param, 5);
  assert.strictEqual(result.ir.handlers[1].trigger, "loud");
  assert.strictEqual(result.ir.handlers[1].param, 50);
});

test("two stacks -> two handlers, in order", function() {
  const result = compileOk([
    F.chain(F.flagHat(), F.sound(60, 1)),
    F.wait(20)
  ]);
  assert.strictEqual(result.ir.handlers.length, 2);
  assert.strictEqual(result.ir.handlers[0].body[0].op, "tone");
  assert.strictEqual(result.ir.handlers[1].body[0].op, "wait");
});

test("an unknown block -> E_UNSUPPORTED_BLOCK naming it", function() {
  const bogus = { blockTypeName: "B_Bogus", nextBlock: null };
  const result = ProgramCompiler.compile([bogus]);
  assert.strictEqual(result.ir, null);
  assert.deepStrictEqual(result.errors[0],
    { code: "E_UNSUPPORTED_BLOCK", blockType: "B_Bogus" });
});

test("an unknown block inside a repeat fails too", function() {
  const bogus = { blockTypeName: "B_Bogus", nextBlock: null };
  const result = ProgramCompiler.compile([F.repeat(2, bogus)]);
  assert.strictEqual(result.ir, null);
  assert.strictEqual(result.errors[0].code, "E_UNSUPPORTED_BLOCK");
});

test("motors rejected on the on-board slice", function() {
  const fwd = F.motion("B_FBForward", 50, 50, 497, 497);
  const result = ProgramCompiler.compile([fwd]);
  assert.strictEqual(result.ir, null);
  assert.strictEqual(result.errors[0].code, "E_UNSUPPORTED_ON_BOARD");
});

test("motors accepted with allowMotors", function() {
  const fwd = F.motion("B_FBForwardL2", 50, 50, 994, 994);
  const result = compileOk([fwd], { allowMotors: true });
  assert.deepStrictEqual(result.ir.handlers[0].body, [{
    op: "motors", speedL: 50, speedR: 50, ticksL: 994, ticksR: 994
  }]);
});

test("more start stacks than the limit -> E_TOO_MANY_STACKS", function() {
  const stacks = [];
  for (let i = 0; i < 5; i++) {
    stacks.push(F.wait(1));
  }
  const result = ProgramCompiler.compile(stacks);
  assert.strictEqual(result.errors[0].code, "E_TOO_MANY_STACKS");
});

/* ---- Block markers (options.emitMarkers) ---- */

test("emitMarkers: a flat sequence interleaves marks and returns the map", function() {
  const s1 = F.sound(60, 1);
  const s2 = F.sound(62, 1);
  s1.nextBlock = s2;
  const result = compileOk([s1], { emitMarkers: true });
  assert.deepStrictEqual(result.ir.handlers[0].body, [
    { op: "mark", index: 0 },
    { op: "tone", note: 60, ms: 100 },
    { op: "mark", index: 1 },
    { op: "tone", note: 62, ms: 100 }
  ]);
  assert.strictEqual(result.markerMap.length, 2);
  assert.strictEqual(result.markerMap[0], s1);
  assert.strictEqual(result.markerMap[1], s2);
});

test("emitMarkers: blocks inside a repeat get marked too", function() {
  const inner = F.sound(60, 1);
  const rep = F.repeat(3, inner);
  const result = compileOk([rep], { emitMarkers: true });
  const body = result.ir.handlers[0].body;
  // mark(repeat), repeat{ mark(inner), tone }
  assert.deepStrictEqual(body[0], { op: "mark", index: 0 });
  assert.strictEqual(body[1].op, "repeat");
  assert.deepStrictEqual(body[1].body[0], { op: "mark", index: 1 });
  assert.strictEqual(result.markerMap[0], rep);
  assert.strictEqual(result.markerMap[1], inner);
});

test("without emitMarkers there are no marks and no map", function() {
  const result = compileOk([F.sound(60, 1)]);
  assert.strictEqual(result.markerMap, null);
  assert.strictEqual(result.ir.handlers[0].body[0].op, "tone");
});

test("emitMarkers: the map spans several stacks, in order", function() {
  const a = F.wait(1);
  const b = F.sound(60, 1);
  const result = compileOk([a, b], { emitMarkers: true });
  assert.strictEqual(result.markerMap.length, 2);
  assert.strictEqual(result.markerMap[0], a);
  assert.strictEqual(result.markerMap[1], b);
  assert.deepStrictEqual(result.ir.handlers[1].body[0], { op: "mark", index: 1 });
});
