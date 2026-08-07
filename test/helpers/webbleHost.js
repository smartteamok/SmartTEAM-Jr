"use strict";

/**
 * Loads webble/backend.js in a stubbed browser environment so it can be tested
 * under Node. The backend is written for a browser: it reaches for `document`,
 * `navigator.bluetooth`, and an iframe holding the editor, and it talks to a
 * micro:bit over BLE. All of that is faked here so the real file runs unmodified.
 *
 * Not a mock of the backend — the backend is the code under test. What is faked
 * is everything around it.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

/**
 * Fake BLE board.
 *
 * `dispatchSync` mirrors what Chrome actually does, verified against the app's
 * own logs: gattserverdisconnected is dispatched SYNCHRONOUSLY from inside
 * gatt.disconnect(), not queued as a task the way the spec suggests. The
 * re-entrancy bug that broke reconnection only reproduces in that order, so
 * tests exercise both.
 *
 * `autoRespond` makes the board answer commands like the firmware does
 * (cmd | RESP_FLAG, with the lengths WebBLE.RESP_LEN declares). Turn it off to
 * inject responses by hand.
 */
function makeDevice(WebBLE, STX, opts) {
  const options = opts || {};
  const listeners = {};
  const chars = {};

  function makeChar(uuid) {
    if (chars[uuid]) {
      return chars[uuid];
    }
    const charListeners = [];
    chars[uuid] = {
      uuid: uuid,
      listeners: charListeners,
      writeValue: function(packet) {
        if (options.autoRespond !== false && uuid === WebBLE.UART_RX &&
            device.gatt.connected) {
          const respCmd = packet[0] | STX.RESP_FLAG;
          const len = WebBLE.RESP_LEN[respCmd] || 2;
          const resp = new Uint8Array(len);
          resp[0] = respCmd;
          if (packet[0] === STX.CMD_XFER_CHUNK) {
            resp[1] = packet[1];
          }
          setImmediate(function() {
            if (device.gatt.connected) {
              WebBLE.dispatchPacket(resp);
            }
          });
        }
        return Promise.resolve();
      },
      startNotifications: function() { return Promise.resolve(); },
      // addEventListener dedupes identical (type, listener) pairs, like the DOM.
      addEventListener: function(type, fn) {
        if (!charListeners.includes(fn)) {
          charListeners.push(fn);
        }
      },
      removeEventListener: function(type, fn) {
        const i = charListeners.indexOf(fn);
        if (i >= 0) {
          charListeners.splice(i, 1);
        }
      }
    };
    return chars[uuid];
  }

  const device = {
    id: options.id || "fake-board",
    name: options.name || "BBC micro:bit [fake]",
    listeners: listeners,
    gatt: {
      connected: false,
      dispatchSync: options.dispatchSync === true,
      connect: function() {
        this.connected = true;
        return Promise.resolve({
          getPrimaryService: function() {
            return Promise.resolve({
              getCharacteristic: function(uuid) {
                return Promise.resolve(makeChar(uuid));
              }
            });
          }
        });
      },
      disconnect: function() {
        this.connected = false;
        const fire = function() {
          (listeners["gattserverdisconnected"] || []).forEach(function(fn) {
            fn({ target: device });
          });
        };
        if (this.dispatchSync) {
          fire();
        } else {
          setImmediate(fire);
        }
      }
    },
    addEventListener: function(type, fn) {
      if (!listeners[type]) {
        listeners[type] = [];
      }
      if (!listeners[type].includes(fn)) {
        listeners[type].push(fn);
      }
    },
    removeEventListener: function(type, fn) {
      const list = listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) {
        list.splice(i, 1);
      }
    }
  };
  return device;
}

