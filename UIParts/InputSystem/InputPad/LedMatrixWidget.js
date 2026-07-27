/**
 * FinchBlox 5x5 LED matrix editor for screen blocks.
 * Shares a value index with the ledArray preset slider (typically 0).
 * @param {number} index - Index into BlockButton.values / InputPad data
 * @constructor
 */
InputWidget.LedMatrix = function(index) {
  this.index = index;
  this.type = "ledMatrix";
  this.cells = [];
  this.pattern = InputWidget.LedMatrix.emptyPattern();
  this.livePreviewTimer = null;
};

InputWidget.LedMatrix.prototype = Object.create(InputWidget.prototype);
InputWidget.LedMatrix.prototype.constructor = InputWidget.LedMatrix;

InputWidget.LedMatrix.SIZE = 5;
InputWidget.LedMatrix.LIVE_PREVIEW_MS = 150;

InputWidget.LedMatrix.emptyPattern = function() {
  return "0000000000000000000000000";
};

InputWidget.LedMatrix.normalize = function(str) {
  if (str == null || typeof str !== "string") {
    return InputWidget.LedMatrix.emptyPattern();
  }
  let out = "";
  for (let i = 0; i < InputWidget.LedMatrix.SIZE * InputWidget.LedMatrix.SIZE; i++) {
    out += (str.charAt(i) === "1") ? "1" : "0";
  }
  return out;
};

InputWidget.LedMatrix.setConstants = function() {
  const M = InputWidget.LedMatrix;
  M.padWidth = InputPad.width;
  M.margin = 6;
  M.toolbarH = 28;
  M.bnGap = 6;
  M.cellGap = 4;
  M.framePad = 6;
  M.maxCellSize = 30;
  M.onColor = "#E83B66";
  M.offColor = "#FFFFFF";
  M.frameColor = "#54545A";
  M.bnColor = Colors.categoryColors["screen_2"] || Colors.fbPurple;
  M.bnTextColor = Colors.white;
  M.font = Font.uiFont(12).bold();

  // Keep the grid compact so slider + matrix fit in the viewport.
  const maxInner = Math.min(
    M.padWidth - 2 * M.margin - 2 * M.framePad,
    M.maxCellSize * M.SIZE + M.cellGap * (M.SIZE - 1)
  );
  M.cellSize = (maxInner - (M.SIZE - 1) * M.cellGap) / M.SIZE;
  M.gridSize = M.SIZE * M.cellSize + (M.SIZE - 1) * M.cellGap;
  M.frameW = M.gridSize + 2 * M.framePad;
  M.frameX = (M.padWidth - M.frameW) / 2;
  M.height = M.toolbarH + M.margin + M.frameW + M.margin;
  M.width = M.padWidth;
};

/**
 * @inheritDoc
 */
InputWidget.LedMatrix.prototype.show = function(x, y, parentGroup, overlay, slotShape, updateFn, finishFn, data) {
  InputWidget.prototype.show.call(this, x, y, parentGroup, overlay, slotShape, updateFn, finishFn, data);
  this.group = GuiElements.create.group(x, y, parentGroup);
  this.pattern = InputWidget.LedMatrix.normalize(data[this.index]);
  this.makeChrome();
  this.makeGrid();
  this.paintCells();
};

/**
 * @inheritDoc
 */
InputWidget.LedMatrix.prototype.updateDim = function() {
  const M = InputWidget.LedMatrix;
  this.width = M.width;
  this.height = M.height;
};

InputWidget.LedMatrix.prototype.fixedHeight = function() {
  return true;
};

InputWidget.LedMatrix.prototype.close = function() {
  if (this.livePreviewTimer != null) {
    clearTimeout(this.livePreviewTimer);
    this.livePreviewTimer = null;
  }
};

/**
 * Refresh cells when a sibling preset slider writes the shared value.
 * @param {string} newValue
 */
InputWidget.LedMatrix.prototype.syncFromValue = function(newValue) {
  if (this.group == null) {
    return;
  }
  this.pattern = InputWidget.LedMatrix.normalize(newValue);
  this.paintCells();
};

