"use strict";

/**
 * Web Bluetooth backend for FinchBlox/SmartTEAM (desktop Chrome/Edge).
 *
 * Implements the editor's backend contract (README, "Overview for backend
 * developers"): the editor runs in an iframe with GuiElements.isPWA=true, and every
 * request arrives here through window.parseFinchBloxRequest({request, body, id}).
 * Responses go back via CallbackManager.httpResponse(id, status, body), and pushed
 * events via CallbackManager.robot.* inside the iframe.
 *
 * Bluetooth: the Nordic UART Service towards the SmartTEAM firmware (firmware/),
 * speaking the protocol in firmware/source/proto/stx_proto.h (the STX.* constants
 * from Program/STXConstants.js, loaded by index.html).
 */

const WebBLE = {};

WebBLE.UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
WebBLE.UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // the central writes
WebBLE.UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // the firmware notifies

WebBLE.RESPONSE_TIMEOUT_MS = 500;
WebBLE.MAX_RETRIES = 3;

WebBLE.device = null;
WebBLE.rxChar = null;
WebBLE.txChar = null;
WebBLE.pendingResponse = null; // {cmd, seq, resolve, reject, timer}
WebBLE.connecting = false;     // a connect() is in flight

/* ---------------------------------------------------------------- helpers */

/**
 * Shows a diagnostic banner on the host page (outside the iframe). The editor
 * has no way to display why BLE failed — without this, every discover/connect
 * failure looks like "no devices found" and the real reason stays buried in the
 * DevTools console.
 */
WebBLE.showDiagnostic = function(message, action) {
  let bar = document.getElementById("webble-diagnostic");
  if (bar == null) {
    bar = document.createElement("div");
    bar.id = "webble-diagnostic";
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
      "background:#b3261e;color:#fff;font:13px/1.4 -apple-system,sans-serif;" +
      "padding:10px 36px 10px 12px;white-space:pre-wrap";
    const close = document.createElement("span");
    close.textContent = "×";
    close.style.cssText = "position:absolute;top:6px;right:12px;cursor:pointer;" +
      "font-size:20px;line-height:1";
    close.onclick = function() { bar.remove(); };
    const text = document.createElement("span");
    text.id = "webble-diagnostic-text";
    const btn = document.createElement("button");
    btn.id = "webble-diagnostic-action";
    btn.style.cssText = "display:none;margin-top:8px;padding:6px 12px;" +
      "font-size:13px;cursor:pointer";
    bar.appendChild(close);
    bar.appendChild(text);
    bar.appendChild(document.createElement("br"));
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }
  document.getElementById("webble-diagnostic-text").textContent = message;
  const btn = document.getElementById("webble-diagnostic-action");
  if (action != null) {
    btn.textContent = action.label;
    btn.style.display = "inline-block";
    // The click is a fresh user gesture: the only way to retry requestDevice,
    // since the original tap's transient activation was already consumed by the
    // attempt that failed.
    btn.onclick = function() { bar.remove(); action.run(); };
  } else {
    btn.style.display = "none";
    btn.onclick = null;
  }
  console.error("[webble] " + message);
};

/**
 * Reason why Web Bluetooth is unusable in this context, or null if available.
 * Checked before requestDevice so we can tell "browser doesn't support it /
 * insecure context" apart from "the user cancelled".
 */
WebBLE.unavailableReason = function() {
  if (!window.isSecureContext) {
    return t("ble_insecure_context",
      "Web Bluetooth needs a secure context: open the app over https:// or " +
      "http://localhost, not file:// or a network IP. Current origin: {0}",
      window.location.origin);
  }
  if (navigator.bluetooth == null) {
    return t("ble_no_web_bluetooth",
      "This browser does not expose Web Bluetooth (Safari and Firefox do not " +
      "support it). Use Chrome or Edge on desktop.");
  }
  return null;
};

function editorWindow() {
  return document.getElementById("editor").contentWindow;
}

/**
 * Translates a key by asking the editor, which is same-origin and already has all
 * of Language/ loaded. Doing it that way instead of loading the language files
 * into the host too avoids shipping 15 dictionaries twice and keeps a single
 * source of truth for the selected language.
 *
 * The fallback covers the window before the iframe has loaded, and any key that
 * has not been translated yet.
 * @param {string} key - dictionary key
 * @param {string} fallback - English text to use if the editor cannot answer
 * @param {...*} args - values for {0}, {1}, ... placeholders
 */
