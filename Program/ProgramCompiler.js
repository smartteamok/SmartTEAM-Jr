"use strict";

/**
 * ProgramCompiler turns the live FinchBlox block tree into a JSON intermediate
 * representation (IR) that is independent of the bytecode.
 * It is pure: it touches no GuiElements/TabManager/DeviceFinch, so it can be tested
 * under Node with duck-typed fixtures. Collecting the editor's stacks
 * (TabManager.activeTab.stackList) is ProgramModeManager's job.
 *
 * IR = { version: 1, handlers: [Handler] }
 * Handler = { trigger: "start"|"dark"|"loud", param: number, body: [Op] }
 * Op:
 *   {op:"tone", note, ms}                — blocking (the assembler emits TONE+WAIT)
 *   {op:"ledMatrix", pattern}            — a 25-char "0"/"1" string, row-major
 *   {op:"ledClear"}
 *   {op:"rgb", target, r, g, b}          — target 0=beak 1=tail; values 0-100
 *   {op:"wait", ms}
 *   {op:"motors", speedL, speedR, ticksL, ticksR}   — kit v2
 *   {op:"motorsFree", speedL, speedR}               — kit v2
 *   {op:"motorsStop"}                               — kit v2
 *   {op:"waitUntil", cond, param}        — cond: "dark"|"loud"|"obstacle"
 *   {op:"repeat", count, body:[Op]}      — count 0 = forever
 *   {op:"mark", index}                   — the running block (options.emitMarkers)
 *
 * With options.emitMarkers the result also carries markerMap: an index→Block array
 * (Block references live only in the app; they are NOT part of the IR, which
 * stays pure and serialisable).
 */
function ProgramCompiler() {}

/* Dual-load, same as BytecodeAssembler: STX is a global in the browser (script
 * tag) but has to be required under Node, where the tests run. */
ProgramCompiler.STX = (function() {
  if (typeof STX !== "undefined") {
    return STX;
  }
  if (typeof require !== "undefined") {
    return require("./STXConstants.js");
  }
  return null;
})();

/** Thresholds identical to live mode (BlockDefs_control.js:558-589). */
ProgramCompiler.DARK_THRESHOLD = 5;
ProgramCompiler.LOUD_THRESHOLD = 50;
/** Obstacle threshold in cm (BlockDefs_fbMotion.js, B_FBForwardUntilObstacle). */
ProgramCompiler.OBSTACLE_THRESHOLD_CM = 20;
/* Handler limit imposed by the VM. It is STX.MAX_CONTEXTS, not STX.MAX_EVENTS:
 * the image format holds up to MAX_EVENTS (8) entries, but stx_vm_start only
 * assigns a context to the first MAX_CONTEXTS (4) of them and drops the rest
 * with no fault or warning (firmware/source/vm/stx_vm.c). Compiling up to
 * MAX_EVENTS produced programs that transferred and persisted fine while their
 * 5th..8th stacks silently never ran. Derived from the generated constants so
 * this tracks the firmware automatically if the VM gains contexts — do not
 * hardcode. */
ProgramCompiler.MAX_HANDLERS = ProgramCompiler.STX.MAX_CONTEXTS;
ProgramCompiler.MAX_START_HANDLERS = ProgramCompiler.STX.MAX_CONTEXTS;

/** Maximum markers per program (OP_MARK carries a u8 index). */
ProgramCompiler.MAX_MARKERS = 256;

/* Marker state for the compilation in progress (the compiler is synchronous);
 * null = no markers. */
ProgramCompiler._markerMap = null;

/**
 * Entry point.
 * @param {Array} firstBlocks - the first Block of each top-level stack, in order
 * @param {object} [options] - {allowMotors: boolean, emitMarkers: boolean}
 * @return {{ir: object|null, markerMap: Array|null, errors: Array, warnings: Array}}
 */
ProgramCompiler.compile = function(firstBlocks, options) {
  if (options == null) {
    options = {};
  }
  const errors = [];
  const warnings = [];
  const handlers = [];
  ProgramCompiler._markerMap = options.emitMarkers ? [] : null;

  for (let i = 0; i < firstBlocks.length; i++) {
    const firstBlock = firstBlocks[i];
    if (firstBlock == null) {
      continue;
    }
    const handler = ProgramCompiler.compileStack(firstBlock, errors, warnings);
    if (handler != null && handler.body.length > 0) {
      handlers.push(handler);
    }
  }

  ProgramCompiler.validate(handlers, options, errors, warnings);

  const markerMap = ProgramCompiler._markerMap;
  ProgramCompiler._markerMap = null;
  if (markerMap != null && markerMap.length > ProgramCompiler.MAX_MARKERS) {
    errors.push({ code: "E_TOO_MANY_BLOCKS", count: markerMap.length });
  }

  if (errors.length > 0) {
    return { ir: null, markerMap: null, errors: errors, warnings: warnings };
  }
  return {
    ir: { version: 1, handlers: handlers },
    markerMap: markerMap,
    errors: errors,
    warnings: warnings
  };
};

