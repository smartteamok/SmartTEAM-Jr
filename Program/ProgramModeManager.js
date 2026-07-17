"use strict";

/**
 * ProgramModeManager orquesta la ejecución remota de FinchBlox/SmartTEAM:
 * compila el programa a bytecode STX1, lo transfiere a la micro:bit por BLE
 * y la placa lo ejecuta con su VM. La app recibe notificaciones push
 * (bloque en ejecución / fin / error) vía CallbackManager.robot.program*.
 *
 * Dos modos, mismo flujo (Play unificado en TitleBar.flagBn):
 *   - Vivo (default): transferencia VOLÁTIL (RAM, cero desgaste de flash)
 *     + RUN. Para probar mientras se arma el programa.
 *   - Programa/descarga: transferencia PERSISTENTE (flash con wear-leveling)
 *     + RUN. La placa lo sigue corriendo standalone tras reset.
 *   - Stop: CodeManager.stop → Device.stopAll → CMD_STOP en la placa.
 *   - Play con un programa ya corriendo = reiniciar (la transferencia nueva
 *     detiene la anterior en el firmware).
 *
 * El toggle vivo/programa (TitleBar.liveCellBn/progCellBn) persiste en
 * SettingsManager.programMode.
 */
function ProgramModeManager() {}

/** Placa conectada (STX.BOARD_*); lo informa el backend al conectar */
ProgramModeManager.boardId = 0;
/** true mientras la placa ejecuta un programa que mandamos nosotros */
ProgramModeManager.remoteRunning = false;
/** índice de OP_MARK → Block del canvas (de la última compilación enviada) */
ProgramModeManager.markerMap = null;
/* bloques actualmente resaltados, uno por stack: [{stack, block}] */
ProgramModeManager._active = [];

ProgramModeManager.isProgramMode = function() {
  return SettingsManager.programMode.getValue() === "true";
};

ProgramModeManager.toggle = function() {
  const newValue = ProgramModeManager.isProgramMode() ? "false" : "true";
  SettingsManager.programMode.writeValue(newValue);
  if (typeof TitleBar.updateModeButtons === "function") {
    TitleBar.updateModeButtons();
  }
};

ProgramModeManager.setBoardId = function(boardId) {
  ProgramModeManager.boardId = boardId;
};

/** Los bloques de movimiento solo corren en placas con motores (Tiny:bit) */
ProgramModeManager.allowMotors = function() {
  return ProgramModeManager.boardId === STX.BOARD_TINYBIT;
};

/**
 * Compila los stacks del tab activo (con marcadores de bloque).
 * @return {{bytes: Uint8Array|null, markerMap: Array|null, errors: Array, warnings: Array}}
 */
ProgramModeManager.compileCurrent = function() {
  const firstBlocks = [];
  if (TabManager.activeTab != null) {
    const stackList = TabManager.activeTab.stackList;
    for (let i = 0; i < stackList.length; i++) {
      if (!stackList[i].isDisplayStack && stackList[i].firstBlock != null) {
        firstBlocks.push(stackList[i].firstBlock);
      }
    }
  }
  const result = ProgramCompiler.compile(firstBlocks, {
    emitMarkers: true,
    allowMotors: ProgramModeManager.allowMotors()
  });
  if (result.errors.length > 0) {
    return { bytes: null, markerMap: null, errors: result.errors, warnings: result.warnings };
  }
  try {
    const bytes = BytecodeAssembler.assemble(result.ir);
    return { bytes: bytes, markerMap: result.markerMap, errors: [], warnings: result.warnings };
  } catch (e) {
    return {
      bytes: null,
      markerMap: null,
      errors: [{ code: e.code || "E_ASSEMBLE", detail: e.message }],
      warnings: result.warnings
    };
  }
};

/**
 * Play unificado: compila, transfiere (volátil en vivo, persistente en
 * descarga) y manda RUN. Si ya hay un programa corriendo, lo reemplaza.
 */
ProgramModeManager.playClicked = function() {
  const result = ProgramModeManager.compileCurrent();
  if (result.bytes == null) {
    ProgramModeManager.reportErrors(result.errors);
    return;
  }
  if (ProgramModeManager.debugWithoutBackend()) {
    console.log("[ProgramMode] bytecode STX1 (" + result.bytes.length + " bytes): " +
      ProgramModeManager.toHex(result.bytes));
    return;
  }
  const device = DeviceFinch.getManager().getDevice(0);
  if (device == null) {
    TitleBar.flashFinchButton();
    return;
  }
  ProgramModeManager.clearHighlights();
  ProgramModeManager.markerMap = result.markerMap;

  const mode = ProgramModeManager.isProgramMode() ? "download" : "live";
  const request = new HttpRequestBuilder("robot/out/program");
  request.addParam("type", device.getDeviceTypeId());
  request.addParam("id", device.id);
  request.addParam("mode", mode);
  const base64 = ProgramModeManager.toBase64(result.bytes);
  HtmlServer.sendRequestWithCallback(request.toString(), function() {
    GuiElements.alert("Programa transferido (" + mode + ")");
    ProgramModeManager.sendRun(device);
  }, function(status, message) {
    GuiElements.alert("Fallo de transferencia: " + status + " " + message);
    ProgramModeManager.flashSendButton();
  }, true, base64, true, true);
};

