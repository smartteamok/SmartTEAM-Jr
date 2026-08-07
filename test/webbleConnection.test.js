"use strict";

/**
 * BLE connection lifecycle for the webble/ host.
 *
 * Every case here corresponds to a bug observed against the real board:
 * reconnections that left the robot marked disconnected, commands left hanging
 * when the link dropped, and the device list blanking itself out.
 */

const test = require("node:test");
const assert = require("node:assert");
const { createHost } = require("./helpers/webbleHost.js");

test("does not accumulate disconnect listeners across reconnects", async function() {
  const h = createHost();
  const device = h.makeDevice();
  h.WebBLE.discovered = device;

  for (let i = 0; i < 3; i++) {
    await h.WebBLE.connect(null, device.id);
    await h.flush();
    device.gatt.disconnect();
    await h.flush();
  }

  // With an anonymous listener per connection, a single disconnect emitted N
  // updates and DeviceManager kicked off a scan for each one.
  assert.strictEqual(device.listeners["gattserverdisconnected"].length, 1);
});

test("one disconnect emits exactly one updateStatus(false)", async function() {
  const h = createHost();
  const device = h.makeDevice();
  h.WebBLE.discovered = device;

  await h.WebBLE.connect(null, device.id);
  await h.flush();
  h.statusPushes.length = 0;
  device.gatt.disconnect();
  await h.flush();

  const falses = h.statusPushes.filter(function(p) { return p.connected === false; });
  assert.strictEqual(falses.length, 1);
});

test("does not accumulate notification listeners even when the characteristic is reused",
  async function() {
    const h = createHost();
    const device = h.makeDevice();
    h.WebBLE.discovered = device;

    await h.WebBLE.connect(null, device.id);
    const tx = h.WebBLE.txChar;
    await h.flush();
    device.gatt.disconnect();
    await h.flush();
    await h.WebBLE.connect(null, device.id);
    await h.flush();

    // Chrome caches GATT objects, so a reconnect can hand back the same
    // characteristic. This holds because onNotify is a stable reference.
    assert.strictEqual(tx.listeners.length, 1);
  });

test("a dropped link clears the state and cancels the in-flight command",
  async function() {
    const h = createHost();
    const device = h.makeDevice({ autoRespond: false });
    h.WebBLE.discovered = device;

    await h.WebBLE.connect(null, device.id);
    await h.flush();

    let rejected = null;
    const inFlight = h.WebBLE.command(new Uint8Array([h.STX.CMD_GET_STATUS]));
    inFlight.catch(function(e) { rejected = e; });
    assert.notStrictEqual(h.WebBLE.pendingResponse, null,
      "there should be a command in flight");

    device.gatt.disconnect();
    await h.flush();

    assert.strictEqual(h.WebBLE.rxChar, null);
    assert.strictEqual(h.WebBLE.txChar, null);
    // Without this the promise waited out the full 500 ms timeout, and meanwhile
    // every new command was rejected with "busy".
    assert.strictEqual(h.WebBLE.pendingResponse, null);
    assert.notStrictEqual(rejected, null, "the in-flight command must reject");
  });

test("commands waiting their turn are rejected when the link drops",
  async function() {
    const h = createHost();
    const device = h.makeDevice();
    h.WebBLE.discovered = device;
    await h.WebBLE.connect(null, device.id);
    await h.flush();
    // Only now is the channel free: queryFirmware runs loose after connect() and
    // has to be let finish, or the in-flight command would be its own.
    assert.strictEqual(h.WebBLE.pendingResponse, null);
    h.WebBLE.rxChar.writeValue = function() { return Promise.resolve(); };

    // The first occupies the channel; the second waits its turn.
    const first = h.WebBLE.command(new Uint8Array([h.STX.CMD_GET_STATUS]));
    const queued = h.WebBLE.command(new Uint8Array([h.STX.CMD_RUN]));
    let firstErr = null, queuedErr = null;
    first.catch(function(e) { firstErr = e; });
    queued.catch(function(e) { queuedErr = e; });
    assert.strictEqual(h.WebBLE.queue.length, 1, "the second must be queued");

    device.gatt.disconnect();
    await h.flush();

    // Without draining the queue the waiting command would never settle: the
    // response that would free the channel is never coming.
    assert.notStrictEqual(firstErr, null, "the in-flight one must reject");
    assert.notStrictEqual(queuedErr, null, "so must the queued one");
    assert.strictEqual(h.WebBLE.queue.length, 0);
  });

