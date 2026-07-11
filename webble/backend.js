"use strict";

/**
 * Backend Web Bluetooth para FinchBlox/SmartTEAM (desktop Chrome/Edge).
 *
 * Implementa el contrato de backend del editor (README "Overview for backend
 * developers"): el editor corre en un iframe con GuiElements.isPWA=true y cada
 * request llega acá vía window.parseFinchBloxRequest({request, body, id}).
 * Las respuestas vuelven con CallbackManager.httpResponse(id, status, body) y
 * los eventos push con CallbackManager.robot.* dentro del iframe.
 *
 * Bluetooth: Nordic UART Service hacia el firmware SmartTEAM (firmware/), con
 * el protocolo de firmware/source/proto/stx_proto.h (constantes STX.* de
 * Program/STXConstants.js, cargado por index.html).
 */

const WebBLE = {};

WebBLE.UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
WebBLE.UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // central escribe
WebBLE.UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // firmware notifica

WebBLE.RESPONSE_TIMEOUT_MS = 500;
WebBLE.MAX_RETRIES = 3;

WebBLE.device = null;
WebBLE.rxChar = null;
WebBLE.txChar = null;
WebBLE.pendingResponse = null; // {cmd, resolve, timer}

/* ---------------------------------------------------------------- helpers */

function editorWindow() {
  return document.getElementById("editor").contentWindow;
}

function respond(id, status, body) {
  const win = editorWindow();
  if (win && win.CallbackManager) {
    win.CallbackManager.httpResponse(id, status, body || "");
  }
}

function pushCallback(fn) {
  const win = editorWindow();
  if (win && win.CallbackManager) {
    fn(win.CallbackManager);
  }
}

function parseRequest(requestString) {
  const qIndex = requestString.indexOf("?");
  const path = qIndex < 0 ? requestString : requestString.substring(0, qIndex);
  const params = {};
  if (qIndex >= 0) {
    const pairs = requestString.substring(qIndex + 1).split("&");
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq >= 0) {
        params[pair.substring(0, eq)] = decodeURIComponent(
          pair.substring(eq + 1).replace(/\+/g, " "));
      }
    }
  }
  return { path: path, params: params };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ------------------------------------------------------- BLE: conexión */

WebBLE.discover = async function(id) {
  try {
    // Debe ejecutarse dentro del gesto del usuario (la cadena de llamadas
    // desde el tap del DiscoverDialog es síncrona hasta acá)
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "BBC micro:bit" }, { namePrefix: "SmartTEAM" }],
      optionalServices: [WebBLE.UART_SERVICE]
    });
    WebBLE.discovered = device;
    respond(id, 200, "");
    pushCallback(function(cb) {
      cb.robot.discovered(JSON.stringify([{
        name: device.name || "micro:bit",
        id: device.id,
        RSSI: -50,
        device: "microbit"
      }]));
    });
  } catch (e) {
    // usuario canceló el chooser o no hay BLE
    console.warn("[webble] discover: " + e.message);
    respond(id, 200, "");
    pushCallback(function(cb) { cb.robot.discovered("[]"); });
  }
};

WebBLE.connect = async function(id, robotId) {
  const device = WebBLE.discovered;
  if (device == null || device.id !== robotId) {
    respond(id, 404, "unknown device");
    return;
  }
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(WebBLE.UART_SERVICE);
    WebBLE.rxChar = await service.getCharacteristic(WebBLE.UART_RX);
    WebBLE.txChar = await service.getCharacteristic(WebBLE.UART_TX);
    WebBLE.rxBuf = []; // descartar restos de una conexión anterior
    await WebBLE.txChar.startNotifications();
    WebBLE.txChar.addEventListener("characteristicvaluechanged", WebBLE.onNotify);
    device.addEventListener("gattserverdisconnected", function() {
      WebBLE.rxChar = null;
      WebBLE.txChar = null;
      pushCallback(function(cb) { cb.robot.updateStatus(device.id, false); });
    });
    WebBLE.device = device;
    respond(id, 200, "");
    pushCallback(function(cb) {
      cb.robot.updateStatus(device.id, true);
      cb.robot.updateHasV2Microbit(device.id, "true");
    });
    WebBLE.queryFirmware(device.id);
  } catch (e) {
    console.warn("[webble] connect: " + e.message);
    respond(id, 500, e.message);
    pushCallback(function(cb) { cb.robot.connectionFailure(robotId); });
  }
};

