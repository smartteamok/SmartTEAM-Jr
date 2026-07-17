/**
 * This file contains the implementations for the blocks specific to the FinchBlox
 * color category (lights + LED matrix).
 */

/**
 * Block for changing LED color or the LED array on the Finch / SmartTEAM kit.
 * @param {number} x
 * @param {number} y
 * @param {number} level - Which difficulty level is the block for?
 * @param {string} type - "light" (both LEDs) or "LEDArray"
 */
function B_FBColor(x, y, level, type) {
  this.level = level;
  this.isLight = (type == "light" || type == "beak" || type == "tail");
  this.isLEDArray = (type == "LEDArray");
  this.red = 0;
  this.green = 0;
  this.blue = 0;
  this.duration = 10;
  this.ledStatusString = "0000001010000001000101110"; //smiley face
  this.ledOffString = "0000000000000000000000000";
  this.ledArray = [];
  CommandBlock.call(this, x, y, (this.isLEDArray ? "screen_" : "color_") + level);

  if (this.isLEDArray) {
    this.blockIcon = new BlockIcon(this, VectorPaths.stScreenBase, Colors.bbtDarkGray, "screen", 34);
    this.blockIcon.isEndOfLine = true;
    this.addPart(this.blockIcon);
    this.ledOnGroup = null;
  } else {
    // SmartTEAM lightbulb: recolorable fill + white outline/rays (no Finch silhouette)
    this.blockIcon = new BlockIcon(this, VectorPaths.stLightFill, Colors.iron, "light", 32);
    this.blockIcon.isEndOfLine = true;
    this.blockIcon.addSecondIcon(VectorPaths.stLightOutline, Colors.white);
    this.ledIcon = this.blockIcon.icon.pathE;
    this.addPart(this.blockIcon);
  }
}
B_FBColor.prototype = Object.create(CommandBlock.prototype);
B_FBColor.prototype.constructor = B_FBColor;

/**
 * Send RGB to both kit LEDs (beak then tail), sharing requestStatus across phases.
 */
B_FBColor.prototype.sendBothLeds = function(mem, red, green, blue, nextPhase) {
  let device = DeviceFinch.getManager().getDevice(0);
  if (device == null) {
    mem.requestStatus.finished = true;
    mem.duration = 0;
    TitleBar.flashFinchButton();
    return false;
  }
  mem.requestStatus = {};
  mem.requestStatus.finished = false;
  mem.requestStatus.error = false;
  mem.requestStatus.result = null;
  mem.ledPhase = "beak";
  mem.ledNextPhase = nextPhase;
  mem.ledRgb = { r: red, g: green, b: blue };
  device.setBeak(mem.requestStatus, red, green, blue);
  return true;
};

B_FBColor.prototype.advanceLedPhase = function(mem) {
  if (mem.ledPhase == "beak") {
    let device = DeviceFinch.getManager().getDevice(0);
    if (device == null) {
      mem.requestStatus.finished = true;
      return "error";
    }
    mem.requestStatus = {};
    mem.requestStatus.finished = false;
    mem.requestStatus.error = false;
    mem.requestStatus.result = null;
    mem.ledPhase = "tail";
    device.setTail(mem.requestStatus, "all", mem.ledRgb.r, mem.ledRgb.g, mem.ledRgb.b);
    return "running";
  }
  if (mem.ledPhase == "tail") {
    mem.ledPhase = null;
    return mem.ledNextPhase;
  }
  return mem.ledNextPhase;
};

