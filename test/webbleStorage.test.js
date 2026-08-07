"use strict";

/**
 * File storage and router robustness in the webble/ host.
 *
 * The router is called synchronously from HtmlServer.sendNativeCall, and the
 * statement arming the request timeout comes *after* that call. So an exception
 * escaping the router both aborted whatever the editor was doing and skipped the
 * timeout, leaving the request unanswered forever and leaking unansweredCount —
 * after 10 of those, CodeManager.checkBroadcastDelay is false permanently.
 *
 * autoSave runs from SaveManager.markEdited, which runs from BlockMoveManager.end,
 * so a storage failure while dropping a block could abort the drop.
 */

const test = require("node:test");
const assert = require("node:assert");
const { createHost } = require("./helpers/webbleHost.js");

/** Calls a route the way the editor does and returns the response. */
function request(h, path, body) {
  return new Promise(function(resolve) {
    const win = h.context.document.getElementById("editor").contentWindow;
    const original = win.CallbackManager.httpResponse;
    let settled = false;
    win.CallbackManager.httpResponse = function(id, status, respBody) {
      win.CallbackManager.httpResponse = original;
      settled = true;
      resolve({ status: status, body: respBody });
    };
    h.context.window.parseFinchBloxRequest({ request: path, id: 7, body: body });
    // A route that answers nothing is itself the failure being tested for.
    setTimeout(function() {
      if (!settled) {
        win.CallbackManager.httpResponse = original;
        resolve({ status: null, body: null });
      }
    }, 30);
  });
}

test("a file round-trips through storage", async function() {
  const h = createHost();
  let saved = await request(h, "data/new?filename=mi_programa", "<xml/>");
  assert.strictEqual(saved.status, 200);
  const listed = await request(h, "data/files");
  assert.ok(listed.body.indexOf("mi_programa") >= 0);
});

test("a full store answers 500 instead of throwing", async function() {
  const h = createHost();
  // What a browser does when the quota is exhausted, or when storage is blocked
  // (Safari private browsing, a locked-down WKWebView).
  h.context.localStorage.setItem = function() {
    const err = new Error("The quota has been exceeded.");
    err.name = "QuotaExceededError";
    throw err;
  };

  const res = await request(h, "data/new?filename=mi_programa", "<xml/>");
  assert.strictEqual(res.status, 500,
    "the route must answer, not leave the request hanging");
  // And the failure is visible rather than silent.
  assert.ok(h.diagnostics.some(function(d) {
    return d.indexOf("storage") >= 0 || d.indexOf("almacenamiento") >= 0;
  }), "should surface a diagnostic about storage");
});

test("a failed write never leaves a file listed but empty", async function() {
  const h = createHost();
  const store = {};
  h.context.localStorage.getItem = function(k) {
    return store[k] != null ? store[k] : null;
  };
  // Only the content write fails; the index write would succeed. With the index
  // written first, this is exactly what listed a file with nothing behind it.
  h.context.localStorage.setItem = function(key, value) {
    if (key.indexOf("fbfilecontent_") === 0) {
      throw new Error("quota");
    }
    store[key] = value;
  };

  const res = await request(h, "data/new?filename=perdido", "<xml/>");
  assert.strictEqual(res.status, 500);

  const listed = await request(h, "data/files");
  assert.strictEqual(listed.body.indexOf("perdido"), -1,
    "a file that cannot be read must not appear in the list");
});

test("the router answers even when a route throws for another reason",
  async function() {
    const h = createHost();
    // A malformed base64 body: atob throws inside the transfer route.
    const res = await request(h, "robot/out/program?isVolatile=true", "!!!not base64!!!");
    assert.strictEqual(res.status, 500,
      "the request must settle so its timeout is not skipped");
  });

test("an unknown route still answers 200", async function() {
  const h = createHost();
  // Routes with no effect on this host must not look like failures.
  const res = await request(h, "tablet/availableSensors");
  assert.strictEqual(res.status, 200);
});

test("settings survive a round trip and fail cleanly when storage is blocked",
  async function() {
    const h = createHost();
    let res = await request(h, "settings/set?key=level&value=3");
    assert.strictEqual(res.status, 200);
    res = await request(h, "settings/get?key=level");
    assert.strictEqual(res.body, "3");

    h.context.localStorage.setItem = function() { throw new Error("blocked"); };
    res = await request(h, "settings/set?key=level&value=2");
    assert.strictEqual(res.status, 500);
  });
