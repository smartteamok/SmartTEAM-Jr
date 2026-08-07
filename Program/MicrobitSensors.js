"use strict";

/**
 * Sensor scale conversion between the editor and the micro:bit.
 *
 * The editor comes from the Finch robot, whose sensors reported 0-100, and its
 * thresholds are written on that scale (ProgramCompiler.DARK_THRESHOLD = 5 means
 * "5% light"). The micro:bit reports on different native scales and nothing
 * converted between them, so the thresholds did not mean what they say:
 *
 *   - light: readLightLevel() returns 0-255, so a threshold of 5 compared
 *     against 5/255 ≈ 2% instead of 5%. "Start when dark" demanded near-total
 *     darkness.
 *   - sound: levelSPL returns decibels, not 0-100.
 *
 * The conversion lives here and is applied at both edges, the same way
 * BytecodeAssembler.scale100 already does for RGB values:
 *
 *   board  → editor   toPercent()    (live reads, webble/backend.js)
 *   editor → board    fromPercent()  (compiled thresholds, BytecodeAssembler)
 *
 * That keeps the editor's thresholds expressed as percentages, which is their
 * semantics, while the board always sends and receives its native scale.
 */
function MicrobitSensors() {}

/* Light: MicroBitDisplay::readLightLevel() returns 0-255. */
MicrobitSensors.LIGHT_MAX = 255;

/* Sound: uBit.audio.levelSPL->getValue() returns dB SPL, not a 0-100 level. The
 * floor and ceiling map the useful range onto a percentage.
 *
 * CAUTION: these two numbers are the only part of this file NOT derived from the
 * code. They come from the typical range of CODAL's LevelDetectorSPL (~52 dB
 * floor) and from a clap near the microphone sitting around 100 dB. They need
 * confirming against a real board: webble/backend.js logs the raw value of every
 * read for exactly that. If a clap does not reach 50% or silence does not land
 * near 0%, adjust them here and everything downstream follows. */
MicrobitSensors.SOUND_DB_FLOOR = 52;
MicrobitSensors.SOUND_DB_CEIL = 100;

/* Distance reported while the firmware does not send one.
 *
 * Deliberately 0 — "obstacle right there". The drive-until blocks use continuous
 * motors (ticks 0), so reporting "path clear" would leave the robot driving
 * indefinitely and off the table. Stopping immediately is useless but safe. */
MicrobitSensors.DISTANCE_UNAVAILABLE = 0;

/**
 * Board's native scale → the editor's 0-100 percentage.
 * @param {string} kind - "light" | "sound"
 * @param {number} raw - byte as GET_SENSORS sends it
 * @return {number} integer 0-100
 */
MicrobitSensors.toPercent = function(kind, raw) {
  const value = Number(raw);
  if (!isFinite(value)) {
    return 0;
  }
  if (kind === "light") {
    return MicrobitSensors.clampPercent(
      Math.round(value * 100 / MicrobitSensors.LIGHT_MAX));
  }
  if (kind === "sound") {
    const span = MicrobitSensors.SOUND_DB_CEIL - MicrobitSensors.SOUND_DB_FLOOR;
    return MicrobitSensors.clampPercent(
      Math.round((value - MicrobitSensors.SOUND_DB_FLOOR) * 100 / span));
  }
  return MicrobitSensors.clampPercent(Math.round(value));
};

/**
 * The editor's 0-100 percentage → the board's native scale. This is what travels
 * as an event or WAIT_UNTIL parameter, because the VM compares it against the
 * sensor's native value.
 * @param {string} kind - "light" | "sound"
 * @param {number} percent
 * @return {number} byte 0-255
 */
MicrobitSensors.fromPercent = function(kind, percent) {
  const value = Number(percent);
  if (!isFinite(value)) {
    return 0;
  }
  const pct = MicrobitSensors.clampPercent(value);
  if (kind === "light") {
    return Math.round(pct * MicrobitSensors.LIGHT_MAX / 100);
  }
  if (kind === "sound") {
    const span = MicrobitSensors.SOUND_DB_CEIL - MicrobitSensors.SOUND_DB_FLOOR;
    return Math.min(255,
      Math.round(MicrobitSensors.SOUND_DB_FLOOR + pct * span / 100));
  }
  return Math.round(pct);
};

MicrobitSensors.clampPercent = function(value) {
  return Math.max(0, Math.min(100, value));
};

/**
 * Which scale each ISA condition uses. Anything absent is left alone:
 * "obstacle" travels in centimetres and the buttons are booleans.
 */
MicrobitSensors.CONDITION_SCALE = {
  dark: "light",
  bright: "light",
  loud: "sound"
};

/** Same, for event triggers (the hat blocks). */
MicrobitSensors.TRIGGER_SCALE = {
  dark: "light",
  loud: "sound"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = MicrobitSensors;
}