/** Builds a fresh host. Each test gets its own, so state never leaks between them. */
function createHost() {
  const statusPushes = [];
  const discoveredPushes = [];
  const diagnostics = [];
  /* busy=true marks "the editor is still inside its own synchronous call". A
   * status callback arriving then is re-entrant, which is what aborted
   * DeviceManager.setOneDevice before it reached newDevice.connect(). */
  const reentry = { busy: false, detected: false };
  const elements = {};   // id -> elemento, para getElementById

  const editorWindow = {
    CallbackManager: {
      httpResponse: function() {},
      robot: new Proxy({}, {
        get: function(target, key) {
          return function(a, b) {
            if (key === "updateStatus") {
              if (reentry.busy) {
                reentry.detected = true;
              }
              statusPushes.push({ id: a, connected: b });
            }
            if (key === "discovered") {
              discoveredPushes.push(JSON.parse(a));
            }
          };
        }
      })
    }
  };

  const context = {
    console: { log: function() {}, warn: function() {}, error: function() {} },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    atob: function(s) { return Buffer.from(s, "base64").toString("binary"); },
    btoa: function(s) { return Buffer.from(s, "binary").toString("base64"); },
    /* Minimal DOM with a registry by id. Genuinely needed: showDiagnostic looks
     * its banner up by id, and if getElementById returns something for every id
     * (instead of null the first time) the code believes the banner already
     * exists and blows up touching properties it never created. */
    document: {
      getElementById: function(id) {
        if (id === "editor") {
          return { contentWindow: editorWindow };
        }
        return elements[id] || null;
      },
      createElement: function() {
        return {
          style: {},
          children: [],
          text: "",
          onclick: null,
          appendChild: function(child) { this.children.push(child); },
          remove: function() {
            if (this.elementId != null) { delete elements[this.elementId]; }
          },
          set id(value) { this.elementId = value; elements[value] = this; },
          get id() { return this.elementId; },
          set textContent(value) {
            this.text = value;
            // The banner text only; not the "×" nor the button label.
            if (this.elementId === "webble-diagnostic-text") {
              diagnostics.push(value);
            }
          },
          get textContent() { return this.text; }
        };
      },
      body: { appendChild: function() {} }
    },
    navigator: { bluetooth: {} },
    isSecureContext: true,
    location: { origin: "http://127.0.0.1:8123" },
    /* A working in-memory localStorage, not a no-op: the storage routes are worth
     * exercising for real, and a test can still replace setItem to simulate a full
     * or blocked store. */
    localStorage: (function() {
      const store = {};
      return {
        store: store,
        getItem: function(key) {
          return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
        },
        setItem: function(key, value) { store[key] = String(value); },
        removeItem: function(key) { delete store[key]; }
      };
    })(),
    module: { exports: {} }
  };
  /* The host installs global error handlers at load time, so the stubbed window
   * needs the listener API. Handlers are kept so a test can fire them. */
  const windowListeners = {};
  context.addEventListener = function(type, fn) {
    if (windowListeners[type] == null) {
      windowListeners[type] = [];
    }
    windowListeners[type].push(fn);
  };
  context.removeEventListener = function(type, fn) {
    const list = windowListeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) {
      list.splice(i, 1);
    }
  };
  context.window = context;
  vm.createContext(context);

  const load = function(relPath) {
    context.module = { exports: {} };
    vm.runInContext(fs.readFileSync(path.join(ROOT, relPath), "utf8"), context,
      { filename: relPath });
  };
  load("Program/STXConstants.js");
  load("Program/MicrobitSensors.js");
  load("Program/BytecodeAssembler.js");
  load("webble/backend.js");

  // backend.js declares `const WebBLE`, which does not become a property of the
  // context; pull it out of the global lexical scope, which persists across
  // runInContext calls on the same context.
  vm.runInContext("globalThis.__WebBLE = WebBLE; globalThis.__STX = STX;", context);

  const WebBLE = context.__WebBLE;
  const STX = context.__STX;

  return {
    WebBLE: WebBLE,
    STX: STX,
    /** Fires a window-level event, for the global error handlers. */
    fireWindowEvent: function(type, event) {
      (windowListeners[type] || []).forEach(function(fn) { fn(event); });
    },
    MicrobitSensors: context.MicrobitSensors,
    /** A GET_SENSORS response with the raw bytes the firmware assembles. */
    sensorResponse: function(light, sound, buttons, temp) {
      return new Uint8Array([STX.CMD_GET_SENSORS | STX.RESP_FLAG,
        light, sound, buttons, temp]);
    },
    context: context,
    statusPushes: statusPushes,
    discoveredPushes: discoveredPushes,
    diagnostics: diagnostics,
    reentry: reentry,
    makeDevice: function(opts) { return makeDevice(WebBLE, STX, opts); },
    /** Lets deferred callbacks (deferCallback / setTimeout 0) run. */
    flush: function(ms) {
      return new Promise(function(resolve) { setTimeout(resolve, ms || 20); });
    }
  };
}

module.exports = { createHost: createHost };