B_FBColor.prototype.startAction = function() {
  const mem = this.runMem;
  mem.timerStarted = false;
  mem.duration = 100 * this.duration;
  mem.offSent = false;
  mem.requestStatus = {};
  mem.requestStatus.finished = false;
  mem.requestStatus.error = false;
  mem.requestStatus.result = null;

  let device = DeviceFinch.getManager().getDevice(0);
  if (device != null) {
    if (this.isLight) {
      if (!this.sendBothLeds(mem, this.red, this.green, this.blue, "lit")) {
        return new ExecutionStatusError();
      }
    } else if (this.isLEDArray) {
      device.setLedArray(mem.requestStatus, this.ledStatusString);
    }
  } else {
    mem.requestStatus.finished = true;
    mem.duration = 0;
    TitleBar.flashFinchButton();
    return new ExecutionStatusError();
  }

  return new ExecutionStatusRunning();
};
B_FBColor.prototype.updateAction = function() {
  const mem = this.runMem;
  if (!mem.timerStarted) {
    const status = mem.requestStatus;
    if (status.finished === true) {
      if (status.error === true) {
        return new ExecutionStatusError();
      }
      if (this.isLight && mem.ledPhase != null) {
        const next = this.advanceLedPhase(mem);
        if (next == "error") {
          return new ExecutionStatusError();
        }
        if (next == "running") {
          return new ExecutionStatusRunning();
        }
        if (next == "done") {
          return new ExecutionStatusDone();
        }
        // next == "lit" → start duration timer
      }
      mem.startTime = new Date().getTime();
      mem.timerStarted = true;
    } else {
      return new ExecutionStatusRunning();
    }
  }
  if (new Date().getTime() >= mem.startTime + mem.duration) {
    if (!mem.offSent) {
      mem.offSent = true;
      mem.timerStarted = false;
      mem.duration = 0;
      mem.requestStatus.finished = false;
      let device = DeviceFinch.getManager().getDevice(0);
      if (device != null) {
        if (this.isLight) {
          if (!this.sendBothLeds(mem, 0, 0, 0, "done")) {
            return new ExecutionStatusDone();
          }
        } else if (this.isLEDArray) {
          device.setLedArray(mem.requestStatus, this.ledOffString);
        }
      } else {
        mem.requestStatus.finished = true;
      }
      return new ExecutionStatusRunning();
    } else {
      return new ExecutionStatusDone();
    }
  } else {
    return new ExecutionStatusRunning();
  }
};
B_FBColor.prototype.updateColor = function() {
  if (this.isLEDArray) {
    this.redrawScreenLeds();
    return;
  }
  const s = 255 / 100;
  if ((this.red + this.green + this.blue) === 0) {
    GuiElements.update.color(this.ledIcon, Colors.bbtDarkGray);
  } else {
    this.colorHex = Colors.rgbToHex(this.red * s, this.green * s, this.blue * s);
    GuiElements.update.color(this.ledIcon, this.colorHex);
  }
};

/**
 * Overlay pink ON pixels onto stScreenBase according to ledStatusString.
 */
B_FBColor.prototype.redrawScreenLeds = function() {
  if (this.blockIcon == null || this.blockIcon.icon == null) {
    return;
  }
  if (this.ledOnGroup != null) {
    this.ledOnGroup.remove();
  }
  const parent = this.blockIcon.icon.group;
  this.ledOnGroup = GuiElements.create.group(0, 0, parent);
  const geo = VectorPaths.stScreenLed;
  const onColor = InputWidget.LedMatrix != null ? InputWidget.LedMatrix.onColor : "#E83B66";
  const pattern = this.ledStatusString != null ? this.ledStatusString : "";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (pattern.charAt(row * 5 + col) !== "1") {
        continue;
      }
      const x = geo.originX + col * geo.stepX;
      const y = geo.originY + row * geo.stepY;
      const rect = GuiElements.draw.rect(x, y, geo.cell, geo.cell, onColor, 0.14, 0.14);
      this.ledOnGroup.appendChild(rect);
    }
  }
};

B_FBColor.prototype.updateValues = function() {
  if (this.colorButton != null) {
    if (this.isLEDArray) {
      this.ledStatusString = this.colorButton.values[0];
    } else {
      this.red = this.colorButton.values[0].r;
      this.green = this.colorButton.values[0].g;
      this.blue = this.colorButton.values[0].b;
    }
    this.updateColor();

    for (let i = 0; i < this.colorButton.widgets.length; i++) {
      if (this.colorButton.widgets[i].type == "time") {
        const vi = this.colorButton.widgets[i].index;
        this.duration = this.colorButton.values[vi];
        break;
      }
    }
  }
};
B_FBColor.prototype.addL2Button = function() {
  if (this.isLEDArray) {
    let options = ["0000001010000001000101110", //smiley face
      "0000001010000000111010001", //frowny face
      "0101000000001000101000100", //surprise face
      "1010010100111101101011110", //OK
      "0111010101111111111110101", //alien
      "1111110001100011000111111", //square
      "0101011111111110111000100", //heart
      "0010001010100010101000100"
    ]; //diamond
    this.colorButton = new BlockButton(this);
    this.colorButton.addSlider("ledArray", options[3], options);
    this.colorButton.addLedMatrix(0);
  } else {
    this.blue = 100;
    const color = {
      r: this.red,
      g: this.green,
      b: this.blue
    };
    this.colorButton = new BlockButton(this);
    this.colorButton.addSlider("color", color);
  }
  this.addPart(this.colorButton);
  this.updateColor();
};

//********* Level 1 blocks *********

