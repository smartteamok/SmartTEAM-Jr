"use strict";

/**
 * Internal errors have to be visible.
 *
 * The editor wraps every callback in a try/catch (DebugOptions.safeFunc) and POSTs
 * the stack trace to debug/log. That route was never implemented in this host, so
 * traces were answered 200 and dropped, and the error dialog is gated behind a
 * debug flag that ships off. Every swallowed exception was therefore invisible —
 * which is why the bugs in this audit had to be found by hand.
 *
 * Nothing anywhere handled window errors or rejected promises either, so anything
 * thrown from a timer or a promise vanished too.
 */

const test = require("node:test");
const assert = require("node:assert");
const { createHost } = require("./helpers/webbleHost.js");

function request(h, path, body) {
  return new Promise(function(resolve) {
    const win = h.context.document.getElementById("editor").contentWindow;
    const original = win.CallbackManager.httpResponse;
    win.CallbackManager.httpResponse = function(id, status) {
      win.CallbackManager.httpResponse = original;
      resolve(status);
    };
    h.context.window.parseFinchBloxRequest({ request: path, id: 3, body: body });
  });
}

test("a trace POSTed to debug/log is surfaced", async function() {
  const h = createHost();
  const status = await request(h, "debug/log",
    "Invalid Number 0: NaN\n    at BlockIcon.move (BlockIcon.js:80)");
  assert.strictEqual(status, 200, "the route must answer");
  assert.ok(h.diagnostics.some(function(d) {
    return d.indexOf("Invalid Number") >= 0;
  }), "the trace must reach the banner, got: " + JSON.stringify(h.diagnostics));
});

test("an uncaught window error is surfaced", function() {
  const h = createHost();
  h.fireWindowEvent("error", {
    error: new Error("boom"),
    message: "boom",
    filename: "Whatever.js",
    lineno: 42
  });
  assert.ok(h.diagnostics.some(function(d) { return d.indexOf("boom") >= 0; }));
});

test("a window error without an Error object still reports something", function() {
  // Cross-origin scripts arrive with no error object, only the event fields.
  const h = createHost();
  h.fireWindowEvent("error", {
    error: null, message: "Script error", filename: "Foo.js", lineno: 7
  });
  assert.ok(h.diagnostics.some(function(d) { return d.indexOf("Script error") >= 0; }));
});

test("a rejected promise is surfaced", function() {
  const h = createHost();
  h.fireWindowEvent("unhandledrejection", { reason: new Error("nadie la esperaba") });
  assert.ok(h.diagnostics.some(function(d) {
    return d.indexOf("nadie la esperaba") >= 0;
  }));
});

test("reporting is bounded so a repainting error cannot flood the banner",
  function() {
    const h = createHost();
    for (let i = 0; i < 50; i++) {
      h.fireWindowEvent("error", { error: new Error("error " + i), message: "x" });
    }
    assert.ok(h.diagnostics.length <= h.WebBLE.MAX_REPORTED_ERRORS,
      "showed " + h.diagnostics.length + " banners");
  });

test("SHOW_INTERNAL_ERRORS off keeps them off screen but still logs", function() {
  // The switch for a classroom session.
  const h = createHost();
  h.WebBLE.SHOW_INTERNAL_ERRORS = false;
  h.fireWindowEvent("error", { error: new Error("silencioso"), message: "x" });
  assert.strictEqual(h.diagnostics.length, 0);
});

test("handlers are installed once per window", function() {
  const h = createHost();
  const before = h.diagnostics.length;
  // Installing again must not double every future report.
  h.WebBLE.installErrorHandlers(h.context.window, "host");
  h.fireWindowEvent("error", { error: new Error("una sola vez"), message: "x" });
  assert.strictEqual(h.diagnostics.length, before + 1);
});