function t(key, fallback) {
  const args = Array.prototype.slice.call(arguments, 2);
  let text = fallback;
  const win = editorWindow();
  if (win != null && win.Language != null &&
      typeof win.Language.getStr === "function") {
    const translated = win.Language.getStr(key);
    // getStr answers "Translation required" for a missing key.
    if (translated != null && translated !== "Translation required") {
      text = translated;
    }
  }
  return String(text).replace(/\{(\d+)\}/g, function(match, i) {
    return args[i] != null ? String(args[i]) : match;
  });
}

function respond(id, status, body) {
  // id null = the original request was already answered (e.g. the unfiltered
  // discover retry, which only pushes its result through CallbackManager).
  if (id == null) {
    return;
  }
  const win = editorWindow();
  if (win && win.CallbackManager) {
    win.CallbackManager.httpResponse(id, status, body || "");
  }
}

/**
 * Like pushCallback, but yields first. Use it whenever the push can happen while
 * the editor is still inside the very request that triggered it: re-entering the
 * editor mid-operation runs its UI and rescan chains from an unexpected point,
 * and anything that throws there aborts the rest of the editor's function. That
 * is what broke reconnection (see WebBLE.pushStatus).
 */
function deferCallback(fn) {
  setTimeout(function() { pushCallback(fn); }, 0);
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

/* ---------------------------------------------------------- BLE: connection */

/* Name prefixes of a SmartTEAM board, for when name filtering is re-enabled. */
WebBLE.NAME_PREFIXES = ["BBC micro:bit", "SmartTEAM"];

/* TEMPORARY: the chooser lists ALL BLE devices.
 *
 * Name filtering is off because the name is not trustworthy: the one the
 * chooser displays may be the GAP name the OS cached from an earlier pairing,
 * different from what the board advertises today ("BBC micro:bit [xxxxx]").
 * Filtering by name makes the board vanish from the chooser, and the symptom is
 * indistinguishable from "no boards nearby".
 *
 * The real fix is for the firmware to advertise the Nordic UART UUID in the
 * advertising payload (it currently doesn't), so we can filter by service,
 * which is name-independent. Set this back to true once that ships. */
WebBLE.FILTER_BY_NAME = false;

WebBLE.requestOptions = function(showAll) {
  const options = { optionalServices: [WebBLE.UART_SERVICE] };
  if (showAll || !WebBLE.FILTER_BY_NAME) {
    options.acceptAllDevices = true;
  } else {
    options.filters = WebBLE.NAME_PREFIXES.map(function(p) {
      return { namePrefix: p };
    });
  }
  return options;
};

/**
 * Re-pushes the last discovery result. The editor's device list is rebuilt from
 * whatever `discovered` receives, so pushing an empty array wipes the rows the
 * child is looking at. Any discover that cannot actually run must replay the
 * previous list instead of clearing it.
 */
WebBLE.repushDiscovered = function() {
  const list = WebBLE.discoveredList || [];
  // Deferred: this runs on the gesture-less rescans the editor fires from inside
  // its own startDiscover, so it must not re-enter.
  deferCallback(function(cb) { cb.robot.discovered(JSON.stringify(list)); });
};

WebBLE.discoveredList = []; // the last result, so it can be replayed
WebBLE.discovering = false; // a requestDevice has the chooser open

WebBLE.discover = async function(id, showAll) {
  // Synchronous pre-flight check: if Web Bluetooth doesn't exist in this
  // context the chooser never opens, and without this banner the symptom is
  // indistinguishable from "no boards nearby".
  const unavailable = WebBLE.unavailableReason();
  if (unavailable != null) {
    WebBLE.showDiagnostic(
      t("ble_cannot_search", "The board cannot be searched for.") +
      "\n" + unavailable);
    respond(id, 200, "");
    pushCallback(function(cb) { cb.robot.discovered("[]"); });
    return;
  }
  /* The editor re-scans on its own: DeviceManager.startDiscover(() => true) runs
   * on every updateStatus(false), and possiblyRescan() re-arms while the dialog
   * is open. With a native backend that only restarted a passive scan. Here it
   * means a second requestDevice — a modal that needs a user gesture. Without
   * one it throws, and clearing the list on that error is what made the device
   * list blank out on its own. Ignore overlapping calls and keep the list. */
  if (WebBLE.discovering) {
    console.log("[webble] discover already running; keeping the current list");
    respond(id, 200, "");
    WebBLE.repushDiscovered();
    return;
  }
  WebBLE.discovering = true;
  try {
    // Must run inside the user gesture (the call chain from the DiscoverDialog
    // tap is synchronous up to here). Do not await anything before
    // requestDevice: transient activation only lasts 5 s.
    const device = await navigator.bluetooth.requestDevice(
      WebBLE.requestOptions(showAll));
    WebBLE.discovered = device;
    // device MUST be "Finch": Device.fromJson only builds known classes, and the
    // FinchBlox DiscoverDialog filters by its manager's class (DeviceFinch). The
    // SmartTEAM board fills that role in this fork.
    WebBLE.discoveredList = [{
      name: device.name || "micro:bit",
      id: device.id,
      RSSI: -50,
      device: "Finch"
    }];
    respond(id, 200, "");
    WebBLE.repushDiscovered();
  } catch (e) {
    // NotFoundError covers two different things: the user closed the chooser,
    // or the chooser opened empty. getAvailability() singles out the case where
    // the browser has no OS-level Bluetooth permission.
    if (e.name === "NotFoundError") {
      let available = true;
      try {
        available = await navigator.bluetooth.getAvailability();
      } catch (e2) { /* getAvailability unimplemented: carry on regardless */ }
      if (!available) {
        WebBLE.showDiagnostic(t("ble_no_os_permission",
          "The browser has no access to the system Bluetooth. On macOS: System " +
          "Settings \u2192 Privacy & Security \u2192 Bluetooth, and enable the browser."));
      } else if (WebBLE.FILTER_BY_NAME && !showAll) {
        // The name filter found nothing, but the board may well be there under
        // an unexpected name. The button supplies the user gesture needed to
        // retry unfiltered. (Moot when FILTER_BY_NAME is false: the chooser
        // already listed everything, so NotFoundError just means it was closed
        // without picking anything.)
        WebBLE.showDiagnostic(t("ble_no_named_board",
          "No board with a known name showed up ({0}).\nIf your board is named " +
          "differently, search without a filter and pick it from the list.",
          WebBLE.NAME_PREFIXES.join(", ")), {
            label: t("ble_show_all_devices", "Show all devices"),
            // id null: this request is already answered below with an empty
            // list; the retry only pushes the chosen board via CallbackManager.
            run: function() { WebBLE.discover(null, true); }
          });
      } else {
        console.warn("[webble] discover: chooser closed without picking a board (" +
          e.message + ")");
      }
    } else if (e.name === "SecurityError" || e.name === "InvalidStateError") {
      // No user gesture: an automatic re-scan from DeviceManager, not something
      // the child did. Silent by design — showing a banner here would flash an
      // error for an action nobody took.
      console.log("[webble] automatic discover with no user gesture; ignored (" +
        e.name + ")");
    } else {
      WebBLE.showDiagnostic(t("ble_discover_failed",
        "Searching for the board failed: {0}", e.name + " — " + e.message));
    }
    respond(id, 200, "");
    // Replay the previous list rather than clearing it: a cancelled chooser or a
    // gesture-less re-scan is not evidence that the board went away, and wiping
    // the rows left the dialog blank with no way back.
    WebBLE.repushDiscovered();
  } finally {
    WebBLE.discovering = false;
  }
};

WebBLE.connect = async function(id, robotId) {
  const device = WebBLE.discovered;
  if (device == null) {
    respond(id, 404, "unknown device");
    return;
  }
  // robotId is not required to match device.id exactly: the id travels as an
  // unencoded URL parameter (HttpRequestBuilder.addParam) and this backend's parser
  // turns '+' into a space, which mangles Web Bluetooth's base64 ids. There is only
  // ever one candidate — the one the user picked in the browser's chooser — so that
  // is the one to connect to.
  if (device.id !== robotId) {
    console.warn("[webble] id mismatch (URL round-trip); connecting to the chosen one: " +
      robotId + " vs " + device.id);
  }
  let step = "gatt.connect";
  // Flag the connect as in flight so onDisconnected can discard the late event
  // from the previous link (see the stale-event guard).
  WebBLE.connecting = true;
  WebBLE.device = device;
  try {
    console.log("[webble] connect() pedido: robotId=" + robotId +
      " device.id=" + device.id + " gatt.connected=" + device.gatt.connected);
    const server = await device.gatt.connect();
    console.log("[webble] GATT conectado; buscando servicio UART...");
    step = "getPrimaryService(UART) — ¿el firmware expone Nordic UART?";
    const service = await server.getPrimaryService(WebBLE.UART_SERVICE);
    step = "getCharacteristic(RX)";
    WebBLE.rxChar = await service.getCharacteristic(WebBLE.UART_RX);
    step = "getCharacteristic(TX)";
    WebBLE.txChar = await service.getCharacteristic(WebBLE.UART_TX);
    WebBLE.rxBuf = []; // descartar restos de una conexión anterior
    step = "startNotifications";
    await WebBLE.txChar.startNotifications();
    WebBLE.txChar.addEventListener("characteristicvaluechanged", WebBLE.onNotify);
    // Named handler, not a closure: connect() runs again on every reconnect, and
    // addEventListener only dedupes identical function references. With an
    // anonymous listener each reconnect added another copy, so one disconnect
    // pushed N updateStatus(false) — and DeviceManager starts a fresh discover
    // for each of them.
    device.addEventListener("gattserverdisconnected", WebBLE.onDisconnected);
    WebBLE.connecting = false;
    console.log("[webble] conexión lista");
    respond(id, 200, "");
    WebBLE.pushStatus(device.id, true, "connect() ok");
    pushCallback(function(cb) {
      cb.robot.updateHasV2Microbit(device.id, "true");
    });
    WebBLE.queryFirmware(device.id);
  } catch (e) {
    WebBLE.connecting = false;
    WebBLE.showDiagnostic(t("ble_connect_failed",
      "The connection failed at step [{0}]:\n{1}", step, e.name + " — " + e.message));
    respond(id, 500, e.message);
    pushCallback(function(cb) { cb.robot.connectionFailure(robotId); });
  }
};

/** GET_STATUS after connecting: the real protocol version and the board type. */
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

/**
 * Fails whatever command is waiting for a response. Called when the link drops:
 * otherwise the in-flight promise hangs until its timeout and, worse,
 * WebBLE.command rejects every later command with "busy" until then — including
 * the first command after a successful reconnect.
 */
WebBLE.failPending = function(error) {
  const pending = WebBLE.pendingResponse;
  if (pending != null) {
    clearTimeout(pending.timer);
    WebBLE.pendingResponse = null;
    if (pending.reject != null) {
      pending.reject(error);
    }
  }
  // And whatever is waiting its turn: without this, a command queued when the
  // link drops never settles, because the response that would free the queue is
  // never coming.
  const queued = WebBLE.queue.splice(0, WebBLE.queue.length);
  queued.forEach(function(job) { job.reject(error); });
};

/**
 * Single funnel for every connection-status push, so the console shows the exact
 * order of transitions. Diagnosing "it says disconnected while connected" needs
 * to distinguish who reported what and when.
 */
WebBLE.pushStatus = function(robotId, connected, why) {
  console.log("[webble] estado -> " + (connected ? "CONECTADO" : "DESCONECTADO") +
    "  (" + why + ")  id=" + robotId);
  /* Deferred on purpose. Chrome dispatches gattserverdisconnected synchronously
   * from inside gatt.disconnect(), so a direct push re-entered the editor while
   * it was still midway through DeviceManager.setOneDevice — which disconnects
   * the old link and only then calls newDevice.connect(). The re-entrant status
   * update runs the editor's whole UI/rescan chain from there, and anything that
   * throws in it aborts setOneDevice before the reconnect ever happens: pressing
   * connect on a connected board left it disconnected with no connect() attempt.
   *
   * Yielding first lets the editor finish its own call stack before it hears
   * about the state change. */
  deferCallback(function(cb) { cb.robot.updateStatus(robotId, connected); });
};

/** Tears down the link state and tells the editor. Idempotent. */
WebBLE.handleDisconnect = function(robotId, why) {
  WebBLE.rxChar = null;
  WebBLE.txChar = null;
  WebBLE.rxBuf = [];
  WebBLE.failPending(new Error("disconnected"));
  WebBLE.pushStatus(robotId, false, why || "handleDisconnect");
};

WebBLE.onDisconnected = function(event) {
  const device = event != null && event.target != null ? event.target : WebBLE.device;

  /* Stale-event guard. The editor reconnects by disconnecting the current link
   * and connecting again immediately (DeviceManager.setOneDevice), and Chrome
   * delivers gattserverdisconnected in a later task — routinely *after* the new
   * connection is already live. Running the teardown then wiped the fresh
   * characteristics and reported the robot as disconnected while it was in fact
   * connected: press connect on an already-connected board and it went dead.
   *
   * Two ways to tell a stale event from a real one: a live GATT link on the same
   * device, or a connect still in flight for it. */
  const isCurrent = device != null && device === WebBLE.device;
  const live = device != null && device.gatt != null && device.gatt.connected;
  console.log("[webble] evento gattserverdisconnected: esCurrent=" + isCurrent +
    " gatt.connected=" + live + " connecting=" + WebBLE.connecting);

  if (isCurrent && (live || WebBLE.connecting)) {
    console.log("[webble] stale disconnect from the previous link; ignored");
    return;
  }

  if (device != null && WebBLE.device != null && !isCurrent) {
    // A board we are no longer using dropped: report it, but leave the state of
    // the live link alone.
    WebBLE.pushStatus(device.id, false, "otra placa se desconectó");
    return;
  }
  WebBLE.handleDisconnect(device != null ? device.id : null, "evento GATT");
};

WebBLE.disconnect = function(id) {
  const device = WebBLE.device;
  const live = device != null && device.gatt != null && device.gatt.connected;
  console.log("[webble] disconnect() requested by the editor: device=" +
    (device != null ? device.id : "null") + " gatt.connected=" + live);
  if (live) {
    // Fires gattserverdisconnected, which runs the teardown.
    device.gatt.disconnect();
  } else if (device != null) {
    // Link already down (board powered off, event missed): no event is coming,
    // so confirm the state or the editor keeps showing the robot as connected.
    WebBLE.handleDisconnect(device.id, "disconnect() con link ya caído");
  }
  respond(id, 200, "");
};

/* ------------------------------------------- BLE: the stx_proto.h protocol */

/* Length of each firmware→editor packet, keyed by its first byte (mirrors the
 * firmware's framing: MicroBitUARTService may concatenate or split TX notifications,
 * so the receiving side is a stream too). */
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
  // reassemble whole packets and dispatch them
  while (WebBLE.rxBuf.length > 0) {
    const need = WebBLE.RESP_LEN[WebBLE.rxBuf[0]];
    if (need == null) {
      WebBLE.rxBuf.shift(); // invalid byte: resynchronise
      continue;
    }
    if (WebBLE.rxBuf.length < need) {
      break; // not enough bytes yet
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
  if (pending != null && packet[0] === (pending.cmd | STX.RESP_FLAG) &&
      (pending.seq == null || packet[1] === pending.seq)) {
    clearTimeout(pending.timer);
    WebBLE.pendingResponse = null;
    pending.resolve(packet);
  } else {
    console.log("[webble] respuesta no esperada:", packet);
  }
};

/** Pushed notifications from the firmware (a program running on the board). */
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

/**
 * Command queue. The channel takes one outstanding response at a time, and that
 * used to mean rejecting any command that arrived while another was in flight
 * ("busy"). Since queryFirmware runs loose on connect and can hold the channel
 * for up to 1.5 s (3 attempts × 500 ms when the board does not answer), the
 * child's first send inside that window failed without saying anything.
 *
 * Commands now wait their turn FIFO instead of failing. Serialising them also
 * keeps a command's retry from interleaving with a different command.
 */
WebBLE.queue = [];
WebBLE.sending = false;

/** Writes a packet and waits for its response (cmd | 0x80), with a timeout. */
WebBLE.command = function(packet) {
  return new Promise(function(resolve, reject) {
    WebBLE.queue.push({ packet: packet, resolve: resolve, reject: reject });
    WebBLE.pumpQueue();
  });
};

/** Starts the next queued command if the channel is free. */
WebBLE.pumpQueue = function() {
  if (WebBLE.sending || WebBLE.queue.length === 0) {
    return;
  }
  const job = WebBLE.queue.shift();
  WebBLE.sending = true;
  WebBLE.sendOne(job.packet).then(function(resp) {
    WebBLE.sending = false;
    job.resolve(resp);
    WebBLE.pumpQueue();
  }, function(err) {
    WebBLE.sending = false;
    job.reject(err);
    WebBLE.pumpQueue();
  });
};

/** A single command/response exchange. Do not call directly: go through command(). */
WebBLE.sendOne = function(packet) {
  return new Promise(function(resolve, reject) {
    if (WebBLE.rxChar == null) {
      reject(new Error("not connected"));
      return;
    }
    const timer = setTimeout(function() {
      WebBLE.pendingResponse = null;
      reject(new Error("timeout"));
    }, WebBLE.RESPONSE_TIMEOUT_MS);
    WebBLE.pendingResponse = {
      cmd: packet[0],
      // XFER_CHUNK acks carry the chunk seq. Matching on the cmd byte alone let
      // a late ack from a timed-out attempt satisfy the wait for a *later*
      // chunk, shifting every ack after it by one: chunk N+1 read chunk N's
      // status byte and passed unverified. Only XFER_CHUNK is seq-addressed;
      // every other command has a single outstanding response.
      seq: packet[0] === STX.CMD_XFER_CHUNK ? packet[1] : null,
      resolve: resolve,
      reject: reject,   // so failPending() can cut it short if the link drops
      timer: timer
    };
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

/** Transfers a full STX1 image: BEGIN + chunks + END.
 * options.volatile: do not persist to flash (live mode, no wear). */
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

/** A single immediate STX instruction (live mode). */
WebBLE.liveExec = function(instrBytes) {
  const packet = new Uint8Array(1 + instrBytes.length);
  packet[0] = STX.CMD_LIVE_EXEC;
  packet.set(instrBytes, 1);
  return WebBLE.commandWithRetry(packet);
};

/* ------------------------------------------------------------- file storage
 * Implements the data/* contract documented in README.md ("Overview for backend
 * developers"): data/new and data/open must do more than answer 200 — the backend
 * also has to PUSH CallbackManager.data.open(fileName, data) so that
 * SaveManager.backendOpen() loads the XML and lifts the modal block
 * (GuiElements.dialogBlock). Without that push the editor stays on a grey screen
 * forever (LevelManager.loadLevelSavePoint -> data/new -> data/open never
 * completes). data/autoSave sends no filename, so the open file has to be
 * remembered here (FileStore.currentFile).
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
  FileStore.setItem(FileStore.INDEX_KEY, JSON.stringify(files));
};

FileStore.exists = function(name) {
  return FileStore.listFiles().indexOf(name) >= 0;
};

/**
 * Wraps localStorage writes so a full or blocked store surfaces as a clear error
 * instead of an exception escaping into the editor's call stack. Storage throws in
 * more situations than it looks: quota exhausted, Safari private browsing, a
 * locked-down WKWebView (which is what the Capacitor build will run in).
 */
FileStore.setItem = function(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    const error = new Error(t("host_storage_full",
      "The program could not be saved: the browser storage is full or blocked."));
    error.code = "E_STORAGE";
    error.cause = e;
    throw error;
  }
};

FileStore.write = function(name, content) {
  /* Content first, index second. The other way round, a failed content write left
   * the name listed with nothing behind it: the file showed up in the list and
   * opened empty, which for a child is their work having vanished. This order
   * fails cleanly instead — nothing is listed that cannot be read. */
  FileStore.setItem(FileStore.contentKey(name), content);
  const files = FileStore.listFiles();
  if (files.indexOf(name) < 0) {
    files.push(name);
    FileStore.saveIndex(files);
  }
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

/** Mirrors SaveManager.invalidCharactersFriendly: \/:*?<>|.$ */
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
  FileStore.setItem("fbsetting_" + params.key, params.value);
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
  // The ack alone is not enough: SaveManager.backendOpen — triggered by this push —
  // is what actually loads the XML and lifts GuiElements.dialogBlock.
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
  // Deferred: the editor calls this from inside its own stopDiscover(), right
  // before it runs markStoppedDiscover(). Pushing synchronously re-entered
  // possiblyRescan() while renewDiscoverFn was still set, which could restart a
  // scan the editor was in the middle of tearing down.
  deferCallback(function(cb) { cb.robot.stopDiscover(); });
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
  // mode=live → volatile transfer (RAM, no flash wear);
  // mode=download (or absent) → persisted, and runs standalone after a reset.
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
  // Only useful on a board with motors (Tiny:bit); on the basic one the firmware
  // answers REJECTED and this still returns 200 (tolerant, like stopAll).
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

/* ------------------------------------------------------- live sensors */

/* Sensor blocks poll: every editor tick asks for robot/in. Without a cache that
 * is one BLE round trip per tick, which would saturate the channel and compete
 * with program transfers. One read per window is enough — the blocks react on the
 * order of tenths of a second. */
WebBLE.SENSOR_CACHE_MS = 100;
WebBLE.sensorCache = null;      // {light, sound, buttons, temp}
WebBLE.sensorCacheAt = 0;
WebBLE.sensorLogsLeft = 10;     // calibration log, bounded
WebBLE.warnedNoDistance = false;

/** Reads GET_SENSORS from the board, cached. Returns null if it could not. */
WebBLE.readSensors = async function() {
  const now = Date.now();
  if (WebBLE.sensorCache != null &&
      now - WebBLE.sensorCacheAt < WebBLE.SENSOR_CACHE_MS) {
    return WebBLE.sensorCache;
  }
  const resp = await WebBLE.commandWithRetry(
    new Uint8Array([STX.CMD_GET_SENSORS]));
  if (resp.length < 5) {
    return null;
  }
  // Mirrors read_sensors() in firmware/source/main.cpp
  WebBLE.sensorCache = {
    light: resp[1],
    sound: resp[2],
    buttons: resp[3],
    temp: resp[4]
  };
  WebBLE.sensorCacheAt = now;
  if (WebBLE.sensorLogsLeft > 0) {
    WebBLE.sensorLogsLeft--;
    // Raw AND converted: that is what is needed to calibrate SOUND_DB_FLOOR and
    // SOUND_DB_CEIL in Program/MicrobitSensors.js against a real board.
    console.log("[webble] sensores crudos: luz=" + resp[1] + " sonido=" + resp[2] +
      " botones=" + resp[3] + " temp=" + resp[4] +
      "  → editor: luz=" + MicrobitSensors.toPercent("light", resp[1]) + "%" +
      " sonido=" + MicrobitSensors.toPercent("sound", resp[2]) + "%");
  }
  return WebBLE.sensorCache;
};

/**
 * Translates the sensor the editor asks for into the value it expects, on its
 * 0-100 scale. Returns null when the board does not provide that sensor.
 */
WebBLE.sensorValue = function(sensor, readings) {
  switch (sensor) {
    case "light":
      return MicrobitSensors.toPercent("light", readings.light);
    case "V2sound":
      return MicrobitSensors.toPercent("sound", readings.sound);
    case "temperature":
      return readings.temp;
    case "distance":
      /* The firmware does not send distance: read_sensors() builds
       * [light, sound, buttons, temp]. Until it does, report "obstacle right
       * there" — useless but safe, because the drive-until blocks use continuous
       * motors and saying "path clear" would leave the robot driving forever. */
      if (!WebBLE.warnedNoDistance) {
        WebBLE.warnedNoDistance = true;
        WebBLE.showDiagnostic(t("ble_no_distance_sensor",
          "The drive-until-obstacle block does not work yet: the board firmware " +
          "does not report the ultrasonic distance. The other sensor blocks do work."));
      }
      return MicrobitSensors.DISTANCE_UNAVAILABLE;
    case "isMoving":
      return 0; // the editor tracks this; the board does not report it
    default:
      return null;
  }
};

routes["robot/in"] = function(id, params) {
  WebBLE.readSensors().then(function(readings) {
    if (readings == null) {
      respond(id, 500, "sin lectura");
      return;
    }
    const value = WebBLE.sensorValue(params.sensor, readings);
    if (value == null) {
      console.warn("[webble] sensor no soportado: " + params.sensor);
      respond(id, 500, "sensor no soportado: " + params.sensor);
      return;
    }
    respond(id, 200, String(value));
  }).catch(function(e) {
    respond(id, 500, e.message);
  });
};

/**
 * This function must never throw.
 *
 * The editor calls it synchronously from HtmlServer.sendNativeCall, and the
 * statement that arms the request's timeout comes *after* that call. An exception
 * escaping here therefore does two things at once: it aborts whatever the editor
 * was doing (autoSave runs from SaveManager.markEdited, which runs from
 * BlockMoveManager.end — so dropping a block could abort mid-drop), and it skips
 * the timeout, leaving the request permanently unanswered. unansweredCount then
 * leaks, and after unansweredCap (10) of those CodeManager.checkBroadcastDelay is
 * false forever.
 *
 * Anything can throw down there: localStorage on a full or blocked store, atob on
 * a malformed body, a bad LED pattern. Catching here turns all of it into an
 * ordinary 500 the editor already knows how to handle.
 */
/* ------------------------------------------------- visible errors */

/* Set to false to keep internal errors out of the child's screen (they still go
 * to the console). Worth turning off for a classroom session, on for development. */
WebBLE.SHOW_INTERNAL_ERRORS = true;

WebBLE.reportedErrors = 0;
WebBLE.MAX_REPORTED_ERRORS = 5;

/**
 * Surfaces an internal error. The editor already catches exceptions in every
 * callback (DebugOptions.safeFunc) and POSTs the stack trace to debug/log — but
 * that route was never implemented here, so the traces were answered 200 and
 * dropped, and the error dialog is gated behind a debug flag that ships off.
 * Every swallowed exception was therefore invisible, which is why the bugs in this
 * audit had to be found by hand.
 *
 * The editor's own contracts (DebugOptions.validateNumbers / validateNonNull) are
 * live and throw on a NaN coordinate; wiring this up is what makes them useful.
 * @param {string} origin - where it came from, for the message
 * @param {string} detail - message and stack
 */
WebBLE.reportInternalError = function(origin, detail) {
  console.error("[error] " + origin + "\n" + detail);
  if (!WebBLE.SHOW_INTERNAL_ERRORS) {
    return;
  }
  // Bounded: one broken frame can fire on every repaint, and a banner rewritten
  // hundreds of times a second is worse than no banner.
  WebBLE.reportedErrors++;
  if (WebBLE.reportedErrors > WebBLE.MAX_REPORTED_ERRORS) {
    return;
  }
  const firstLine = String(detail).split("\n")[0];
  WebBLE.showDiagnostic(t("host_internal_error",
    "Internal error ({0}): {1}\nSee the console for the full trace.",
    origin, firstLine));
};

/**
 * Catches what safeFunc cannot: exceptions from timers, event handlers and
 * rejected promises, in the host and in the editor's frame alike. There was no
 * handler of either kind anywhere in the repo.
 * @param {Window} target
 * @param {string} label
 */
WebBLE.installErrorHandlers = function(target, label) {
  if (target == null || target.__smartteamErrorHandlers) {
    return;
  }
  target.__smartteamErrorHandlers = true;
  target.addEventListener("error", function(event) {
    const error = event.error;
    const detail = error != null && error.stack != null
      ? error.stack
      : (event.message || "?") + " @ " + (event.filename || "?") + ":" + event.lineno;
    WebBLE.reportInternalError(label, detail);
  });
  target.addEventListener("unhandledrejection", function(event) {
    const reason = event.reason;
    const detail = reason != null && reason.stack != null
      ? reason.stack
      : String(reason);
    WebBLE.reportInternalError(label + " (promesa)", detail);
  });
};

WebBLE.installErrorHandlers(window, "host");
window.addEventListener("load", function() {
  // The editor runs same-origin, so its window takes handlers directly.
  const frame = document.getElementById("editor");
  if (frame != null) {
    WebBLE.installErrorHandlers(frame.contentWindow, "editor");
  }
});

/** The editor POSTs stack traces here via DebugOptions.safeFunc. */
routes["debug/log"] = function(id, params, body) {
  WebBLE.reportInternalError("editor", body || "(sin traza)");
  respond(id, 200, "");
};

window.parseFinchBloxRequest = function(requestObject) {
  const parsed = parseRequest(requestObject.request);
  const handler = routes[parsed.path];
  if (handler == null) {
    // Routes with no effect on this host (ui/*, sound/*, tablet/*, ...):
    // answering 200 keeps the editor happy, and the warning allows iterating.
    console.warn("[webble] route with no handler: " + requestObject.request);
    respond(requestObject.id, 200, "");
    return;
  }
  try {
    handler(requestObject.id, parsed.params, requestObject.body);
  } catch (e) {
    console.error("[webble] route " + parsed.path + " threw: " + e.message, e);
    WebBLE.showDiagnostic(t("host_request_failed",
      "Something went wrong handling {0}: {1}", parsed.path, e.message));
    respond(requestObject.id, 500, e.message);
  }
};