function B_FBLightL1(x, y) {
  B_FBColor.call(this, x, y, 1, "light");
  this.addL2Button();
}
B_FBLightL1.prototype = Object.create(B_FBColor.prototype);
B_FBLightL1.prototype.constructor = B_FBLightL1;

// Legacy L1 names (XML import / old projects) → unified light block
function B_FBBeakRed(x, y) { B_FBLightL1.call(this, x, y); }
B_FBBeakRed.prototype = Object.create(B_FBLightL1.prototype);
B_FBBeakRed.prototype.constructor = B_FBBeakRed;

function B_FBTailRed(x, y) { B_FBLightL1.call(this, x, y); }
B_FBTailRed.prototype = Object.create(B_FBLightL1.prototype);
B_FBTailRed.prototype.constructor = B_FBTailRed;

function B_FBBeakGreen(x, y) { B_FBLightL1.call(this, x, y); }
B_FBBeakGreen.prototype = Object.create(B_FBLightL1.prototype);
B_FBBeakGreen.prototype.constructor = B_FBBeakGreen;

function B_FBTailGreen(x, y) { B_FBLightL1.call(this, x, y); }
B_FBTailGreen.prototype = Object.create(B_FBLightL1.prototype);
B_FBTailGreen.prototype.constructor = B_FBTailGreen;

function B_FBBeakBlue(x, y) { B_FBLightL1.call(this, x, y); }
B_FBBeakBlue.prototype = Object.create(B_FBLightL1.prototype);
B_FBBeakBlue.prototype.constructor = B_FBBeakBlue;

function B_FBTailBlue(x, y) { B_FBLightL1.call(this, x, y); }
B_FBTailBlue.prototype = Object.create(B_FBLightL1.prototype);
B_FBTailBlue.prototype.constructor = B_FBTailBlue;

//********* Level 2 blocks *********

function B_FBColorL2(x, y, type) {
  B_FBColor.call(this, x, y, 2, type);
  this.addL2Button();
}
B_FBColorL2.prototype = Object.create(B_FBColor.prototype);
B_FBColorL2.prototype.constructor = B_FBColorL2;

function B_FBLightL2(x, y) {
  B_FBColorL2.call(this, x, y, "light");
}
B_FBLightL2.prototype = Object.create(B_FBColorL2.prototype);
B_FBLightL2.prototype.constructor = B_FBLightL2;

function B_FBBeakL2(x, y) { B_FBLightL2.call(this, x, y); }
B_FBBeakL2.prototype = Object.create(B_FBLightL2.prototype);
B_FBBeakL2.prototype.constructor = B_FBBeakL2;

function B_FBTailL2(x, y) { B_FBLightL2.call(this, x, y); }
B_FBTailL2.prototype = Object.create(B_FBLightL2.prototype);
B_FBTailL2.prototype.constructor = B_FBTailL2;

function B_FBLedArrayL2(x, y) {
  B_FBColorL2.call(this, x, y, "LEDArray");
}
B_FBLedArrayL2.prototype = Object.create(B_FBColorL2.prototype);
B_FBLedArrayL2.prototype.constructor = B_FBLedArrayL2;


//********* Level 3 blocks *********

function B_FBColorL3(x, y, type) {
  B_FBColor.call(this, x, y, 3, type);

  this.addL2Button();

  this.colorButton.addSlider("time", this.duration, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}
B_FBColorL3.prototype = Object.create(B_FBColor.prototype);
B_FBColorL3.prototype.constructor = B_FBColorL3;

function B_FBLightL3(x, y) {
  B_FBColorL3.call(this, x, y, "light");
}
B_FBLightL3.prototype = Object.create(B_FBColorL3.prototype);
B_FBLightL3.prototype.constructor = B_FBLightL3;

function B_FBBeakL3(x, y) { B_FBLightL3.call(this, x, y); }
B_FBBeakL3.prototype = Object.create(B_FBLightL3.prototype);
B_FBBeakL3.prototype.constructor = B_FBBeakL3;

function B_FBTailL3(x, y) { B_FBLightL3.call(this, x, y); }
B_FBTailL3.prototype = Object.create(B_FBLightL3.prototype);
B_FBTailL3.prototype.constructor = B_FBTailL3;

function B_FBLedArrayL3(x, y) {
  B_FBColorL3.call(this, x, y, "LEDArray");
}
B_FBLedArrayL3.prototype = Object.create(B_FBColorL3.prototype);
B_FBLedArrayL3.prototype.constructor = B_FBLedArrayL3;
