"use strict";

/**
 * Sensor scale conversion.
 *
 * The editor comes from the Finch robot (0-100 sensors) and its thresholds are
 * written as percentages. The micro:bit reports on different native scales and
 * nothing converted, so "start when dark" with a threshold of 5 compared against
 * 5/255 ≈ 2% light instead of 5%.
 */

const test = require("node:test");
const assert = require("node:assert");
const MicrobitSensors = require("../Program/MicrobitSensors.js");

test("light round-trips between 0-255 and a percentage", function() {
  assert.strictEqual(MicrobitSensors.toPercent("light", 0), 0);
  assert.strictEqual(MicrobitSensors.toPercent("light", 255), 100);
  assert.strictEqual(MicrobitSensors.toPercent("light", 128), 50);
  // The threshold the editor actually uses: 5% of 255.
  assert.strictEqual(MicrobitSensors.fromPercent("light", 5), 13);
  assert.strictEqual(MicrobitSensors.fromPercent("light", 100), 255);
  assert.strictEqual(MicrobitSensors.fromPercent("light", 0), 0);
});

test("sound maps the useful dB range onto a percentage", function() {
  const floor = MicrobitSensors.SOUND_DB_FLOOR;
  const ceil = MicrobitSensors.SOUND_DB_CEIL;
  assert.strictEqual(MicrobitSensors.toPercent("sound", floor), 0);
  assert.strictEqual(MicrobitSensors.toPercent("sound", ceil), 100);
  // Round-trip across the editor's clap threshold.
  const raw = MicrobitSensors.fromPercent("sound", 50);
  assert.ok(raw > floor && raw < ceil);
  assert.strictEqual(MicrobitSensors.toPercent("sound", raw), 50);
});

test("out-of-range values clamp instead of overflowing", function() {
  // A sound byte below the floor would go negative without the clamp, and the VM
  // reads a uint8: a negative would turn into an enormous threshold.
  assert.strictEqual(MicrobitSensors.toPercent("sound", 0), 0);
  assert.strictEqual(MicrobitSensors.toPercent("light", 999), 100);
  assert.strictEqual(MicrobitSensors.fromPercent("light", 500), 255);
  assert.strictEqual(MicrobitSensors.fromPercent("light", -20), 0);
  assert.ok(MicrobitSensors.fromPercent("sound", 100) <= 255);
});

test("an unreadable value yields 0 rather than NaN", function() {
  // A NaN here would end up in the bytecode as a threshold, or in an editor
  // comparison that is always false.
  assert.strictEqual(MicrobitSensors.toPercent("light", undefined), 0);
  assert.strictEqual(MicrobitSensors.fromPercent("light", NaN), 0);
});

test("only percentage-based conditions declare a scale", function() {
  // obstacle travels in centimetres: converting it would break it.
  assert.strictEqual(MicrobitSensors.CONDITION_SCALE.dark, "light");
  assert.strictEqual(MicrobitSensors.CONDITION_SCALE.bright, "light");
  assert.strictEqual(MicrobitSensors.CONDITION_SCALE.loud, "sound");
  assert.strictEqual(MicrobitSensors.CONDITION_SCALE.obstacle, undefined);
  assert.strictEqual(MicrobitSensors.TRIGGER_SCALE.start, undefined);
});
