"use strict";

/**
 * ProgramModeManager orquesta el "modo programa" de FinchBlox: en vez de
 * ejecutar los bloques en vivo, compila el programa a bytecode STX1 y lo
 * transfiere a la micro:bit, que lo guarda en flash y lo corre standalone.
 *
 * Gestos (elegidos para pre-lectores):
 *   - Play (TitleBar.flagBn) en modo programa: compila + transfiere a la
 *     placa (no hay botón Enviar aparte).
 *   - Stop: deshabilitado en modo programa; en vivo, sin cambios —
 *     Device.stopAll() llega al firmware como STOP.
 *   - Toggle vivo/programa (TitleBar.liveCellBn/progCellBn): opción del
 *     docente, persiste en SettingsManager.programMode.
 */
function ProgramModeManager() {}

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

/**
 * Compila los stacks del tab activo.
 * @return {{bytes: Uint8Array|null, errors: Array, warnings: Array}}
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
  const result = ProgramCompiler.compile(firstBlocks);
  if (result.errors.length > 0) {
    return { bytes: null, errors: result.errors, warnings: result.warnings };
  }
  try {
    const bytes = BytecodeAssembler.assemble(result.ir);
    return { bytes: bytes, errors: [], warnings: result.warnings };
  } catch (e) {
    return {
      bytes: null,
      errors: [{ code: e.code || "E_ASSEMBLE", detail: e.message }],
      warnings: result.warnings
    };
  }
};

/** Botón Enviar: compila y transfiere el programa a la placa */
ProgramModeManager.sendClicked = function() {
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
  const request = new HttpRequestBuilder("robot/out/program");
  request.addParam("type", device.getDeviceTypeId());
  request.addParam("id", device.id);
  const base64 = ProgramModeManager.toBase64(result.bytes);
  HtmlServer.sendRequestWithCallback(request.toString(), function() {
    GuiElements.alert("Program transferred");
  }, function(status, message) {
    GuiElements.alert("Program transfer FAILED: " + status + " " + message);
    ProgramModeManager.flashSendButton();
  }, true, base64, true, true);
};

/** Bandera en modo programa: corre lo ya transferido */
ProgramModeManager.flagClicked = function() {
  if (ProgramModeManager.debugWithoutBackend()) {
    console.log("[ProgramMode] RUN");
    return;
  }
  const device = DeviceFinch.getManager().getDevice(0);
  if (device == null) {
    TitleBar.flashFinchButton();
    return;
  }
  const request = new HttpRequestBuilder("robot/out/runProgram");
  request.addParam("type", device.getDeviceTypeId());
  request.addParam("id", device.id);
  HtmlServer.sendRequestWithCallback(request.toString(), null, function() {
    ProgramModeManager.flashSendButton();
  }, false, null, true);
};

/** Sin backend nativo ni host PWA: modo debug, loguear en consola */
ProgramModeManager.debugWithoutBackend = function() {
  return HtmlServer.iosHandler == null && !window.AndroidInterface && !GuiElements.isPWA;
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
  GuiElements.alert("Program compile errors: " + text);
};

ProgramModeManager.flashSendButton = function() {
  //El Play unificado es quien envía el programa en modo descarga
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
