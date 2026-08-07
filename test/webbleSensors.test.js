"use strict";

/**
 * Live sensor reads (the robot/in route).
 *
 * It used to be a stub returning a fixed "0", and every sensor block reads
 * through it in live mode. With 0: "start when dark" fired constantly, "start
 * when clap" never fired, and the drive-until blocks stopped before moving.
 */

const test = require("node:test");
const assert = require("node:assert");
const { createHost } = require("./helpers/webbleHost.js");

/**
 * A connected host whose board answers GET_SENSORS with the given bytes and
 * counts how many times it was asked.
 */
async function withSensors(light, sound, buttons, temp) {
  const h = createHost();
  const device = h.makeDevice();
  h.WebBLE.discovered = device;
  await h.WebBLE.connect(null, device.id);
  await h.flush();

  h.reads = 0;
  h.WebBLE.rxChar.writeValue = function(packet) {
    const respCmd = packet[0] | h.STX.RESP_FLAG;
    let resp;
    if (packet[0] === h.STX.CMD_GET_SENSORS) {
      h.reads++;
      resp = h.sensorResponse(light, sound, buttons, temp);
    } else {
      resp = new Uint8Array(h.WebBLE.RESP_LEN[respCmd] || 2);
      resp[0] = respCmd;
    }
    setImmediate(function() { h.WebBLE.dispatchPacket(resp); });
    return Promise.resolve();
  };
  return h;
}

/** Calls the route the way the editor does and returns the response body. */
function readSensor(h, sensor) {
  return new Promise(function(resolve) {
    const win = h.context.document.getElementById("editor").contentWindow;
    const original = win.CallbackManager.httpResponse;
    win.CallbackManager.httpResponse = function(id, status, body) {
      win.CallbackManager.httpResponse = original;
      resolve({ status: status, body: body });
    };
    h.context.window.parseFinchBloxRequest({
      request: "robot/in?sensor=" + sensor, id: 1, body: null
    });
  });
}

test("light reaches the editor as a percentage, not the raw scale",
  async function() {
    // 128/255 ≈ 50%. This route used to answer "0" no matter what.
    const h = await withSensors(128, 60, 0, 22);
    const res = await readSensor(h, "light");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body, "50");
  });

test("real darkness yields a low percentage, full light a high one",
  async function() {
    const dark = await withSensors(4, 60, 0, 22);
    assert.strictEqual((await readSensor(dark, "light")).body, "2");

    const bright = await withSensors(255, 60, 0, 22);
    assert.strictEqual((await readSensor(bright, "light")).body, "100");
  });

test("sound uses the dB-to-percentage mapping", async function() {
  const floor = createHost().MicrobitSensors.SOUND_DB_FLOOR;
  const quiet = await withSensors(128, floor, 0, 22);
  assert.strictEqual((await readSensor(quiet, "V2sound")).body, "0");

  // A clap has to clear the threshold of 50 the editor compares against.
  const clap = await withSensors(128, 90, 0, 22);
  const value = Number((await readSensor(clap, "V2sound")).body);
  assert.ok(value > 50, "a 90 dB clap should exceed 50%, got " + value);
});

test("distance reports 'obstacle right there' while the firmware sends none",
  async function() {
    /* Deliberately 0: the drive-until blocks use continuous motors, so reporting
     * "path clear" would leave the robot driving indefinitely. */
    const h = await withSensors(128, 60, 0, 22);
    const res = await readSensor(h, "distance");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body, "0");
    // And it says so once, so the block does not fail silently. The text is the
    // English fallback here: the harness has no editor to translate through.
    assert.ok(h.diagnostics.some(function(d) {
      return d.indexOf("ultrasonic") >= 0;
    }), "should surface a diagnostic about the distance sensor");
  });

test("an unknown sensor errors instead of inventing a value", async function() {
  const h = await withSensors(128, 60, 0, 22);
  const res = await readSensor(h, "encoder");
  assert.strictEqual(res.status, 500);
});

test("reads are cached so the BLE channel is not saturated", async function() {
  // The blocks poll every tick: without a cache that is one BLE round trip per
  // tick.
  const h = await withSensors(128, 60, 0, 22);
  await readSensor(h, "light");
  await readSensor(h, "light");
  await readSensor(h, "V2sound");
  assert.strictEqual(h.reads, 1,
    "three consecutive reads should resolve with a single query");
});
