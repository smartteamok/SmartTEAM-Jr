"use strict";

const test = require("node:test");
const assert = require("node:assert");
const BytecodeAssembler = require("../Program/BytecodeAssembler.js");
const ProgramCompiler = require("../Program/ProgramCompiler.js");
const STX = require("../Program/STXConstants.js");
const MicrobitSensors = require("../Program/MicrobitSensors.js");
const F = require("./fixtures.js");

function ir(handlers) {
  return { version: 1, handlers: handlers };
}

function startHandler(body) {
  return { trigger: "start", param: 0, body: body };
}

test("crc32 against the known vector '123456789' -> 0xCBF43926", function() {
  const bytes = new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
  assert.strictEqual(BytecodeAssembler.crc32(bytes), 0xCBF43926);
});

test("packLedPattern with the smiley face", function() {
  // "0000001010000001000101110": bits 6, 8, 15, 19, 21, 22, 23
  assert.deepStrictEqual(
    BytecodeAssembler.packLedPattern(F.SMILEY),
    [0x40, 0x81, 0xE8, 0x00]
  );
});

test("packLedPattern all off and all on", function() {
  assert.deepStrictEqual(
    BytecodeAssembler.packLedPattern("0000000000000000000000000"),
    [0x00, 0x00, 0x00, 0x00]
  );
  assert.deepStrictEqual(
    BytecodeAssembler.packLedPattern("1111111111111111111111111"),
    [0xFF, 0xFF, 0xFF, 0x01]
  );
});

test("header golden bytes: wait 1000ms", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([{ op: "wait", ms: 1000 }])]));
  // magic "STX1"
  assert.deepStrictEqual(Array.from(image.subarray(0, 4)), [0x53, 0x54, 0x58, 0x31]);
  assert.strictEqual(image[4], STX.BC_VERSION);
  assert.strictEqual(image[5], 1); // eventCount
  // code: WAIT_MS(1000) + HALT = 3 + 1 = 4 bytes
  assert.strictEqual(image[6], 4);
  assert.strictEqual(image[7], 0);
  // event table at offset 12: ON_START, param 0, entryOffset 0
  assert.deepStrictEqual(Array.from(image.subarray(12, 16)), [STX.EVT_ON_START, 0, 0, 0]);
  // code: WAIT_MS 0xE8 0x03 (1000 LE), HALT
  assert.deepStrictEqual(
    Array.from(image.subarray(16)),
    [STX.OP_WAIT_MS, 0xE8, 0x03, STX.OP_HALT]
  );
  assert.strictEqual(image.length, STX.HEADER_SIZE + 4 + 4);
});

test("the header crc32 covers the event table plus the code", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([{ op: "ledClear" }])]));
  const stored = image[8] | (image[9] << 8) | (image[10] << 16) | (image[11] << 24);
  const computed = BytecodeAssembler.crc32(image.subarray(STX.HEADER_SIZE));
  assert.strictEqual(stored >>> 0, computed);
});

test("tone expands into TONE + WAIT_MS", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([{ op: "tone", note: 60, ms: 500 }])]));
  const code = Array.from(image.subarray(STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE));
  assert.deepStrictEqual(code, [
    STX.OP_TONE, 60, 0xF4, 0x01,      // TONE 60, 500ms LE
    STX.OP_WAIT_MS, 0xF4, 0x01,       // WAIT 500ms
    STX.OP_HALT
  ]);
});

test("rgb scales 0-100 into 0-255", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([
    { op: "rgb", target: 0, r: 100, g: 0, b: 50 }
  ])]));
  const code = Array.from(image.subarray(STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE));
  assert.deepStrictEqual(code, [STX.OP_RGB_SET, 255, 0, 128, STX.OP_HALT]);
});

test("balanced nested loops: repeat 3 { forever { ledClear } }", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([{
    op: "repeat", count: 3, body: [{
      op: "repeat", count: 0, body: [{ op: "ledClear" }]
    }]
  }])]));
  const code = Array.from(image.subarray(STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE));
  assert.deepStrictEqual(code, [
    STX.OP_LOOP_N, 3,
    STX.OP_LOOP_FOREVER,
    STX.OP_LED_CLEAR,
    STX.OP_LOOP_END,
    STX.OP_LOOP_END,
    STX.OP_HALT
  ]);
});