/**
 * Compiles a whole stack into a Handler. The hat, if any, sets the trigger; a stack
 * with no hat is a plain "start" handler (levels 1-2).
 */
ProgramCompiler.compileStack = function(firstBlock, errors, warnings) {
  let trigger = "start";
  let param = 0;
  let bodyStart = firstBlock;

  const hat = ProgramCompiler.hats[firstBlock.blockTypeName];
  if (hat != null) {
    trigger = hat.trigger;
    param = hat.param;
    bodyStart = firstBlock.nextBlock;
  } else if (firstBlock.isStartBlock) {
    // Unknown hat (a new BirdBlox block, say): report it rather than guess
    errors.push(ProgramCompiler.unsupportedError(firstBlock.blockTypeName));
    return null;
  }

  const body = ProgramCompiler.compileSequence(bodyStart, errors, warnings);
  return { trigger: trigger, param: param, body: body };
};

/**
 * Walks the nextBlock chain and concatenates each block's IR.
 * @param {object|null} block - the first Block of the sequence
 * @return {Array} a list of Ops
 */
ProgramCompiler.compileSequence = function(block, errors, warnings) {
  const ops = [];
  while (block != null) {
    const encoder = ProgramCompiler.encoders[block.blockTypeName];
    if (encoder == null) {
      errors.push(ProgramCompiler.unsupportedError(block.blockTypeName));
      return ops;
    }
    if (ProgramCompiler._markerMap != null) {
      ops.push({ op: "mark", index: ProgramCompiler._markerMap.length });
      ProgramCompiler._markerMap.push(block);
    }
    const blockOps = encoder(block, errors, warnings);
    for (let i = 0; i < blockOps.length; i++) {
      ops.push(blockOps[i]);
    }
    if (ProgramCompiler.isForever(blockOps) && block.nextBlock != null) {
      warnings.push({
        code: "W_UNREACHABLE_AFTER_FOREVER",
        blockType: block.blockTypeName
      });
      return ops;
    }
    block = block.nextBlock;
  }
  return ops;
};

ProgramCompiler.isForever = function(ops) {
  return ops.length === 1 && ops[0].op === "repeat" && ops[0].count === 0;
};

ProgramCompiler.unsupportedError = function(blockTypeName) {
  return { code: "E_UNSUPPORTED_BLOCK", blockType: blockTypeName };
};

/** Whole-program checks, run after compiling. */
ProgramCompiler.validate = function(handlers, options, errors, warnings) {
  let totalOps = 0;
  let startCount = 0;
  for (let i = 0; i < handlers.length; i++) {
    totalOps += ProgramCompiler.countOps(handlers[i].body);
    if (handlers[i].trigger === "start") {
      startCount++;
    }
  }
  if (handlers.length === 0 || totalOps === 0) {
    errors.push({ code: "E_EMPTY" });
    return;
  }
  if (handlers.length > ProgramCompiler.MAX_HANDLERS) {
    errors.push({ code: "E_TOO_MANY_STACKS", count: handlers.length });
  }
  if (startCount > ProgramCompiler.MAX_START_HANDLERS) {
    errors.push({ code: "E_TOO_MANY_STACKS", count: startCount });
  }
  if (!options.allowMotors) {
    const motorOps = { motors: true, motorsFree: true, motorsStop: true };
    for (let i = 0; i < handlers.length; i++) {
      if (ProgramCompiler.usesOps(handlers[i].body, motorOps)) {
        errors.push({ code: "E_UNSUPPORTED_ON_BOARD", trigger: handlers[i].trigger });
      }
    }
  }
};

ProgramCompiler.countOps = function(body) {
  let n = 0;
  for (let i = 0; i < body.length; i++) {
    n++;
    if (body[i].op === "repeat") {
      n += ProgramCompiler.countOps(body[i].body);
    }
  }
  return n;
};

ProgramCompiler.usesOps = function(body, opNames) {
  for (let i = 0; i < body.length; i++) {
    if (opNames[body[i].op]) {
      return true;
    }
    if (body[i].op === "repeat" && ProgramCompiler.usesOps(body[i].body, opNames)) {
      return true;
    }
  }
  return false;
};

