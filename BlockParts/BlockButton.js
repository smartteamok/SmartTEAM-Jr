/**
 * Adds a button to the block. Used in FinchBlox.
 * @param {Block} parent - The Block this button is a part of
 */
function BlockButton(parent) {
  this.buttonMargin = 2 * BlockPalette.blockButtonOverhang * (1 / 9);
  this.lineHeight = 2 * BlockPalette.blockButtonOverhang * (8 / 9);
  this.cornerRadius = BlockPalette.blockButtonOverhang;

  this.height = this.blockButtonMargin + this.lineHeight;
  this.width = 60;
  this.textColor = Colors.bbtDarkGray;
  this.font = Font.uiFont(12);
  this.outlineStroke = 1;

  this.parent = parent;
  this.x = 0;
  this.y = 0;
  this.widgets = [];
  this.displaySuffixes = [];
  this.values = [];
  this.popupIsDisplayed = false;

  this.outlineColor = Colors.blockOutline[parent.category];
  if (this.outlineColor == null) {
    this.outlineColor = Colors.categoryColors[parent.category];
  }
  if (this.outlineColor == null) {
    this.outlineColor = Colors.iron;
  }

  const me = this;
  this.callbackFunction = function() {
    if (!me.parent.stack.isDisplayStack) { //Disable popups for blocks in the blockpalette
      const inputSys = me.createInputSystem();
      inputSys.show(null, me.updateValue.bind(me), function() {
        SaveManager.markEdited();
        me.popupIsDisplayed = false;
      }, me.values, me.outlineColor, parent);
      me.popupIsDisplayed = true;
    }
  }

  this.isSlot = false;
  parent.blockButton = this;
};
BlockButton.prototype = Object.create(BlockPart.prototype);
BlockButton.prototype.constructor = BlockButton;

/**
 * Creates or recreates the button and sets its callback function.
 */
BlockButton.prototype.draw = function() {
  if (this.button != null) {
    this.button.remove();
  }
  this.button = new Button(this.x, this.y, this.width, this.height, this.parent.group, Colors.white, this.cornerRadius, this.cornerRadius);
  GuiElements.update.stroke(this.button.bgRect, this.outlineColor, this.outlineStroke);
  this.button.setCallbackFunction(this.callbackFunction, true);
}

/**
 * @param {number} x - The x coord the icon should have relative to the Block it is in
 * @param {number} y - The y coord ths icon should have measured from the center of the icon
 * @return {number} - The width of the icon, indicating how much the next item should be shifted over.
 */
BlockButton.prototype.updateAlign = function(x, y) {
  DebugOptions.validateNumbers(x, y);
  this.move(x, y);
  //Hide the button while the block is in the blockPalette
  if (this.parent.stack === null || this.parent.stack.isDisplayStack) {
    this.button.hide();
    this.isHidden = true;
  } else if (this.isHidden) {
    this.button.show();
    this.isHidden = false;
  }
  return this.width;
};

/**
 * BlockButtons are of constant size, so updateDim does nothing
 */
BlockButton.prototype.updateDim = function() {

};

/**
 * Moves the button and sets this.x and this.y to the specified coordinates
 * @param {number} x
 * @param {number} y
 */
BlockButton.prototype.move = function(x, y) {
  DebugOptions.validateNumbers(x, y);
  this.x = x;
  this.y = y;
  this.button.move(x, y);
};

/**
 * Update the value at the specified index.
 * @param newValue - the new value to use.
 * @param {number} index - the index at which to place the new value.
 */