test("multi-handler: event table offsets", function() {
  const image = BytecodeAssembler.assemble(ir([
    startHandler([{ op: "ledClear" }]),                       // 2 bytes (LED_CLEAR+HALT)
    { trigger: "dark", param: 5, body: [{ op: "wait", ms: 100 }] } // at offset 2
  ]));
  assert.strictEqual(image[5], 2); // eventCount
  const t = STX.HEADER_SIZE;
  assert.deepStrictEqual(Array.from(image.subarray(t, t + 4)), [STX.EVT_ON_START, 0, 0, 0]);
  // param 5 = "5% light" on the editor's scale, and it travels converted to the
  // micro:bit's native scale (readLightLevel gives 0-255), i.e. 13. See
  // Program/MicrobitSensors.js: without the conversion the threshold meant 5/255 ≈ 2%.
  assert.deepStrictEqual(Array.from(image.subarray(t + 4, t + 8)),
    [STX.EVT_ON_DARK, MicrobitSensors.fromPercent("light", 5), 2, 0]);
  assert.strictEqual(MicrobitSensors.fromPercent("light", 5), 13);
});

test("motors: MOTORS_TICKS with a negative speed as i8", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([
    { op: "motors", speedL: -50, speedR: 50, ticksL: 497, ticksR: 497 }
  ])]));
  const code = Array.from(image.subarray(STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE));
  assert.deepStrictEqual(code, [
    STX.OP_MOTORS_TICKS, 0xCE, 50, 0xF1, 0x01,  // -50 = 0xCE; 497 = 0x01F1 LE
    STX.OP_HALT
  ]);
});

test("waitUntil dark/obstacle map onto STX conditions", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([
    { op: "waitUntil", cond: "dark", param: 5 },
    { op: "waitUntil", cond: "obstacle", param: 20 }
  ])]));
  const code = Array.from(image.subarray(STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE));
  assert.deepStrictEqual(code, [
    // dark is a percentage and gets converted to the light sensor's native scale...
    STX.OP_WAIT_UNTIL, STX.COND_DARK, MicrobitSensors.fromPercent("light", 5),
    // ...but obstacle is centimetres and must pass through untouched.
    STX.OP_WAIT_UNTIL, STX.COND_OBSTACLE, 20,
    STX.OP_HALT
  ]);
});

test("a program over 2 KB -> E_TOO_LARGE", function() {
  const body = [];
  for (let i = 0; i < 800; i++) {
    body.push({ op: "wait", ms: 100 }); // 3 bytes each = 2400 > 2048
  }
  assert.throws(function() {
    BytecodeAssembler.assemble(ir([startHandler(body)]));
  }, function(err) {
    return err.code === "E_TOO_LARGE";
  });
});

test("full pipeline: compile the fixtures and assemble", function() {
  const result = ProgramCompiler.compile([
    F.chain(F.flagHat(), F.sound(60, 5), F.ledArray(F.SMILEY, 10),
      F.repeat(3, F.beak(100, 0, 0, 5)))
  ]);
  assert.deepStrictEqual(result.errors, []);
  const image = BytecodeAssembler.assemble(result.ir);
  assert.strictEqual(image[0], 0x53);
  assert.ok(image.length > STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE);
  assert.ok(image.length <= STX.MAX_IMAGE_SIZE);
  // ends with LOOP_END + HALT
  assert.strictEqual(image[image.length - 2], STX.OP_LOOP_END);
  assert.strictEqual(image[image.length - 1], STX.OP_HALT);
});

test("mark emits OP_MARK with its index", function() {
  const image = BytecodeAssembler.assemble(ir([startHandler([
    { op: "mark", index: 3 },
    { op: "ledClear" }
  ])]));
  const code = Array.from(image.subarray(STX.HEADER_SIZE + STX.EVENT_ENTRY_SIZE));
  assert.deepStrictEqual(code, [STX.OP_MARK, 3, STX.OP_LED_CLEAR, STX.OP_HALT]);
});

test("mark with an out-of-range index -> E_BAD_MARK", function() {
  assert.throws(function() {
    BytecodeAssembler.assemble(ir([startHandler([{ op: "mark", index: 256 }])]));
  }, function(e) { return e.code === "E_BAD_MARK"; });
});
