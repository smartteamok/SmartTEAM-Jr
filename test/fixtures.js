"use strict";

/* Duck-typed builders that imitate the instance fields FinchBlox blocks cache
 * through updateValues(). Only the fields the compiler reads. */

function chain() {
  const blocks = Array.prototype.slice.call(arguments);
  for (let i = 0; i < blocks.length - 1; i++) {
    blocks[i].nextBlock = blocks[i + 1];
  }
  return blocks[0];
}

function sound(midiNote, beats, typeName) {
  return {
    blockTypeName: typeName || "B_FBC",
    midiNote: midiNote,
    beats: beats,
    nextBlock: null
  };
}

function ledArray(pattern, duration) {
  return {
    blockTypeName: "B_FBLedArrayL2",
    ledStatusString: pattern,
    duration: duration,
    nextBlock: null
  };
}

function beak(r, g, b, duration) {
  return {
    blockTypeName: "B_FBBeakL2",
    isBeak: true,
    isTail: false,
    red: r,
    green: g,
    blue: b,
    duration: duration,
    nextBlock: null
  };
}

function tail(r, g, b, duration) {
  const block = beak(r, g, b, duration);
  block.blockTypeName = "B_FBTailL2";
  block.isBeak = false;
  block.isTail = true;
  return block;
}

function wait(timeSelection) {
  return {
    blockTypeName: "B_Wait",
    timeSelection: timeSelection,
    nextBlock: null
  };
}

function repeat(count, firstChild) {
  return {
    blockTypeName: "B_Repeat",
    countSelection: count,
    blockSlot1: { child: firstChild },
    nextBlock: null
  };
}

function forever(firstChild) {
  return {
    blockTypeName: "B_Forever",
    blockSlot1: { child: firstChild },
    nextBlock: null
  };
}

function motion(typeName, speedL, speedR, ticksL, ticksR) {
  return {
    blockTypeName: typeName,
    leftSpeed: speedL,
    rightSpeed: speedR,
    leftTicks: ticksL,
    rightTicks: ticksR,
    nextBlock: null
  };
}

function flagHat() {
  return {
    blockTypeName: "B_WhenFlagTapped",
    isStartBlock: true,
    nextBlock: null
  };
}

function darkHat() {
  return {
    blockTypeName: "B_StartWhenDark",
    isStartBlock: true,
    nextBlock: null
  };
}

function clapHat() {
  return {
    blockTypeName: "B_StartWhenClap",
    isStartBlock: true,
    nextBlock: null
  };
}

const SMILEY = "0000001010000001000101110";

module.exports = {
  chain: chain,
  sound: sound,
  ledArray: ledArray,
  beak: beak,
  tail: tail,
  wait: wait,
  repeat: repeat,
  forever: forever,
  motion: motion,
  flagHat: flagHat,
  darkHat: darkHat,
  clapHat: clapHat,
  SMILEY: SMILEY
};