/** Manda RUN tras una transferencia exitosa */
ProgramModeManager.sendRun = function(device) {
  const request = new HttpRequestBuilder("robot/out/runProgram");
  request.addParam("type", device.getDeviceTypeId());
  request.addParam("id", device.id);
  HtmlServer.sendRequestWithCallback(request.toString(), function() {
    ProgramModeManager.remoteRunning = true;
  }, function() {
    ProgramModeManager.flashSendButton();
  }, false, null, true);
};

/* ---------------- Notificaciones push desde la placa (CallbackManager) --- */

/** La placa está ejecutando el bloque markerMap[index]: resaltarlo */
ProgramModeManager.onMarker = function(index) {
  const map = ProgramModeManager.markerMap;
  if (!ProgramModeManager.remoteRunning || map == null) {
    return;
  }
  const block = map[index];
  if (block == null || typeof block.setRemoteHighlight !== "function") {
    return;
  }
  // un resaltado por stack: apagar el anterior del mismo stack
  const active = ProgramModeManager._active;
  for (let i = 0; i < active.length; i++) {
    if (active[i].stack === block.stack) {
      active[i].block.setRemoteHighlight(false);
      active[i].block = block;
      block.setRemoteHighlight(true);
      return;
    }
  }
  active.push({ stack: block.stack, block: block });
  block.setRemoteHighlight(true);
};

/** El programa terminó solo en la placa */
ProgramModeManager.onProgramDone = function(reason) {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.remoteRunning = false;
};

/** La VM de la placa se detuvo por un error */
ProgramModeManager.onProgramFault = function(errCode) {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.remoteRunning = false;
  DialogManager.showAlertDialog(AppName,
    "El programa se detuvo por un error (código " + errCode + ")", "OK");
};

/** Stop (local o del botón): limpiar el estado de ejecución remota */
ProgramModeManager.onRemoteStopped = function() {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.remoteRunning = false;
};

/** El usuario editó el canvas: el mapa de marcadores quedó viejo */
ProgramModeManager.invalidateMarkers = function() {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.markerMap = null;
};

ProgramModeManager.clearHighlights = function() {
  const active = ProgramModeManager._active;
  for (let i = 0; i < active.length; i++) {
    if (typeof active[i].block.setRemoteHighlight === "function") {
      active[i].block.setRemoteHighlight(false);
    }
  }
  ProgramModeManager._active = [];
};

/* ------------------------------------------------------------- helpers --- */

/** Sin backend nativo ni host PWA: modo debug, loguear en consola */
ProgramModeManager.debugWithoutBackend = function() {
  return HtmlServer.iosHandler == null && !window.AndroidInterface && !GuiElements.isPWA;
};

/** Textos de error de compilación para el docente/niño */
ProgramModeManager.errorText = function(code) {
  const table = {
    E_EMPTY: "No hay bloques para enviar",
    E_UNSUPPORTED_BLOCK: "Hay un bloque que la placa no entiende",
    E_UNSUPPORTED_ON_BOARD: "Los bloques de movimiento necesitan el robot conectado",
    E_TOO_MANY_STACKS: "Hay demasiados programas a la vez",
    E_TOO_LARGE: "El programa es demasiado grande",
    E_TOO_MANY_BLOCKS: "El programa tiene demasiados bloques"
  };
  return table[code] || ("No se pudo preparar el programa (" + code + ")");
};

ProgramModeManager.reportErrors = function(errors) {
  ProgramModeManager.flashSendButton();
  let text = "";
  for (let i = 0; i < errors.length; i++) {
    text += errors[i].code;
    if (errors[i].blockType != null) {
      text += " (" + errors[i].blockType + ")";
    }
    text += " ";
  }
  console.log("[ProgramMode] errores de compilación: " + text);
  if (errors.length > 0 && !ProgramModeManager.debugWithoutBackend()) {
    DialogManager.showAlertDialog(AppName,
      ProgramModeManager.errorText(errors[0].code), "OK");
  }
};

ProgramModeManager.flashSendButton = function() {
  //El Play unificado es quien envía el programa
  if (TitleBar.flagBn != null) {
    TitleBar.flagBn.flash();
  }
};

ProgramModeManager.toBase64 = function(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

ProgramModeManager.toHex = function(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  }
  return hex;
};
