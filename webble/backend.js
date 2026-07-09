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
      cb.robot.updateFirmwareStatus(device.id, "upToDate");
      cb.robot.updateHasV2Microbit(device.id, "true");
    });
  } catch (e) {
    console.warn("[webble] connect: " + e.message);
    respond(id, 500, e.message);
    pushCallback(function(cb) { cb.robot.connectionFailure(robotId); });
  }
};

WebBLE.disconnect = function(id) {
  if (WebBLE.device != null && WebBLE.device.gatt.connected) {
    WebBLE.device.gatt.disconnect();
  }
  respond(id, 200, "");
};

/* ------------------------------------------- BLE: protocolo stx_proto.h */

WebBLE.onNotify = function(event) {
  const data = new Uint8Array(event.target.value.buffer);
  const pending = WebBLE.pendingResponse;
  if (pending != null && data.length >= 1 && data[0] === (pending.cmd | STX.RESP_FLAG)) {
    clearTimeout(pending.timer);
    WebBLE.pendingResponse = null;
    pending.resolve(data);
  } else {
    console.log("[webble] notificación no esperada:", data);
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

/** Transfiere una imagen STX1 completa: BEGIN + chunks + END */
WebBLE.sendProgram = async function(bytes) {
  const crc = BytecodeAssembler.crc32(bytes);
  const begin = new Uint8Array(7);
  begin[0] = STX.CMD_XFER_BEGIN;
  begin[1] = bytes.length & 0xFF;
  begin[2] = (bytes.length >> 8) & 0xFF;
  begin[3] = crc & 0xFF;
  begin[4] = (crc >>> 8) & 0xFF;
  begin[5] = (crc >>> 16) & 0xFF;
  begin[6] = (crc >>> 24) & 0xFF;
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
  WebBLE.sendProgram(bytes).then(function() {
    console.log("[webble] programa transferido: " + bytes.length + " bytes");
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