InputWidget.LedMatrix.prototype.makeChrome = function() {
  const M = InputWidget.LedMatrix;
  const bnW = (M.padWidth - 2 * M.margin - M.bnGap) / 2;
  const clearBn = new Button(M.margin, 0, bnW, M.toolbarH, this.group, M.bnColor, 8, 8);
  clearBn.addText(Language.getStr("LedMatrix_Clear"), M.font, M.bnTextColor);
  clearBn.setCallbackFunction(function() {
    this.setPattern(InputWidget.LedMatrix.emptyPattern());
  }.bind(this));
  clearBn.markAsOverlayPart(this.overlay);

  const invertBn = new Button(M.margin + bnW + M.bnGap, 0, bnW, M.toolbarH, this.group, M.bnColor, 8, 8);
  invertBn.addText(Language.getStr("LedMatrix_Invert"), M.font, M.bnTextColor);
  invertBn.setCallbackFunction(function() {
    this.setPattern(this.invertString(this.pattern));
  }.bind(this));
  invertBn.markAsOverlayPart(this.overlay);

  const frameY = M.toolbarH + M.margin;
  const frame = GuiElements.draw.rect(M.frameX, frameY, M.frameW,
    M.gridSize + 2 * M.framePad, M.frameColor, 8, 8);
  this.group.appendChild(frame);
};

InputWidget.LedMatrix.prototype.makeGrid = function() {
  const M = InputWidget.LedMatrix;
  this.cells = [];
  const originX = M.frameX + M.framePad;
  const originY = M.toolbarH + M.margin + M.framePad;
  const corner = Math.max(2, M.cellSize / 8);
  for (let row = 0; row < M.SIZE; row++) {
    for (let col = 0; col < M.SIZE; col++) {
      const i = row * M.SIZE + col;
      const x = originX + col * (M.cellSize + M.cellGap);
      const y = originY + row * (M.cellSize + M.cellGap);
      const button = new Button(x, y, M.cellSize, M.cellSize, this.group, M.offColor, corner, corner);
      button.setCallbackFunction(function() {
        this.toggleAt(i);
      }.bind(this));
      button.setUnToggleFunction(function() {});
      button.markAsOverlayPart(this.overlay);
      this.cells[i] = button;
    }
  }
};

InputWidget.LedMatrix.prototype.paintCells = function() {
  const M = InputWidget.LedMatrix;
  for (let i = 0; i < this.cells.length; i++) {
    const on = this.pattern.charAt(i) === "1";
    this.cells[i].updateBgColor(on ? M.onColor : M.offColor);
  }
};

InputWidget.LedMatrix.prototype.invertString = function(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += (str.charAt(i) === "1") ? "0" : "1";
  }
  return out;
};

InputWidget.LedMatrix.prototype.toggleAt = function(i) {
  const chars = this.pattern.split("");
  chars[i] = (chars[i] === "1") ? "0" : "1";
  this.setPattern(chars.join(""));
};

InputWidget.LedMatrix.prototype.setPattern = function(str) {
  this.pattern = InputWidget.LedMatrix.normalize(str);
  this.paintCells();
  if (this.updateFn != null) {
    this.updateFn(this.pattern, this.index);
  }
  this.scheduleLivePreview(this.pattern);
};

InputWidget.LedMatrix.prototype.scheduleLivePreview = function(str) {
  if (this.livePreviewTimer != null) {
    clearTimeout(this.livePreviewTimer);
  }
  this.livePreviewTimer = setTimeout(function() {
    this.livePreviewTimer = null;
    this.sendLivePreview(str);
  }.bind(this), InputWidget.LedMatrix.LIVE_PREVIEW_MS);
};

InputWidget.LedMatrix.prototype.sendLivePreview = function(str) {
  const device = DeviceFinch.getManager().getDevice(0);
  if (device == null) {
    return;
  }
  const status = {
    finished: false,
    error: false,
    result: null
  };
  device.setLedArray(status, str);
};
