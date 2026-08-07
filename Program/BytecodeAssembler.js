"use strict";

/**
 * BytecodeAssembler turns ProgramCompiler's IR into an STX1 image (a Uint8Array)
 * ready to transfer to the micro:bit. The format is defined by
 * firmware/source/vm/stx_isa.h (the source of truth); the constants come from
 * STXConstants.js (generated). Pure and dual-load, so it can be tested under Node.
 *
 * Throws an Error with .code = "E_TOO_LARGE" if the image exceeds STX.MAX_IMAGE_SIZE.
 */
function BytecodeAssembler() {}

(function() {
  let STXRef;
  if (typeof STX !== "undefined") {
    STXRef = STX;
  } else if (typeof require !== "undefined") {
    STXRef = require("./STXConstants.js");
  }
  BytecodeAssembler.STX = STXRef;
})();

BytecodeAssembler.Sensors = (function() {
  if (typeof MicrobitSensors !== "undefined") {
    return MicrobitSensors;
  }
  if (typeof require !== "undefined") {
    return require("./MicrobitSensors.js");
  }
  return null;
})();

BytecodeAssembler.TRIGGERS = {
  start: function(S) { return S.EVT_ON_START; },
  dark: function(S) { return S.EVT_ON_DARK; },
  loud: function(S) { return S.EVT_ON_LOUD; }
};

BytecodeAssembler.CONDS = {
  dark: function(S) { return S.COND_DARK; },
  bright: function(S) { return S.COND_BRIGHT; },
  loud: function(S) { return S.COND_LOUD; },
  obstacle: function(S) { return S.COND_OBSTACLE; }
};

/**
 * @param {object} ir - {version, handlers:[{trigger, param, body}]}
 * @return {Uint8Array} imagen STX1 completa
 */
BytecodeAssembler.assemble = function(ir) {
  const S = BytecodeAssembler.STX;
  const events = [];
  const code = [];

  for (let i = 0; i < ir.handlers.length; i++) {
    const handler = ir.handlers[i];
    const triggerFn = BytecodeAssembler.TRIGGERS[handler.trigger];
    if (triggerFn == null) {
      throw BytecodeAssembler.error("E_BAD_TRIGGER", handler.trigger);
    }
    events.push({
      type: triggerFn(S),
      // The editor's threshold is a percentage; the VM compares against the
      // sensor's native value, so convert it here.
      param: BytecodeAssembler.sensorParam(
        BytecodeAssembler.Sensors.TRIGGER_SCALE[handler.trigger],
        handler.param | 0),
      offset: code.length
    });
    BytecodeAssembler.emitOps(handler.body, code, S);
    code.push(S.OP_HALT);
  }

  const eventTableSize = events.length * S.EVENT_ENTRY_SIZE;
  const imageSize = S.HEADER_SIZE + eventTableSize + code.length;
  if (imageSize > S.MAX_IMAGE_SIZE) {
    throw BytecodeAssembler.error("E_TOO_LARGE", imageSize);
  }

  const image = new Uint8Array(imageSize);
  image[0] = S.MAGIC_0;
  image[1] = S.MAGIC_1;
  image[2] = S.MAGIC_2;
  image[3] = S.MAGIC_3;
  image[4] = S.BC_VERSION;
  image[5] = events.length;
  image[6] = code.length & 0xFF;
  image[7] = (code.length >> 8) & 0xFF;
  // the crc32 goes in [8..11], last

  let pos = S.HEADER_SIZE;
  for (let i = 0; i < events.length; i++) {
    image[pos] = events[i].type;
    image[pos + 1] = events[i].param & 0xFF;
    image[pos + 2] = events[i].offset & 0xFF;
    image[pos + 3] = (events[i].offset >> 8) & 0xFF;
    pos += S.EVENT_ENTRY_SIZE;
  }
  for (let i = 0; i < code.length; i++) {
    image[pos + i] = code[i];
  }

  const crc = BytecodeAssembler.crc32(image.subarray(S.HEADER_SIZE));
  image[8] = crc & 0xFF;
  image[9] = (crc >>> 8) & 0xFF;
  image[10] = (crc >>> 16) & 0xFF;
  image[11] = (crc >>> 24) & 0xFF;
  return image;
};