BlockButton.prototype.updateValue = function(newValue, index) { //, displayString) {
  this.values[index] = newValue;

  // Keep an open LedMatrix editor in sync when a sibling preset slider writes the same index.
  for (let s = 0; s < this.widgets.length; s++) {
    const w = this.widgets[s];
    if (w.type == "ledMatrix" && w.index == index && w.syncFromValue != null) {
      w.syncFromValue(newValue);
    }
  }

  let text = [];
  let visualCount = 0;
  for (let c = 0; c < this.widgets.length; c++) {
    if (this.widgets[c].type != "ledMatrix") {
      visualCount++;
    }
  }
  let visualI = 0;

  for (let i = 0; i < this.widgets.length; i++) {
    if (this.widgets[i].type == "ledMatrix") {
      continue;
    }
    let lineText = "";
    const vi = this.widgets[i].index != null ? this.widgets[i].index : i;
    const val = this.values[vi];
    if (typeof val == 'object' && val != null && val.r != null) {
      const s = 255 / 100;
      const color = Colors.rgbToHex(val.r * s, val.g * s, val.b * s);

      if (visualCount == 1) {
        this.button.updateBgColor(color);
      } else {
        if (this.colorLabel != null) {
          this.colorLabel.remove();
        }
        const clW = this.button.width;
        const clH = this.button.height / visualCount;
        const clX = 0;
        const clY = visualI * clH;
        const clR = this.cornerRadius;
        this.colorLabel = GuiElements.draw.tab(clX, clY, clW, clH, color, clR);
        this.button.group.appendChild(this.colorLabel);
        TouchReceiver.addListenersBN(this.colorLabel, this.button);

        for (let j = 0; j < this.widgets.length; j++) {
          if (this.widgets[j].type == "ledMatrix") {
            continue;
          }
          const jVi = this.widgets[j].index != null ? this.widgets[j].index : j;
          let jVisual = 0;
          for (let k = 0; k < j; k++) {
            if (this.widgets[k].type != "ledMatrix") {
              jVisual++;
            }
          }
          if (jVi != vi && (jVisual == 0 || jVisual == visualCount - 1)) {
            const bgY = jVisual * clH;
            const bg = GuiElements.draw.tab(clX, bgY, clW, clH, Colors.white, clR, true);
            this.button.group.appendChild(bg);
            TouchReceiver.addListenersBN(bg, this.button);
          }
        }

        this.button.bgRect.remove();
        GuiElements.update.color(this.button.bgRect, "none");
        this.button.group.appendChild(this.button.bgRect);
      }
    } else if (this.widgets[i].type == "piano") {
      lineText = InputWidget.Piano.noteStrings[val];
    } else if (this.widgets[i].type == "ledArray") {
      if (this.ledArrayImage != null) {
        this.ledArrayImage.group.remove();
      }
      const onC = InputWidget.LedMatrix != null ? InputWidget.LedMatrix.onColor : Colors.bbtDarkGray;
      const offC = InputWidget.LedMatrix != null ? InputWidget.LedMatrix.offColor : Colors.fbGray;
      let image = GuiElements.draw.ledArray(this.button.group, val, 1.8, offC, onC);
      const iX = this.button.width / 2 - image.width / 2;
      const iY = (visualI + 1) * this.button.height / (visualCount + 1) - image.width / 2;
      GuiElements.move.group(image.group, iX, iY);
      this.ledArrayImage = image;
    } else {
      lineText = val.toString() + this.displaySuffixes[i];
    }

    if (this.widgets[i].type == "time") {
      if (this.timeIcon != null) {
        this.timeIcon.remove();
      }
      const textM = lineText + "...."
      lineText = lineText + "    ";
      const textW = GuiElements.measure.stringWidth(textM, this.font);
      const tiH = 11;
      const tiPath = VectorPaths.faClock;
      const tiW = VectorIcon.computeWidth(tiPath, tiH);
      const tiX = this.button.width / 2 + textW / 2 - tiW;
      const tiY = (visualI + 1) * this.button.height / (visualCount + 1) - tiH / 2 + 0.75;
      this.timeIcon = new VectorIcon(tiX, tiY, tiPath, Colors.bbtDarkGray, tiH, this.button.group);
    }
    text.push(lineText);
    visualI++;
  }
  this.button.addMultiText(text, this.font, this.textColor);
  this.parent.updateValues();
};

/**
 * Creates the input pad for this button. Adds the necessary widgets.
 */
BlockButton.prototype.createInputSystem = function() {
  const x1 = this.getAbsX();
  const y1 = this.getAbsY();
  const x2 = this.relToAbsX(this.width);
  const y2 = this.relToAbsY(this.height);
  const inputPad = new InputPad(x1, x2, y1, y2);

  this.widgets.forEach(function(widget) {
    inputPad.addWidget(widget);
  });

  return inputPad;
};

/**
 * Add a value with slider input to this button.
 * @param {string} type - Type of value to add (determines the way the slider is displayed)
 * @param startingValue - Initial value
 * @param {Array} options - (Optional) list of discrete options to display on the slider
 */
BlockButton.prototype.addSlider = function(type, startingValue, options) {

  let suffix = "";
  switch (type) {
    case "distance":
      suffix = " cm";
      break;
    case "percent":
      suffix = "%";
      break;
    case "angle_left":
    case "angle_right":
      suffix = "°";
      break;
    default:
      suffix = "";
  }

  const sliderColor = Colors.categoryColors[this.parent.category];
  const slider = new InputWidget.Slider(type, options, startingValue, sliderColor, suffix, this.values.length);
  this.addWidget(slider, suffix, startingValue);
}

