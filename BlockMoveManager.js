"use strict";

/**
 * BlockMoveManager is a class that moves the BlockStack that the user is dragging
 * BlockMoveManager contains function to start, stop, and update the movement of a BlockStack.
 * These functions are called by the TouchReceiver class when the user drags a BlockStack.
 * Initializer - Picks up a Block so that it can be moved.  Stores necessary information in BlockMoveManager.move.
 * Transfers the BlockStack into the drag layer above other blocks.
 * @param {Block} block - The block the user dragged.
 * @param {number} x - The x coord of the user's finger.
 * @param {number} y - The y coord of the user's finger.
 */
function BlockMoveManager(block, x, y) {
  const move = {}

  Overlay.closeOverlays(); // Close any visible overlays.
  /* Disconnect the Block from its current BlockStack to form a new BlockStack
  containing only the Block and the Blocks below it. */
  const stack = block.unsnap();
  stack.fly(); // Make the new BlockStack fly (moves it into the drag layer).
  move.bottomX = stack.relToAbsX(stack.dim.rw); // Store the BlockStack's dimensions.
  move.bottomY = stack.relToAbsY(stack.dim.rh);
  move.returnType = stack.returnType; // Store the BlockStack's return type.
  move.startedFromPalette = BlockPalette.isStackOverPalette(x, y);

  // Store other information about how the BlockStack can connect to other Blocks.
  move.bottomOpen = stack.getLastBlock().bottomOpen;
  move.topOpen = stack.firstBlock.topOpen;
  move.returnsValue = stack.firstBlock.returnsValue;

  move.touchX = x; // Store coords
  move.touchY = y;
  move.offsetX = stack.getAbsX() - x; // Store offset.
  move.offsetY = stack.getAbsY() - y;
  move.stack = stack; // Store stack.

  move.topX = 0; // The top-left corner's x coord of the BlockStack being moved.
  move.topY = 0; // The top-left corner's y-coord of the BlockStack being moved.
  this.move = move;
  // Stores information used when determine which slot is closest to the moving stack.
  this.fit = {};
}

/**
 * Number of programs the active tab would send to the board, ignoring one stack
 * (the one being dragged, which is already registered in the tab).
 *
 * Counts every top-level stack, not just the ones with a hat: a hatless stack
 * still compiles to an "start" handler (ProgramCompiler.compileStack), so it
 * occupies a VM context like any other. Counting only hats would let the editor
 * accept 8 hats plus loose blocks and then fail at send time with
 * E_TOO_MANY_STACKS — the confusing failure this limit exists to prevent.
 *
 * Palette blocks live in DisplayStacks, which never register with a tab, so
 * they cannot inflate this count.
 * @param {BlockStack} [excludeStack] - stack to leave out of the count.
 * @return {number}
 */
BlockMoveManager.countPrograms = function(excludeStack) {
  const tab = TabManager.activeTab;
  if (tab == null) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < tab.stackList.length; i++) {
    const stack = tab.stackList[i];
    if (stack !== excludeStack && !stack.isDisplayStack) {
      count++;
    }
  }
  return count;
};

/**
 * Whether landing this stack as its own top-level stack would exceed the number
 * of programs the board can run concurrently. The limit is
 * ProgramCompiler.MAX_HANDLERS, which derives from STX.MAX_CONTEXTS in the
 * firmware ISA — so the editor, the compiler and the VM all move together.
 * @param {BlockStack} stack - the stack about to land.
 * @return {boolean}
 */
BlockMoveManager.wouldExceedProgramLimit = function(stack) {
  if (!FinchBlox || typeof ProgramCompiler === "undefined") {
    return false;
  }
  return BlockMoveManager.countPrograms(stack) >= ProgramCompiler.MAX_HANDLERS;
};

/**
 * Updates the position of the currently moving BlockStack.
 * Also highlights the slot that fits it best (if any).
 * @param {number} x - The x coord of the user's finger.
 * @param {number} y - The y coord of the user's finger.
 */