/** GET_STATUS post-conexión: versión de protocolo real + tipo de placa */
WebBLE.queryFirmware = async function(robotId) {
  let fwStatus = "old";
  let boardId = STX.BOARD_BASIC;
  try {
    const resp = await WebBLE.commandWithRetry(new Uint8Array([STX.CMD_GET_STATUS]));
    if (resp.length >= 14 && resp[12] >= STX.PROTO_VERSION) {
      fwStatus = "upToDate";
      boardId = resp[13];
    }
  } catch (e) {
    console.warn("[webble] GET_STATUS falló: " + e.message);
  }
  WebBLE.boardId = boardId;
  pushCallback(function(cb) {
    cb.robot.updateFirmwareStatus(robotId, fwStatus);
    if (cb.robot.updateBoardType != null) {
      cb.robot.updateBoardType(robotId, boardId);
    }
  });
};

WebBLE.disconnect = function(id) {
  if (WebBLE.device != null && WebBLE.device.gatt.connected) {
    WebBLE.device.gatt.disconnect();
  }
  respond(id, 200, "");
};

/* ------------------------------------------- BLE: protocolo stx_proto.h */

/* Longitud de cada paquete firmware→editor según su primer byte (espejo del
 * framing del firmware: MicroBitUARTService puede concatenar o partir los
 * notify TX, así que el RX también es un stream). */
WebBLE.RESP_LEN = {
  0x81: 2,  // XFER_BEGIN
  0x82: 3,  // XFER_CHUNK [seq][status]
  0x83: 2,  // XFER_END
  0x90: 2,  // RUN
  0x91: 2,  // STOP
  0x92: 14, // GET_STATUS
  0x93: 2,  // ERASE
  0x94: 5,  // GET_SENSORS
  0xA0: 2,  // LIVE_EXEC
  0xF0: 2,  // NOTIF_MARK
  0xF1: 2,  // NOTIF_DONE
  0xF2: 2   // NOTIF_FAULT
};

WebBLE.rxBuf = [];

WebBLE.onNotify = function(event) {
  const data = new Uint8Array(event.target.value.buffer);
  for (let i = 0; i < data.length; i++) {
    WebBLE.rxBuf.push(data[i]);
  }
  // reensamblar paquetes completos y despachar
  while (WebBLE.rxBuf.length > 0) {
    const need = WebBLE.RESP_LEN[WebBLE.rxBuf[0]];
    if (need == null) {
      WebBLE.rxBuf.shift(); // byte inválido: re-sincronizar
      continue;
    }
    if (WebBLE.rxBuf.length < need) {
      break; // faltan bytes
    }
    const packet = new Uint8Array(WebBLE.rxBuf.splice(0, need));
    WebBLE.dispatchPacket(packet);
  }
};

WebBLE.dispatchPacket = function(packet) {
  if (packet[0] >= 0xF0) {
    WebBLE.onPush(packet);
    return;
  }
  const pending = WebBLE.pendingResponse;
  if (pending != null && packet[0] === (pending.cmd | STX.RESP_FLAG)) {
    clearTimeout(pending.timer);
    WebBLE.pendingResponse = null;
    pending.resolve(packet);
  } else {
    console.log("[webble] respuesta no esperada:", packet);
  }
};

/** Notificaciones push del firmware (ejecución remota del programa) */
WebBLE.onPush = function(packet) {
  const arg = packet[1];
  switch (packet[0]) {
    case STX.NOTIF_MARK:
      pushCallback(function(cb) { cb.robot.programMarker(arg); });
      break;
    case STX.NOTIF_DONE:
      pushCallback(function(cb) { cb.robot.programDone(arg); });
      break;
    case STX.NOTIF_FAULT:
      pushCallback(function(cb) { cb.robot.programFault(arg); });
      break;
  }
};

