"use strict";

/**
 * Language selection and dictionary coverage.
 *
 * The frontend was originally told the system language by its native backend
 * (CallbackManager.tablet.getLanguage). Running as a plain web page there is no
 * backend to do that, so Language.lang silently stayed "en" and the whole
 * inherited UI rendered in English regardless of the browser.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

/**
 * Loads Language/ into a context with a stubbed navigator and sessionStorage, so
 * the selection logic can be exercised without a browser.
 */
function loadLanguage(options) {
  const opts = options || {};
  const context = {
    console: { log: function() {} },
    navigator: {
      language: opts.language,
      languages: opts.languages
    },
    sessionStorage: {
      getItem: function() {
        if (opts.throwOnStorage) {
          throw new Error("storage blocked");
        }
        return opts.stored != null ? opts.stored : null;
      },
      setItem: function() {}
    },
    DebugOptions: { enabled: false }
  };
  context.window = context;
  vm.createContext(context);
  ["Language/Language.js", "Language/Language.en.js", "Language/Language.es.js"]
    .forEach(function(file) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context,
        { filename: file });
    });
  vm.runInContext("globalThis.__Language = Language;", context);
  return context.__Language;
}

test("follows the browser language", function() {
  const L = loadLanguage({ language: "es-AR" });
  assert.strictEqual(L.applyPreferred(), "es");
});

test("falls back to English for an unsupported language", function() {
  const L = loadLanguage({ language: "is-IS" });
  assert.strictEqual(L.applyPreferred(), "en");
});

test("Language.FORCE overrides the browser", function() {
  // The knob for testing another language without touching anything else.
  const L = loadLanguage({ language: "es-AR" });
  L.FORCE = "en";
  assert.strictEqual(L.applyPreferred(), "en");
  L.FORCE = null;
  assert.strictEqual(L.applyPreferred(), "es");
});

test("FORCE outranks a language stored for the session", function() {
  const L = loadLanguage({ language: "en-US", stored: "pt" });
  assert.strictEqual(L.applyPreferred(), "pt");
  L.FORCE = "es";
  assert.strictEqual(L.applyPreferred(), "es");
});

test("an invalid FORCE is ignored rather than breaking the UI", function() {
  const L = loadLanguage({ language: "es-AR" });
  L.FORCE = "klingon";
  assert.strictEqual(L.applyPreferred(), "es");
});

test("prefers the first supported entry of navigator.languages", function() {
  const L = loadLanguage({ languages: ["is-IS", "pt-BR", "es-AR"], language: "is-IS" });
  assert.strictEqual(L.applyPreferred(), "pt");
});

test("survives sessionStorage throwing", function() {
  // A locked-down origin makes sessionStorage throw; that must not stop startup.
  const L = loadLanguage({ language: "es-AR", throwOnStorage: true });
  assert.strictEqual(L.applyPreferred(), "es");
});

test("normalises regional and script tags", function() {
  const L = loadLanguage({});
  assert.strictEqual(L.normalize("es-AR"), "es");
  assert.strictEqual(L.normalize("pt_BR"), "pt");
  assert.strictEqual(L.normalize("zh-Hant"), "zht");
  assert.strictEqual(L.normalize("zh-Hans"), "zhs");
  assert.strictEqual(L.normalize("zh_TW"), "zht");
  assert.strictEqual(L.normalize("xx"), null);
  assert.strictEqual(L.normalize(null), null);
});

test("format substitutes positional placeholders", function() {
  const L = loadLanguage({ language: "en-US" });
  L.applyPreferred();
  // The value stays out of the translated text so translators do not have to
  // rebuild the sentence around it.
  assert.strictEqual(L.format("program_fault", 3),
    "The program stopped because of an error (code 3)");
  assert.ok(L.format("program_error_generic", "E_WAT").indexOf("E_WAT") >= 0);
});

test("the SmartTEAM messages are translated, not hardcoded", function() {
  const en = loadLanguage({ language: "en-US" });
  en.applyPreferred();
  const es = loadLanguage({ language: "es-AR" });
  es.applyPreferred();

  ["program_error_empty", "program_error_too_many_stacks", "program_fault",
   "ble_no_web_bluetooth", "ble_no_distance_sensor"].forEach(function(key) {
    const a = en.getStr(key);
    const b = es.getStr(key);
    assert.notStrictEqual(a, "Translation required", key + " missing in English");
    assert.notStrictEqual(b, "Translation required", key + " missing in Spanish");
    assert.notStrictEqual(a, b, key + " is identical in both languages");
  });
});

test("a missing key reports it instead of returning something else", function() {
  const L = loadLanguage({ language: "es-AR" });
  L.applyPreferred();
  assert.strictEqual(L.getStr("no_existe_esta_clave"), "Translation required");
});

test("inherited properties are not mistaken for translations", function() {
  // getStr used to build and eval "Language.es." + key, so a key naming something
  // on Object.prototype came back as a function instead of a missing translation.
  const L = loadLanguage({ language: "es-AR" });
  L.applyPreferred();
  ["constructor", "toString", "hasOwnProperty", "__proto__"].forEach(function(key) {
    assert.strictEqual(L.getStr(key), "Translation required", key);
  });
});

test("a key that is not a valid identifier does not blow up", function() {
  // The eval threw SyntaxError on anything with a dash in it.
  const L = loadLanguage({ language: "es-AR" });
  L.applyPreferred();
  assert.doesNotThrow(function() { L.getStr("con-guion"); });
  assert.strictEqual(L.getStr("con-guion"), "Translation required");
});

test("English and Spanish dictionaries have the same keys", function() {
  // A key present in only one language silently falls back, so the UI ends up
  // mixing languages.
  const keysOf = function(file) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const found = new Set();
    const re = /^\s*"([^"]+)"\s*:/gm;
    let m;
    while ((m = re.exec(src)) !== null) {
      found.add(m[1]);
    }
    return found;
  };
  const en = keysOf("Language/Language.en.js");
  const es = keysOf("Language/Language.es.js");
  const missingEs = [...en].filter(function(k) { return !es.has(k); });
  const missingEn = [...es].filter(function(k) { return !en.has(k); });
  assert.deepStrictEqual(missingEs, [], "keys missing from Spanish");
  assert.deepStrictEqual(missingEn, [], "keys missing from English");
});
