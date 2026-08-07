"use strict";

/**
 * ProgramModeManager orchestrates remote execution for FinchBlox/SmartTEAM: it
 * compiles the program to STX1 bytecode, transfers it to the micro:bit over BLE, and
 * the board runs it on its VM. The app receives pushed notifications
 * (running block / finished / error) through CallbackManager.robot.program*.
 *
 * Two modes, one flow (the unified Play in TitleBar.flagBn):
 *   - Live (default): VOLATILE transfer (RAM, no flash wear)
 *     + RUN. For trying things out while the program is being built.
 *   - Program/download: PERSISTENT transfer (flash, with wear-levelling) + RUN. The
 *     board keeps running it standalone after a reset.
 *   - Stop: CodeManager.stop → Device.stopAll → CMD_STOP on the board.
 *   - Play with a program already running = restart it (the new transfer stops the
 *     previous one in the firmware).
 *
 * The live/program toggle (TitleBar.liveCellBn/progCellBn) persists in
 * SettingsManager.programMode.
 */
function ProgramModeManager() {}

/** The connected board (STX.BOARD_*), reported by the backend on connect. */
ProgramModeManager.boardId = 0;
/** True while the board is running a program we sent. */
ProgramModeManager.remoteRunning = false;
/** OP_MARK index → canvas Block, from the last compilation that was sent. */
ProgramModeManager.markerMap = null;
/* Currently highlighted blocks, one per stack: [{stack, block}]. */
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

/** Movement blocks only run on boards with motors (Tiny:bit). */
ProgramModeManager.allowMotors = function() {
  return ProgramModeManager.boardId === STX.BOARD_TINYBIT;
};

/**
 * Compiles the active tab's stacks, with block markers.
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
 * Unified Play: compiles, transfers (volatile when live, persistent on
 * download) and sends RUN. If a program is already running, it replaces it.
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
    GuiElements.alert("Program transferred (" + mode + ")");
    ProgramModeManager.sendRun(device);
  }, function(status, message) {
    GuiElements.alert("Transfer failed: " + status + " " + message);
    ProgramModeManager.flashSendButton();
  }, true, base64, true, true);
};

/** Sends RUN after a successful transfer. */
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

/* ------------- Pushed notifications from the board (CallbackManager) ------ */

/** The board is running markerMap[index]: highlight it. */
ProgramModeManager.onMarker = function(index) {
  const map = ProgramModeManager.markerMap;
  if (!ProgramModeManager.remoteRunning || map == null) {
    return;
  }
  const block = map[index];
  if (block == null || typeof block.setRemoteHighlight !== "function") {
    return;
  }
  // One highlight per stack: turn off the previous one in that same stack
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

/** The program finished on its own on the board. */
ProgramModeManager.onProgramDone = function(reason) {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.remoteRunning = false;
};

/** The board's VM stopped because of an error. */
ProgramModeManager.onProgramFault = function(errCode) {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.remoteRunning = false;
  DialogManager.showAlertDialog(AppName,
    Language.format("program_fault", errCode), "OK");
};

/** Stop, local or from the button: clear the remote-execution state. */
ProgramModeManager.onRemoteStopped = function() {
  ProgramModeManager.clearHighlights();
  ProgramModeManager.remoteRunning = false;
};

/** The user edited the canvas, so the marker map is stale. */
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

/** No native backend and no PWA host: debug mode, log to the console. */
ProgramModeManager.debugWithoutBackend = function() {
  return HtmlServer.iosHandler == null && !window.AndroidInterface && !GuiElements.isPWA;
};

/** Compilation error messages, for the teacher and the child. */
/* Compiler error code -> translation key. The messages used to be a hardcoded
 * Spanish table, invisible to Language/, so they stayed Spanish whatever language
 * the UI was in. */
ProgramModeManager.ERROR_KEYS = {
  E_EMPTY: "program_error_empty",
  E_UNSUPPORTED_BLOCK: "program_error_unsupported_block",
  E_UNSUPPORTED_ON_BOARD: "program_error_unsupported_on_board",
  E_TOO_MANY_STACKS: "program_error_too_many_stacks",
  E_TOO_LARGE: "program_error_too_large",
  E_TOO_MANY_BLOCKS: "program_error_too_many_blocks",
  E_BAD_VALUE: "program_error_bad_value"
};

ProgramModeManager.errorText = function(code) {
  const key = ProgramModeManager.ERROR_KEYS[code];
  if (key != null) {
    return Language.getStr(key);
  }
  // Unknown code: still say something useful, with the code for the developer.
  return Language.format("program_error_generic", code);
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
  console.log("[ProgramMode] compilation errors: " + text);
  if (errors.length > 0 && !ProgramModeManager.debugWithoutBackend()) {
    DialogManager.showAlertDialog(AppName,
      ProgramModeManager.errorText(errors[0].code), "OK");
  }
};

ProgramModeManager.flashSendButton = function() {
  // The unified Play button is what sends the program
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
