"use strict";

/**
 * BytecodeAssembler convierte la IR de ProgramCompiler en una imagen STX1
 * (Uint8Array) lista para transferir a la micro:bit. El formato lo define
 * firmware/source/vm/stx_isa.h (fuente de verdad); las constantes vienen de
 * STXConstants.js (generado). Puro y dual-load para testear en Node.
 *
 * Lanza Error con .code = "E_TOO_LARGE" si la imagen supera STX.MAX_IMAGE_SIZE.
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
      param: handler.param | 0,
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
  // crc32 va en [8..11] al final

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

/** Emite la lista de Ops de la IR como bytes de código */
BytecodeAssembler.emitOps = function(body, code, S) {
  for (let i = 0; i < body.length; i++) {
    const op = body[i];
    switch (op.op) {
      case "tone":
        // TONE es no bloqueante en la VM; el bloque del editor es bloqueante
        code.push(S.OP_TONE, op.note & 0xFF);
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
        // IR trae 0-100 (rango del editor); la VM espera 0-255
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
        code.push(S.OP_WAIT_UNTIL, condFn(S), op.param & 0xFF);
        break;
      }
      case "repeat":
        if (op.count === 0) {
          code.push(S.OP_LOOP_FOREVER);
        } else {
          code.push(S.OP_LOOP_N, op.count & 0xFF);
        }
        BytecodeAssembler.emitOps(op.body, code, S);
        code.push(S.OP_LOOP_END);
        break;
      case "motors":
        // Los bloques FinchBlox siempre generan ticksL === ticksR
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

BytecodeAssembler.scale100 = function(value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return Math.round(v * 255 / 100);
};

/**
 * Empaqueta un patrón de 25 chars "0"/"1" (row-major) en 4 bytes.
 * Bit k del byte j = LED de índice j*8+k (LSB-first).
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

/** CRC-32/IEEE (el mismo que zlib), sobre un Uint8Array */
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

BytecodeAssembler.error = function(code, detail) {
  const err = new Error(code + (detail != null ? ": " + detail : ""));
  err.code = code;
  return err;
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = BytecodeAssembler;
}