/** Emits the IR's list of Ops as code bytes. */
BytecodeAssembler.emitOps = function(body, code, S) {
  for (let i = 0; i < body.length; i++) {
    const op = body[i];
    switch (op.op) {
      case "tone":
        // TONE is non-blocking in the VM; the editor's block is blocking
        code.push(S.OP_TONE,
          BytecodeAssembler.u8(op.note, "E_BAD_VALUE", "note"));
        BytecodeAssembler.pushU16(code, op.ms);
        code.push(S.OP_WAIT_MS);
        BytecodeAssembler.pushU16(code, op.ms);
        break;
      case "ledMatrix": {
        code.push(S.OP_LED_PATTERN);
        const packed = BytecodeAssembler.packLedPattern(op.pattern);
        code.push(packed[0], packed[1], packed[2], packed[3]);
        break;
      }
      case "ledClear":
        code.push(S.OP_LED_CLEAR);
        break;
      case "rgb":
        // the IR carries 0-100 (the editor's range); the VM expects 0-255
        code.push(S.OP_RGB_SET,
          BytecodeAssembler.scale100(op.r),
          BytecodeAssembler.scale100(op.g),
          BytecodeAssembler.scale100(op.b));
        break;
      case "wait":
        code.push(S.OP_WAIT_MS);
        BytecodeAssembler.pushU16(code, op.ms);
        break;
      case "mark":
        if (op.index < 0 || op.index > 0xFF) {
          throw BytecodeAssembler.error("E_BAD_MARK", String(op.index));
        }
        code.push(S.OP_MARK, op.index & 0xFF);
        break;
      case "waitUntil": {
        const condFn = BytecodeAssembler.CONDS[op.cond];
        if (condFn == null) {
          throw BytecodeAssembler.error("E_BAD_COND", op.cond);
        }
        code.push(S.OP_WAIT_UNTIL, condFn(S),
          BytecodeAssembler.u8(
            BytecodeAssembler.sensorParam(
              BytecodeAssembler.Sensors.CONDITION_SCALE[op.cond], op.param),
            "E_BAD_VALUE", "param"));
        break;
      }
      case "repeat":
        if (op.count === 0) {
          code.push(S.OP_LOOP_FOREVER);
        } else {
          // count 0 is OP_LOOP_FOREVER above, so a wrap to 0 here would turn a
          // bounded repeat into an endless one.
          code.push(S.OP_LOOP_N,
            BytecodeAssembler.u8(op.count, "E_BAD_VALUE", "repeat"));
        }
        BytecodeAssembler.emitOps(op.body, code, S);
        code.push(S.OP_LOOP_END);
        break;
      case "motors":
        // FinchBlox blocks always produce ticksL === ticksR
        code.push(S.OP_MOTORS_TICKS,
          BytecodeAssembler.i8(op.speedL),
          BytecodeAssembler.i8(op.speedR));
        BytecodeAssembler.pushU16(code, op.ticksL);
        break;
      case "motorsFree":
        code.push(S.OP_MOTORS,
          BytecodeAssembler.i8(op.speedL),
          BytecodeAssembler.i8(op.speedR));
        break;
      case "motorsStop":
        code.push(S.OP_MOTORS_STOP);
        break;
      default:
        throw BytecodeAssembler.error("E_BAD_OP", op.op);
    }
  }
};

BytecodeAssembler.pushU16 = function(code, value) {
  const v = Math.max(0, Math.min(0xFFFF, Math.round(value)));
  code.push(v & 0xFF, (v >> 8) & 0xFF);
};

BytecodeAssembler.i8 = function(value) {
  const v = Math.max(-128, Math.min(127, Math.round(value)));
  return v & 0xFF;
};

/**
 * Converts a sensor threshold to the board's native scale, or leaves it alone
 * when that condition is not percentage-based ("obstacle" travels in centimetres).
 * @param {string|undefined} scale - "light" | "sound" | undefined
 * @param {number} value - threshold as the editor expresses it
 */
BytecodeAssembler.sensorParam = function(scale, value) {
  if (scale == null) {
    return value;
  }
  return BytecodeAssembler.Sensors.fromPercent(scale, value);
};

BytecodeAssembler.scale100 = function(value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return Math.round(v * 255 / 100);
};

/**
 * Packs a 25-char "0"/"1" pattern (row-major) into 4 bytes.
 * Bit k of byte j = the LED at index j*8+k (LSB-first).
 */
BytecodeAssembler.packLedPattern = function(str25) {
  const bytes = [0, 0, 0, 0];
  for (let i = 0; i < 25 && i < str25.length; i++) {
    if (str25.charAt(i) === "1") {
      bytes[i >> 3] |= (1 << (i & 7));
    }
  }
  return bytes;
};

/** CRC-32/IEEE (the same one zlib uses), over a Uint8Array. */
BytecodeAssembler.crc32 = function(bytes) {
  let table = BytecodeAssembler.crcTable;
  if (table == null) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    BytecodeAssembler.crcTable = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

/**
 * Asserts a value fits in one byte, instead of letting `& 0xFF` wrap it.
 * A silent wrap changes what the program does on the board: `repeat 256` would
 * emit OP_LOOP_N with a count byte of 0, and the VM reads count 0 as "loop
 * forever" (stx_vm.c). Not reachable from the FinchBlox UI today — its sliders
 * are bounded — but the assembler is the boundary where the ISA contract has to
 * hold, whatever feeds it.
 */
BytecodeAssembler.u8 = function(value, code, what) {
  const v = Math.round(value);
  if (!(v >= 0 && v <= 0xFF)) {
    throw BytecodeAssembler.error(code, what + " " + String(value));
  }
  return v;
};

BytecodeAssembler.error = function(code, detail) {
  const err = new Error(code + (detail != null ? ": " + detail : ""));
  err.code = code;
  return err;
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = BytecodeAssembler;
}