/**
 * Adds a 5x5 LED matrix editor that shares an existing value slot (usually index 0 with ledArray).
 * Does not push a new value or grow the button height.
 * @param {number} [valueIndex=0]
 */
BlockButton.prototype.addLedMatrix = function(valueIndex) {
  if (valueIndex == null) {
    valueIndex = 0;
  }
  this.widgets.push(new InputWidget.LedMatrix(valueIndex));
  this.displaySuffixes.push("");
}

/**
 * Adds a new value with piano input to this button
 * @param {string} startingValue - the initial value
 */
BlockButton.prototype.addPiano = function(startingValue) {
  this.addWidget(new InputWidget.Piano(this.values.length), "", startingValue);
}

/**
 * Adds a new widget for this button
 * @param {Widget} widget - The widget to add
 * @param {string} suffix - Suffix to use for value display
 * @param startingValue - Initial value
 */
BlockButton.prototype.addWidget = function(widget, suffix, startingValue) {
  this.widgets.push(widget);
  this.displaySuffixes.push(suffix);
  this.values.push(startingValue);
  let visualN = 0;
  for (let i = 0; i < this.widgets.length; i++) {
    if (this.widgets[i].type != "ledMatrix") {
      visualN++;
    }
  }
  this.height = this.buttonMargin + this.lineHeight * Math.max(visualN, 1);
  this.draw();
  const index = widget.index != null ? widget.index : (this.values.length - 1);
  this.updateValue(this.values[index], index);
}

// These functions convert between screen (absolute) coordinates and local (relative) coordinates.
//TODO: These functions are copied from Slot. Move to BlockPart?
/**
 * @param {number} x
 * @returns {number}
 */
BlockButton.prototype.relToAbsX = function(x) {
  return this.parent.relToAbsX(x + this.x);
};
/**
 * @param {number} y
 * @returns {number}
 */
BlockButton.prototype.relToAbsY = function(y) {
  return this.parent.relToAbsY(y + this.y);
};
/**
 * @param {number} x
 * @returns {number}
 */
BlockButton.prototype.absToRelX = function(x) {
  return this.parent.absToRelX(x) - this.x;
};
/**
 * @param {number} y
 * @returns {number}
 */
BlockButton.prototype.absToRelY = function(y) {
  return this.parent.absToRelY(y) - this.y;
};
/**
 * Returns the x coord of the Slot relative to the screen (not the group it is contained in).
 * @return {number} - The x coord of the Slot relative to the screen.
 */
BlockButton.prototype.getAbsX = function() {
  return this.relToAbsX(0);
};
/**
 * Returns the y coord of the Slot relative to the screen (not the group it is contained in).
 * @return {number} - The y coord of the Slot relative to the screen.
 */
BlockButton.prototype.getAbsY = function() { //Fix for tabs
  return this.relToAbsY(0);
};
/**
 * @returns {number}
 */
BlockButton.prototype.getAbsWidth = function() {
  return this.relToAbsX(this.width) - this.getAbsX();
};
/**
 * @returns {number}
 */
BlockButton.prototype.getAbsHeight = function() {
  return this.relToAbsY(this.height) - this.getAbsY();
};

/**
 * Create an xml node for this button.
 * @param {Document} xmlDoc - The document to write to
 * @return {Node}
 */
BlockButton.prototype.createXml = function(xmlDoc) {
  const blockButton = XmlWriter.createElement(xmlDoc, "blockButton");
  for (var i = 0; i < this.values.length; i++) {
    if (this.widgets[i].type == "color") {
      const valueString = "colorData_" + this.values[i].r + "_" + this.values[i].g + "_" + this.values[i].b;
      XmlWriter.setAttribute(blockButton, "value_" + i, valueString);
    } else {
      XmlWriter.setAttribute(blockButton, "value_" + i, this.values[i]);
    }
  }
  return blockButton;
}

/**
 * Import values for this button from xml.
 * @param {Node} blockButtonNode - The node to copy the data from
 */
BlockButton.prototype.importXml = function(blockButtonNode) {
  var i = 0;
  var valueString = XmlWriter.getAttribute(blockButtonNode, "value_" + i);
  while (valueString != null) {
    if (valueString.startsWith("colorData")) {
      const colorVals = valueString.split("_");
      const colorObj = {};
      colorObj.r = colorVals[1];
      colorObj.g = colorVals[2];
      colorObj.b = colorVals[3];
      this.updateValue(colorObj, i);
    } else if (typeof this.values[i] === 'number') {
      this.updateValue(parseFloat(valueString), i);
    } else {
      this.updateValue(valueString, i);
    }
    i++;
    valueString = XmlWriter.getAttribute(blockButtonNode, "value_" + i);
  }
}
