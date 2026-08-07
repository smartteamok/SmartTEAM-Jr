"use strict";

/**
 * Firmware response matching in the webble/ host.
 *
 * Responses were identified by their command byte alone. Since XFER_CHUNK carries
 * a sequence number, a late ack from an attempt that had timed out satisfied the
 * wait for the *next* chunk: from there on every chunk read the previous chunk's
 * status byte and passed unverified, and the app reported "transferred" having
 * validated the acks off by one.
 *
 * Also covers the command queue: the channel takes one outstanding response at a
 * time, and that used to mean rejecting anything that arrived meanwhile ("busy").
 */

const test = require("node:test");
const assert = require("node:assert");
const { createHost } = require("./helpers/webbleHost.js");

/**
 * Connects with the board answering normally — so queryFirmware, which runs loose
 * after connect(), closes its GET_STATUS and frees the channel — and only then
 * switches to manual mode. Otherwise that pending command makes the next one
 * queue behind it and the test measures something else.
 */
async function connectedManual() {
  const h = createHost();
  const device = h.makeDevice();
  h.WebBLE.discovered = device;
  await h.WebBLE.connect(null, device.id);
  await h.flush();
  assert.strictEqual(h.WebBLE.pendingResponse, null,
    "the channel must be free before starting");
  // From here responses are injected by hand, to control their order.
  h.WebBLE.rxChar.writeValue = function() { return Promise.resolve(); };
  return h;
}

test("an ack for another seq does not resolve the chunk in flight", async function() {
  const h = await connectedManual();

  let settled = null;
  const pending = h.WebBLE.command(
    new Uint8Array([h.STX.CMD_XFER_CHUNK, 5, 0xAA]));
  pending.then(function(r) { settled = r; }, function(e) { settled = e; });

  assert.strictEqual(h.WebBLE.pendingResponse.seq, 5);

  // A late ack for chunk 4: this used to resolve the wait.
  h.WebBLE.dispatchPacket(
    new Uint8Array([h.STX.CMD_XFER_CHUNK | h.STX.RESP_FLAG, 4, 0]));
  await h.flush(5);
  assert.strictEqual(settled, null, "a seq 4 ack must not resolve seq 5");
  assert.notStrictEqual(h.WebBLE.pendingResponse, null, "the wait stays open");

  // The correct ack.
  h.WebBLE.dispatchPacket(
    new Uint8Array([h.STX.CMD_XFER_CHUNK | h.STX.RESP_FLAG, 5, 0]));
  await h.flush(5);
  assert.ok(settled != null && settled[1] === 5, "the seq 5 ack must resolve");
  assert.strictEqual(h.WebBLE.pendingResponse, null);
});

test("commands without a seq still match on the command byte alone",
  async function() {
    const h = await connectedManual();

    let settled = null;
    h.WebBLE.command(new Uint8Array([h.STX.CMD_RUN]))
      .then(function(r) { settled = r; }, function(e) { settled = e; });

    // Only XFER_CHUNK is seq-addressed; everything else has a single outstanding
    // response.
    assert.strictEqual(h.WebBLE.pendingResponse.seq, null);

    h.WebBLE.dispatchPacket(new Uint8Array([h.STX.CMD_RUN | h.STX.RESP_FLAG, 0]));
    await h.flush(5);
    assert.ok(settled != null &&
      settled[0] === (h.STX.CMD_RUN | h.STX.RESP_FLAG));
  });

test("two concurrent commands serialize instead of failing with 'busy'",
  async function() {
    const h = createHost();
    const device = h.makeDevice();
    h.WebBLE.discovered = device;
    await h.WebBLE.connect(null, device.id);
    await h.flush();

    const order = [];
    const original = h.WebBLE.rxChar.writeValue;
    h.WebBLE.rxChar.writeValue = function(packet) {
      order.push(packet[0]);
      return original.call(this, packet);
    };

    // Issued together, with no await in between: the second used to be rejected
    // with "busy" because a response was already pending.
    const both = await Promise.all([
      h.WebBLE.command(new Uint8Array([h.STX.CMD_GET_STATUS])),
      h.WebBLE.command(new Uint8Array([h.STX.CMD_RUN]))
    ]);

    assert.strictEqual(both[0][0], h.STX.CMD_GET_STATUS | h.STX.RESP_FLAG);
    assert.strictEqual(both[1][0], h.STX.CMD_RUN | h.STX.RESP_FLAG);
    // FIFO: the second is only written once the first has closed.
    assert.deepStrictEqual(order, [h.STX.CMD_GET_STATUS, h.STX.CMD_RUN]);
  });

test("sending a program right after connecting does not fail with 'busy'",
  async function() {
    const h = createHost();
    const device = h.makeDevice();
    h.WebBLE.discovered = device;

    // connect() launches queryFirmware without awaiting it, so the channel is
    // busy on return. No flush: that is exactly the window where sending failed.
    await h.WebBLE.connect(null, device.id);
    assert.notStrictEqual(h.WebBLE.pendingResponse, null,
      "queryFirmware should be holding the channel");
    await assert.doesNotReject(
      h.WebBLE.sendProgram(new Uint8Array(30), { volatile: true }));
  });

test("a full transfer walks chunk by chunk with the right seq", async function() {
  const h = createHost();
  const seqsAcked = [];
  const device = h.makeDevice();
  h.WebBLE.discovered = device;
  await h.WebBLE.connect(null, device.id);
  await h.flush();
  assert.strictEqual(h.WebBLE.pendingResponse, null,
    "queryFirmware must have released the channel");

  // The board answers every write with the seq it received.
  h.WebBLE.rxChar.writeValue = function(packet) {
    const respCmd = packet[0] | h.STX.RESP_FLAG;
    const len = h.WebBLE.RESP_LEN[respCmd] || 2;
    const resp = new Uint8Array(len);
    resp[0] = respCmd;
    if (packet[0] === h.STX.CMD_XFER_CHUNK) {
      resp[1] = packet[1];
      seqsAcked.push(packet[1]);
    }
    setImmediate(function() { h.WebBLE.dispatchPacket(resp); });
    return Promise.resolve();
  };

  const image = new Uint8Array(40);
  await h.WebBLE.sendProgram(image, { volatile: true });

  // No gaps and no repeats: every chunk was confirmed with its own seq.
  assert.deepStrictEqual(seqsAcked,
    seqsAcked.map(function(_, i) { return i; }));
  assert.ok(seqsAcked.length > 1, "the image must split into several chunks");
});