test("a command after a drop fails with 'not connected', not 'busy'",
  async function() {
    const h = createHost();
    const device = h.makeDevice({ autoRespond: false });
    h.WebBLE.discovered = device;

    await h.WebBLE.connect(null, device.id);
    await h.flush();
    h.WebBLE.command(new Uint8Array([h.STX.CMD_GET_STATUS])).catch(function() {});
    device.gatt.disconnect();
    await h.flush();

    await assert.rejects(
      h.WebBLE.command(new Uint8Array([h.STX.CMD_GET_STATUS])),
      function(e) { return e.message === "not connected"; }
    );
  });

test("disconnect() informs the editor even when the link is already down",
  async function() {
    const h = createHost();
    const device = h.makeDevice();
    h.WebBLE.discovered = device;

    await h.WebBLE.connect(null, device.id);
    await h.flush();
    device.gatt.disconnect();
    await h.flush();

    // Drain the deferred pushes from the steps above before measuring.
    await h.flush();
    h.statusPushes.length = 0;
    h.WebBLE.disconnect(null);
    await h.flush();

    // With no event coming, the editor would keep showing the robot connected.
    const falses = h.statusPushes.filter(function(p) { return p.connected === false; });
    assert.strictEqual(falses.length, 1);
  });

/* The editor's flow when a robot is picked: DeviceManager.setOneDevice
 * disconnects the current link and reconnects immediately, without waiting for
 * anything. Both event delivery orders are exercised because the bug only shows
 * up in one of them. */
[false, true].forEach(function(dispatchSync) {
  const label = dispatchSync ? "synchronous event (real Chrome)" : "asynchronous event";

  test("reconnecting while already connected leaves the robot connected — " + label,
    async function() {
      const h = createHost();
      const device = h.makeDevice({ dispatchSync: dispatchSync });
      h.WebBLE.discovered = device;

      await h.WebBLE.connect(null, device.id);
      await h.flush();
      h.statusPushes.length = 0;
      h.reentry.detected = false;

      h.reentry.busy = true;                                  // enters setOneDevice
      h.WebBLE.disconnect(null);                              // step 1
      const connecting = h.WebBLE.connect(null, device.id);   // step 2
      h.reentry.busy = false;                                 // end of sync stack
      await connecting;
      await h.flush(30);

      const last = h.statusPushes[h.statusPushes.length - 1];
      assert.ok(last != null && last.connected === true,
        "the last state must be connected, got: " +
        JSON.stringify(h.statusPushes));
      assert.notStrictEqual(h.WebBLE.rxChar, null,
        "the characteristics must stay alive");
      assert.notStrictEqual(h.WebBLE.txChar, null);
      // The root cause: pushing inside the editor's stack aborted setOneDevice
      // before newDevice.connect().
      assert.strictEqual(h.reentry.detected, false,
        "the status push must not re-enter the editor on its own stack");
    });
});

test("an automatic gesture-less rescan does not blank the device list",
  async function() {
    const h = createHost();
    const device = h.makeDevice();
    h.context.navigator.bluetooth.getAvailability = function() {
      return Promise.resolve(true);
    };

    // A real discover: the user picked the board in the chooser.
    h.context.navigator.bluetooth.requestDevice = function() {
      return Promise.resolve(device);
    };
    await h.WebBLE.discover(null);
    await h.flush();
    assert.strictEqual(h.discoveredPushes[h.discoveredPushes.length - 1].length, 1);

    /* Now the rescan the editor fires on its own. requestDevice needs a user
     * gesture; without one it throws SecurityError. Clearing the list there left
     * the dialog blank with no way back. */
    h.discoveredPushes.length = 0;
    h.context.navigator.bluetooth.requestDevice = function() {
      const err = new Error("Must be handling a user gesture to show a permission request.");
      err.name = "SecurityError";
      return Promise.reject(err);
    };
    await h.WebBLE.discover(null);
    await h.flush();

    const list = h.discoveredPushes[h.discoveredPushes.length - 1];
    assert.ok(list != null && list.length === 1,
      "the board must stay in the list, got: " + JSON.stringify(list));
  });

test("cancelling the chooser does not blank the device list", async function() {
  const h = createHost();
  const device = h.makeDevice();
  h.context.navigator.bluetooth.getAvailability = function() {
    return Promise.resolve(true);
  };
  h.context.navigator.bluetooth.requestDevice = function() {
    return Promise.resolve(device);
  };
  await h.WebBLE.discover(null);
  await h.flush();

  h.discoveredPushes.length = 0;
  h.context.navigator.bluetooth.requestDevice = function() {
    const err = new Error("User cancelled the requestDevice() chooser.");
    err.name = "NotFoundError";
    return Promise.reject(err);
  };
  await h.WebBLE.discover(null);
  await h.flush();

  const list = h.discoveredPushes[h.discoveredPushes.length - 1];
  assert.ok(list != null && list.length === 1);
});