/** Escribe un paquete y espera la respuesta (cmd | 0x80) con timeout */
WebBLE.command = function(packet) {
  return new Promise(function(resolve, reject) {
    if (WebBLE.rxChar == null) {
      reject(new Error("not connected"));
      return;
    }
    if (WebBLE.pendingResponse != null) {
      reject(new Error("busy"));
      return;
    }
    const timer = setTimeout(function() {
      WebBLE.pendingResponse = null;
      reject(new Error("timeout"));
    }, WebBLE.RESPONSE_TIMEOUT_MS);
    WebBLE.pendingResponse = { cmd: packet[0], resolve: resolve, timer: timer };
    WebBLE.rxChar.writeValue(packet).catch(function(e) {
      clearTimeout(timer);
      WebBLE.pendingResponse = null;
      reject(e);
    });
  });
};

WebBLE.commandWithRetry = async function(packet) {
  let lastError = null;
  for (let attempt = 0; attempt < WebBLE.MAX_RETRIES; attempt++) {
    try {
      return await WebBLE.command(packet);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
};

/** Transfiere una imagen STX1 completa: BEGIN + chunks + END.
 * options.volatile: no persistir en flash (modo vivo, cero desgaste). */
WebBLE.sendProgram = async function(bytes, options) {
  const crc = BytecodeAssembler.crc32(bytes);
  const begin = new Uint8Array(8);
  begin[0] = STX.CMD_XFER_BEGIN;
  begin[1] = bytes.length & 0xFF;
  begin[2] = (bytes.length >> 8) & 0xFF;
  begin[3] = crc & 0xFF;
  begin[4] = (crc >>> 8) & 0xFF;
  begin[5] = (crc >>> 16) & 0xFF;
  begin[6] = (crc >>> 24) & 0xFF;
  begin[7] = (options && options.volatile) ? STX.XFER_FLAG_VOLATILE : 0;
  let resp = await WebBLE.commandWithRetry(begin);
  if (resp[1] !== STX.STATUS_OK) {
    throw new Error("XFER_BEGIN status " + resp[1]);
  }

  const chunkSize = STX.CHUNK_DATA_SIZE;
  const total = Math.ceil(bytes.length / chunkSize);
  for (let seq = 0; seq < total; seq++) {
    const offset = seq * chunkSize;
    const data = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    const chunk = new Uint8Array(3 + data.length);
    chunk[0] = STX.CMD_XFER_CHUNK;
    chunk[1] = seq & 0xFF;
    chunk[2] = data.length;
    chunk.set(data, 3);
    resp = await WebBLE.commandWithRetry(chunk);
    if (resp[2] !== STX.STATUS_OK) {
      throw new Error("XFER_CHUNK " + seq + " status " + resp[2]);
    }
  }

  resp = await WebBLE.commandWithRetry(new Uint8Array([STX.CMD_XFER_END]));
  if (resp[1] !== STX.STATUS_OK) {
    throw new Error("XFER_END status " + resp[1]);
  }
};

/** Instrucción STX inmediata (modo live) */
WebBLE.liveExec = function(instrBytes) {
  const packet = new Uint8Array(1 + instrBytes.length);
  packet[0] = STX.CMD_LIVE_EXEC;
  packet.set(instrBytes, 1);
  return WebBLE.commandWithRetry(packet);
};

/* ---------------------------------------------------- almacenamiento de archivos
 * Implementa el contrato data/* documentado en README.md ("Overview for
 * backend developers"): data/new y data/open no solo deben responder 200 —
 * el backend además tiene que EMPUJAR CallbackManager.data.open(fileName, data)
 * para que SaveManager.backendOpen() cargue el XML y saque el bloqueo modal
 * (GuiElements.dialogBlock). Sin este push el editor queda con la pantalla
 * gris para siempre (LevelManager.loadLevelSavePoint -> data/new -> data/open
 * nunca se completa). data/autoSave no manda filename: hay que recordar cuál
 * es el archivo abierto (FileStore.currentFile).
 */
const FileStore = {};
FileStore.INDEX_KEY = "fbfile_index";
FileStore.currentFile = null;

FileStore.contentKey = function(name) {
  return "fbfilecontent_" + name;
};

FileStore.listFiles = function() {
  try {
    return JSON.parse(localStorage.getItem(FileStore.INDEX_KEY)) || [];
  } catch (e) {
    return [];
  }
};

FileStore.saveIndex = function(files) {
  localStorage.setItem(FileStore.INDEX_KEY, JSON.stringify(files));
};

FileStore.exists = function(name) {
  return FileStore.listFiles().indexOf(name) >= 0;
};

FileStore.write = function(name, content) {
  const files = FileStore.listFiles();
  if (files.indexOf(name) < 0) {
    files.push(name);
    FileStore.saveIndex(files);
  }
  localStorage.setItem(FileStore.contentKey(name), content);
};

FileStore.read = function(name) {
  const content = localStorage.getItem(FileStore.contentKey(name));
  return content == null ? "" : content;
};

FileStore.remove = function(name) {
  const files = FileStore.listFiles().filter(function(f) { return f !== name; });
  FileStore.saveIndex(files);
  localStorage.removeItem(FileStore.contentKey(name));
};

FileStore.rename = function(oldName, newName) {
  FileStore.write(newName, FileStore.read(oldName));
  FileStore.remove(oldName);
};

/** Réplica de SaveManager.invalidCharactersFriendly: \/:*?<>|.$ */
FileStore.sanitize = function(name) {
  return name.replace(/[\\/:*?<>|.$]/g, "_");
};

FileStore.availableName = function(requested) {
  const sanitized = FileStore.sanitize(requested);
  let candidate = sanitized;
  let n = 2;
  while (FileStore.exists(candidate)) {
    candidate = sanitized + "_" + n;
    n++;
  }
  return {
    availableName: candidate,
    alreadySanitized: sanitized === requested,
    alreadyAvailable: candidate === requested
  };
};

/* ------------------------------------------------------------- router */

const routes = {};

routes["settings/get"] = function(id, params) {
  const value = localStorage.getItem("fbsetting_" + params.key);
  if (value == null) {
    respond(id, 404, "");
  } else {
    respond(id, 200, value);
  }
};

routes["settings/set"] = function(id, params) {
  localStorage.setItem("fbsetting_" + params.key, params.value);
  respond(id, 200, "");
};

routes["data/files"] = function(id) {
  respond(id, 200, JSON.stringify({ files: FileStore.listFiles(), signedIn: false }));
};

routes["data/new"] = function(id, params, body) {
  FileStore.write(params.filename, body || "");
  respond(id, 200, "");
};

routes["data/open"] = function(id, params) {
  const content = FileStore.read(params.filename);
  FileStore.currentFile = params.filename;
  respond(id, 200, "");
  // El ack por sí solo no alcanza: SaveManager.backendOpen (disparado por este
  // push) es quien realmente carga el XML y saca GuiElements.dialogBlock.
  pushCallback(function(cb) { cb.data.open(params.filename, content); });
};

routes["data/autoSave"] = function(id, params, body) {
  if (FileStore.currentFile != null) {
    FileStore.write(FileStore.currentFile, body || "");
  }
  respond(id, 200, "");
};

routes["data/getAvailableName"] = function(id, params) {
  respond(id, 200, JSON.stringify(FileStore.availableName(params.filename)));
};

routes["data/rename"] = function(id, params) {
  FileStore.rename(params.oldFilename, params.newFilename);
  if (FileStore.currentFile === params.oldFilename) {
    FileStore.currentFile = params.newFilename;
  }
  respond(id, 200, "");
};

routes["data/delete"] = function(id, params) {
  FileStore.remove(params.filename);
  respond(id, 200, "");
};

routes["data/duplicate"] = function(id, params) {
  FileStore.write(params.newFilename, FileStore.read(params.filename));
  respond(id, 200, "");
};

routes["robot/startDiscover"] = function(id) {
  WebBLE.discover(id);
};

routes["robot/stopDiscover"] = function(id) {
  respond(id, 200, "");
  pushCallback(function(cb) { cb.robot.stopDiscover(); });
};

routes["robot/connect"] = function(id, params) {
  WebBLE.connect(id, params.id);
};

routes["robot/disconnect"] = function(id) {
  WebBLE.disconnect(id);
};

routes["robot/stopAll"] = function(id) {
  WebBLE.commandWithRetry(new Uint8Array([STX.CMD_STOP])).then(function() {
    respond(id, 200, "");
  }).catch(function() {
    respond(id, 200, ""); // stopAll también dispara sin robot: no es error
  });
};

routes["robot/out/program"] = function(id, params, body) {
  const bytes = base64ToBytes(body);
  // mode=live → transferencia volátil (RAM, sin desgaste de flash);
  // mode=download (o ausente) → persiste y corre standalone tras reset
  const isVolatile = params.mode === "live";
  WebBLE.sendProgram(bytes, { volatile: isVolatile }).then(function() {
    console.log("[webble] programa transferido (" + (isVolatile ? "vivo" : "descarga") +
      "): " + bytes.length + " bytes");
    respond(id, 200, "");
  }).catch(function(e) {
    console.warn("[webble] transferencia falló: " + e.message);
    respond(id, 500, e.message);
  });
};

routes["robot/out/runProgram"] = function(id) {
  WebBLE.commandWithRetry(new Uint8Array([STX.CMD_RUN])).then(function(resp) {
    respond(id, resp[1] === STX.STATUS_OK ? 200 : 500, "");
  }).catch(function(e) {
    respond(id, 500, e.message);
  });
};

routes["robot/out/ledArray"] = function(id, params) {
  const packed = BytecodeAssembler.packLedPattern(params.ledArrayStatus || "");
  WebBLE.liveExec(new Uint8Array(
    [STX.OP_LED_PATTERN, packed[0], packed[1], packed[2], packed[3]]
  )).then(function() {
    respond(id, 200, "");
  }).catch(function(e) {
    respond(id, 500, e.message);
  });
};

routes["robot/out/buzzer"] = function(id, params) {
  const note = Number(params.note) & 0xFF;
  const duration = Math.max(0, Math.min(0xFFFF, Number(params.duration)));
  WebBLE.liveExec(new Uint8Array(
    [STX.OP_TONE, note, duration & 0xFF, (duration >> 8) & 0xFF]
  )).then(function() {
    respond(id, 200, "");
  }).catch(function(e) {
    respond(id, 500, e.message);
  });
};

function rgbLiveRoute(id, params) {
  const scale = function(v) {
    return Math.round(Math.max(0, Math.min(100, Number(v))) * 255 / 100);
  };
  WebBLE.liveExec(new Uint8Array([
    STX.OP_RGB_SET, scale(params.red), scale(params.green), scale(params.blue)
  ])).then(function() {
    respond(id, 200, "");
  }).catch(function(e) {
    respond(id, 500, e.message);
  });
}
routes["robot/out/beak"] = rgbLiveRoute;
routes["robot/out/tail"] = rgbLiveRoute;

routes["robot/out/motors"] = function(id, params) {
  // Solo útil con placa con motores (Tiny:bit); en la básica el firmware
  // responde REJECTED y devolvemos 200 igual (tolerante, como stopAll)
  const clampI8 = function(v) {
    return Math.max(-100, Math.min(100, Math.round(Number(v) || 0))) & 0xFF;
  };
  const speedL = clampI8(params.speedL);
  const speedR = clampI8(params.speedR);
  const ticks = Math.max(0, Math.min(0xFFFF,
    Math.max(Number(params.ticksL) || 0, Number(params.ticksR) || 0)));
  let instr;
  if (speedL === 0 && speedR === 0) {
    instr = new Uint8Array([STX.OP_MOTORS_STOP]);
  } else if (ticks > 0) {
    instr = new Uint8Array([STX.OP_MOTORS_TICKS, speedL, speedR,
      ticks & 0xFF, (ticks >> 8) & 0xFF]);
  } else {
    instr = new Uint8Array([STX.OP_MOTORS, speedL, speedR]);
  }
  WebBLE.liveExec(instr).then(function() {
    respond(id, 200, "");
  }).catch(function() {
    respond(id, 200, "");
  });
};

routes["robot/in"] = function(id) {
  respond(id, 200, "0"); // sensores live: slice 2 (GET_SENSORS)
};

window.parseFinchBloxRequest = function(requestObject) {
  const parsed = parseRequest(requestObject.request);
  const handler = routes[parsed.path];
  if (handler != null) {
    handler(requestObject.id, parsed.params, requestObject.body);
    return;
  }
  // Rutas sin efecto en este host (ui/*, sound/*, tablet/*, data/*, ...):
  // responder 200 mantiene al editor contento; el warn permite iterar.
  console.warn("[webble] ruta sin handler: " + requestObject.request);
  respond(requestObject.id, 200, "");
};