/* ---------------------------------------------------------------------------
 * Hat table: blockTypeName -> handler trigger.
 * Thresholds identical to live mode's.
 */
ProgramCompiler.hats = {
  B_WhenFlagTapped: { trigger: "start", param: 0 },
  B_StartWhenDark: { trigger: "dark", param: ProgramCompiler.DARK_THRESHOLD },
  B_StartWhenClap: { trigger: "loud", param: ProgramCompiler.LOUD_THRESHOLD }
};

/* ---------------------------------------------------------------------------
 * Encoder table: blockTypeName -> function(block, errors, warnings) -> [Op].
 * Built programmatically: one shared encoder registered under N names. The fields
 * read are the ones each block caches through updateValues()
 * (ver BlockDefs_fbSound.js:18, BlockDefs_fbColor.js:18-23,
 * BlockDefs_fbMotion.js:92-177, BlockDefs_control.js:69/176).
 */
ProgramCompiler.encoders = {};

(function() {
  const enc = ProgramCompiler.encoders;

  function register(names, fn) {
    for (let i = 0; i < names.length; i++) {
      enc[names[i]] = fn;
    }
  }

  // Sound: midi note + beats (one beat = 0.1 s, same as live mode)
  register(["B_FBC", "B_FBD", "B_FBE", "B_FBF", "B_FBG", "B_FBA",
    "B_FBSoundL2", "B_FBSoundL3"], function(block) {
    return [{ op: "tone", note: block.midiNote, ms: block.beats * 100 }];
  });

  // LED array: pattern + duration (in tenths of a second) + clear
  register(["B_FBLedArrayL2", "B_FBLedArrayL3"], function(block) {
    return [
      { op: "ledMatrix", pattern: block.ledStatusString },
      { op: "wait", ms: block.duration * 100 },
      { op: "ledClear" }
    ];
  });

  // Beak/Tail: an RGB colour (0-100) + duration + off
  register(["B_FBBeakRed", "B_FBBeakGreen", "B_FBBeakBlue", "B_FBBeakL2", "B_FBBeakL3",
    "B_FBTailRed", "B_FBTailGreen", "B_FBTailBlue", "B_FBTailL2", "B_FBTailL3"],
    function(block) {
      const target = block.isBeak ? 0 : 1;
      return [
        { op: "rgb", target: target, r: block.red, g: block.green, b: block.blue },
        { op: "wait", ms: block.duration * 100 },
        { op: "rgb", target: target, r: 0, g: 0, b: 0 }
      ];
    });

  // Wait: the slider is in tenths of a second
  register(["B_Wait"], function(block) {
    return [{ op: "wait", ms: block.timeSelection * 100 }];
  });

  // Repeat: the body lives in blockSlot1
  register(["B_Repeat"], function(block, errors, warnings) {
    const child = block.blockSlot1 != null ? block.blockSlot1.child : null;
    const body = ProgramCompiler.compileSequence(child, errors, warnings);
    return [{ op: "repeat", count: block.countSelection, body: body }];
  });

  // Forever: a repeat with count 0
  register(["B_Forever"], function(block, errors, warnings) {
    const child = block.blockSlot1 != null ? block.blockSlot1.child : null;
    const body = ProgramCompiler.compileSequence(child, errors, warnings);
    return [{ op: "repeat", count: 0, body: body }];
  });

  // Motion: ticks/speeds already come computed by updateValues()
  register(["B_FBForward", "B_FBBackward", "B_FBRight", "B_FBLeft",
    "B_FBForwardL2", "B_FBBackwardL2", "B_FBRightL2", "B_FBLeftL2",
    "B_FBForwardL3", "B_FBBackwardL3", "B_FBRightL3", "B_FBLeftL3"],
    function(block) {
      return [{
        op: "motors",
        speedL: block.leftSpeed,
        speedR: block.rightSpeed,
        ticksL: block.leftTicks,
        ticksR: block.rightTicks
      }];
    });

  // Drive until a condition: motor primitives + waitUntil + stop
  register(["B_FBForwardUntilDark"], function(block) {
    return [
      { op: "motorsFree", speedL: 50, speedR: 50 },
      { op: "waitUntil", cond: "dark", param: ProgramCompiler.DARK_THRESHOLD },
      { op: "motorsStop" }
    ];
  });
  register(["B_FBForwardUntilObstacle"], function(block) {
    return [
      { op: "motorsFree", speedL: 50, speedR: 50 },
      { op: "waitUntil", cond: "obstacle", param: ProgramCompiler.OBSTACLE_THRESHOLD_CM },
      { op: "motorsStop" }
    ];
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ProgramCompiler;
}