BlockMoveManager.prototype.update = function(x, y) {
  const move = this.move; // shorthand

  move.touchX = x;
  move.touchY = y;
  move.topX = move.offsetX + x;
  move.topY = move.offsetY + y;
  move.bottomX = move.stack.relToAbsX(move.stack.dim.rw);
  move.bottomY = move.stack.relToAbsY(move.stack.dim.rh);
  // Move the BlockStack to the correct location.
  move.stack.move(CodeManager.dragAbsToRelX(move.topX), CodeManager.dragAbsToRelY(move.topY));
  // If the BlockStack overlaps with the BlockPalette then no slots are highlighted.
  var wouldDelete = BlockPalette.isStackOverPalette(move.touchX, move.touchY);
  if (FinchBlox) {
    wouldDelete |= TitleBar.isStackOverTitleBar(move.touchX, move.touchY);
  }
  if (wouldDelete) {
    Highlighter.hide(); // Hide any existing highlight.
    if (!move.startedFromPalette) {
      BlockPalette.showTrash();
    }
  } else {
    BlockPalette.hideTrash();
    // The slot which fits it best (if any) will be stored in BlockMoveManager.fit.bestFit.
    this.findBestFit();
    if (this.fit.found) {
      if (FinchBlox) {
        let fit = this.fit.bestFit;
        Highlighter.showShadow(fit, move.stack);
      } else {
        this.fit.bestFit.highlight(); // If such a slot exists, highlight it.
      }
    } else {
      Highlighter.hide(); // If not, hide any existing highlight.
    }
  }

};

/**
 * Drops the BlockStack that is currently moving and connects it to the Slot/Block that fits it.
 */
BlockMoveManager.prototype.end = function() {
  const move = this.move; // shorthand
  const fit = this.fit; // shorthand

  move.topX = move.offsetX + move.touchX;
  move.topY = move.offsetY + move.touchY;
  move.bottomX = move.stack.relToAbsX(move.stack.dim.rw);
  move.bottomY = move.stack.relToAbsY(move.stack.dim.rh);
  // If the BlockStack overlaps with the BlockPalette, delete it.
  var shouldDelete = BlockPalette.isStackOverPalette(move.touchX, move.touchY);
  if (FinchBlox) {
    shouldDelete |= TitleBar.isStackOverTitleBar(move.touchX, move.touchY);
  }
  if (shouldDelete) {
    if (move.startedFromPalette) {
      move.stack.remove();
    } else {
      UndoManager.deleteStack(move.stack);
      SaveManager.markEdited();
    }
  } else {
    // The Block/Slot which fits it best (if any) will be stored in BlockMoveManager.fit.bestFit.
    this.findBestFit();
    if (fit.found) {
      // Snap is onto the Block/Slot that fits it best.
      fit.bestFit.snap(move.stack.firstBlock);
      Sound.playSnap();
      SaveManager.markEdited();
    } else if (BlockMoveManager.wouldExceedProgramLimit(move.stack)) {
      // Landing here would make this a new top-level stack, i.e. one more
      // program than the board can run. Refuse instead of accepting it and
      // failing later at send time.
      if (move.startedFromPalette) {
        // Never existed on the canvas: drop it as if it went back to the palette.
        move.stack.remove();
      } else {
        // Came off an existing stack, so it holds the child's blocks. Delete
        // through UndoManager so the gesture stays recoverable.
        UndoManager.deleteStack(move.stack);
        SaveManager.markEdited();
      }
      console.log("[blocks] limite de " + ProgramCompiler.MAX_HANDLERS +
        " programas alcanzado; no se creo un stack nuevo");
    } else {
      // If it is not going to be snapped or deleted, simply drop it onto the current tab.
      move.stack.land();
      move.stack.updateDim(); // Fix! this line of code might not be needed.
      SaveManager.markEdited();
    }
  }
  Highlighter.hide(); // Hide any existing highlight.
  BlockPalette.hideTrash();

};

/**
 * Drops the BlockStack where it is without attaching it to anything or deleting it.
 */
BlockMoveManager.prototype.interrupt = function() {
  const move = this.move; // shorthand

  move.topX = move.offsetX + move.touchX;
  move.topY = move.offsetY + move.touchY;
  move.stack.land();
  move.stack.updateDim(); // Fix! this line of code might not be needed.
  Highlighter.hide(); // Hide any existing highlight.

};

/**
 * Recursively searches for the Block/Slot that best fits the moving BlockStack.
 * All results are stored in BlockMoveManager.fit.  Nothing is returned.
 */
BlockMoveManager.prototype.findBestFit = function() {
  const fit = this.fit; // shorthand
  fit.found = false; // Have any matching slot/block been found?
  fit.bestFit = null; // Slot/Block that is closest to the item?
  fit.dist = 0; // How far is the best candidate from the ideal location?
  TabManager.activeTab.findBestFit(this); // Begins the recursive calls.
};
