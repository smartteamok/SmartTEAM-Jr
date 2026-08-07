"use strict";

/**
 * Every error the child can hit must have a real message.
 *
 * The compiler reports failures as codes, and ProgramModeManager maps each code to a
 * translation key. Nothing tied the two together: adding a code to the compiler and
 * forgetting the key leaves the child looking at "The program could not be prepared
 * (E_WHATEVER)" — technically handled, practically useless. Same for a key that
 * exists in one language only, which silently falls back and mixes languages.
 *
 * These tests walk the real sources so they fail when the sets drift apart, instead
 * of relying on someone remembering to add a case here.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function dictionaryKeys(rel) {
  const found = new Set();
  const re = /^\s*"([^"]+)"\s*:/gm;
  let m;
  const src = read(rel);
  while ((m = re.exec(src)) !== null) {
    found.add(m[1]);
  }
  return found;
}

/** Error codes the compiler and the assembler can actually produce. */
function emittedCodes() {
  const sources = [
    read("Program/ProgramCompiler.js"),
    read("Program/BytecodeAssembler.js")
  ].join("\n");
  const codes = new Set();
  // errors.push({ code: "E_..." }) and BytecodeAssembler.error("E_...")
  const re = /\b(?:code:\s*|error\()\s*"(E_[A-Z_]+)"/g;
  let m;
  while ((m = re.exec(sources)) !== null) {
    codes.add(m[1]);
  }
  return codes;
}

/** code -> translation key, read out of ProgramModeManager.ERROR_KEYS. */
function mappedCodes() {
  const src = read("Program/ProgramModeManager.js");
  const block = /ERROR_KEYS\s*=\s*\{([\s\S]*?)\}/.exec(src);
  assert.ok(block != null, "ProgramModeManager.ERROR_KEYS not found");
  const map = {};
  const re = /(E_[A-Z_]+)\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

test("the compiler emits at least the codes we know about", function() {
  // Guards the regexes above: if they stop matching, the other tests would pass
  // vacuously.
  const codes = emittedCodes();
  assert.ok(codes.size >= 5, "only found: " + [...codes].join(", "));
  ["E_EMPTY", "E_UNSUPPORTED_BLOCK", "E_TOO_MANY_STACKS"].forEach(function(code) {
    assert.ok(codes.has(code), code + " should be detected as emitted");
  });
});

test("every emitted error code maps to a translation key", function() {
  const mapped = mappedCodes();
  const missing = [...emittedCodes()].filter(function(code) {
    return mapped[code] == null;
  });
  /* E_ASSEMBLE is deliberately absent: ProgramModeManager builds it as a catch-all
   * for an assembler throw and falls back to the generic message with the code. */
  const allowed = new Set(["E_ASSEMBLE", "E_BAD_TRIGGER", "E_BAD_COND", "E_BAD_OP",
    "E_BAD_MARK"]);
  const unexplained = missing.filter(function(c) { return !allowed.has(c); });
  assert.deepStrictEqual(unexplained, [],
    "these codes would reach the child as a bare code: " + unexplained.join(", "));
});

test("every mapped key exists in both languages", function() {
  const en = dictionaryKeys("Language/Language.en.js");
  const es = dictionaryKeys("Language/Language.es.js");
  const mapped = mappedCodes();
  Object.keys(mapped).forEach(function(code) {
    const key = mapped[code];
    assert.ok(en.has(key), code + " -> " + key + " missing from English");
    assert.ok(es.has(key), code + " -> " + key + " missing from Spanish");
  });
});

test("the generic fallback message exists too", function() {
  // The path taken by a code with no mapping of its own.
  const en = dictionaryKeys("Language/Language.en.js");
  const es = dictionaryKeys("Language/Language.es.js");
  ["program_error_generic", "program_fault"].forEach(function(key) {
    assert.ok(en.has(key), key + " missing from English");
    assert.ok(es.has(key), key + " missing from Spanish");
  });
});

test("every key the host asks for exists in both languages", function() {
  // webble/backend.js carries an English fallback inline, so a missing key degrades
  // quietly to English instead of failing — which is exactly why it needs a test.
  const src = read("webble/backend.js");
  const keys = new Set();
  const re = /\bt\(\s*"([a-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    keys.add(m[1]);
  }
  assert.ok(keys.size >= 8, "only found: " + [...keys].join(", "));

  const en = dictionaryKeys("Language/Language.en.js");
  const es = dictionaryKeys("Language/Language.es.js");
  keys.forEach(function(key) {
    assert.ok(en.has(key), key + " missing from English");
    assert.ok(es.has(key), key + " missing from Spanish");
  });
});

test("keys used by the editor's SmartTEAM code exist in both languages", function() {
  const sources = [
    read("Program/ProgramModeManager.js"),
    read("UndoManager.js"),
    read("SaveManager.js")
  ].join("\n");
  const keys = new Set();
  const re = /Language\.(?:getStr|format)\(\s*"([a-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(sources)) !== null) {
    keys.add(m[1]);
  }
  const en = dictionaryKeys("Language/Language.en.js");
  const es = dictionaryKeys("Language/Language.es.js");
  keys.forEach(function(key) {
    assert.ok(en.has(key), key + " missing from English");
    assert.ok(es.has(key), key + " missing from Spanish");
  });
});
