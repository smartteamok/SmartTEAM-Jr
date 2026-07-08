"use strict";

/**
 * ProgramCompiler compila el árbol vivo de bloques FinchBlox a una
 * representación intermedia (IR) JSON, independiente del bytecode.
 * Es puro: no toca GuiElements/TabManager/DeviceFinch, así que puede
 * testearse en Node con fixtures duck-typed. Quien junta los stacks del
 * editor (TabManager.activeTab.stackList) es ProgramModeManager.
 *
 * IR = { version: 1, handlers: [Handler] }
 * Handler = { trigger: "start"|"dark"|"loud", param: number, body: [Op] }
 * Op:
 *   {op:"tone", note, ms}                — bloqueante (el assembler emite TONE+WAIT)
 *   {op:"ledMatrix", pattern}            — string de 25 chars "0"/"1", row-major
 *   {op:"ledClear"}
 *   {op:"rgb", target, r, g, b}          — target 0=beak 1=tail; valores 0-100
 *   {op:"wait", ms}
 *   {op:"motors", speedL, speedR, ticksL, ticksR}   — kit v2
 *   {op:"motorsFree", speedL, speedR}               — kit v2
 *   {op:"motorsStop"}                               — kit v2
 *   {op:"waitUntil", cond, param}        — cond: "dark"|"loud"|"obstacle"
 *   {op:"repeat", count, body:[Op]}      — count 0 = forever
 */
function ProgramCompiler() {}

/** Umbrales idénticos al modo live (BlockDefs_control.js:558-589) */
ProgramCompiler.DARK_THRESHOLD = 5;
ProgramCompiler.LOUD_THRESHOLD = 50;
/** Umbral de obstáculo en cm (BlockDefs_fbMotion.js, B_FBForwardUntilObstacle) */
ProgramCompiler.OBSTACLE_THRESHOLD_CM = 20;
/** Límites que impone la VM (ver firmware/source/vm/stx_isa.h) */
ProgramCompiler.MAX_HANDLERS = 8;
ProgramCompiler.MAX_START_HANDLERS = 4;

/**
 * Punto de entrada.
 * @param {Array} firstBlocks - primer Block de cada stack top-level, en orden
 * @param {object} [options] - {allowMotors: boolean} (default false: slice on-board)
 * @return {{ir: object|null, errors: Array, warnings: Array}}
 */
ProgramCompiler.compile = function(firstBlocks, options) {
  if (options == null) {
    options = {};
  }
  const errors = [];
  const warnings = [];
  const handlers = [];

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

  if (errors.length > 0) {
    return { ir: null, errors: errors, warnings: warnings };
  }
  return {
    ir: { version: 1, handlers: handlers },
    errors: errors,
    warnings: warnings
  };
};

/**
 * Compila un stack completo a un Handler. El hat (si hay) define el trigger;
 * un stack sin hat es un handler "start" directo (niveles 1-2).
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
    // Hat desconocido (ej. bloque nuevo de BirdBlox): error explícito
    errors.push(ProgramCompiler.unsupportedError(firstBlock.blockTypeName));
    return null;
  }

  const body = ProgramCompiler.compileSequence(bodyStart, errors, warnings);
  return { trigger: trigger, param: param, body: body };
};

/**
 * Sigue la cadena nextBlock y concatena la IR de cada bloque.
 * @param {object|null} block - primer Block de la secuencia
 * @return {Array} lista de Ops
 */
ProgramCompiler.compileSequence = function(block, errors, warnings) {
  const ops = [];
  while (block != null) {
    const encoder = ProgramCompiler.encoders[block.blockTypeName];
    if (encoder == null) {
      errors.push(ProgramCompiler.unsupportedError(block.blockTypeName));
      return ops;
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

/** Validaciones globales post-compilación */
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
 * Tabla de hats: blockTypeName -> trigger de handler.
 * Umbrales idénticos a los del modo live.
 */
ProgramCompiler.hats = {
  B_WhenFlagTapped: { trigger: "start", param: 0 },
  B_StartWhenDark: { trigger: "dark", param: ProgramCompiler.DARK_THRESHOLD },
  B_StartWhenClap: { trigger: "loud", param: ProgramCompiler.LOUD_THRESHOLD }
};

/* ---------------------------------------------------------------------------
 * Tabla de encoders: blockTypeName -> function(block, errors, warnings) -> [Op].
 * Se construye programáticamente: un encoder compartido registrado bajo N
 * nombres. Los campos leídos son los que cada bloque cachea vía updateValues()
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

  // Sound: nota midi + beats (cada beat = 0.1 s, igual que el modo live)
  register(["B_FBC", "B_FBD", "B_FBE", "B_FBF", "B_FBG", "B_FBA",
    "B_FBSoundL2", "B_FBSoundL3"], function(block) {
    return [{ op: "tone", note: block.midiNote, ms: block.beats * 100 }];
  });

  // LED array: patrón + duración (duration en décimas de segundo) + apagar
  register(["B_FBLedArrayL2", "B_FBLedArrayL3"], function(block) {
    return [
      { op: "ledMatrix", pattern: block.ledStatusString },
      { op: "wait", ms: block.duration * 100 },
      { op: "ledClear" }
    ];
  });

  // Beak/Tail: color RGB (0-100) + duración + apagar
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

  // Wait: slider en décimas de segundo
  register(["B_Wait"], function(block) {
    return [{ op: "wait", ms: block.timeSelection * 100 }];
  });

  // Repeat: cuerpo en blockSlot1
  register(["B_Repeat"], function(block, errors, warnings) {
    const child = block.blockSlot1 != null ? block.blockSlot1.child : null;
    const body = ProgramCompiler.compileSequence(child, errors, warnings);
    return [{ op: "repeat", count: block.countSelection, body: body }];
  });

  // Forever: repeat con count 0
  register(["B_Forever"], function(block, errors, warnings) {
    const child = block.blockSlot1 != null ? block.blockSlot1.child : null;
    const body = ProgramCompiler.compileSequence(child, errors, warnings);
    return [{ op: "repeat", count: 0, body: body }];
  });

  // Motion: los ticks/speeds ya vienen calculados por updateValues()
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

  // Avanzar hasta condición: primitivas motores + waitUntil + stop
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
