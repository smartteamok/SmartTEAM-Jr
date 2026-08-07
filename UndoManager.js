/**
 * The UndoManager is a static class that keeps a stack (as in the data structure) of recently deleted BlockStacks
 * so they can be undeleted.  It can be assigned an undo button, which it will then enable/disable as necessary.
 * The UndoManager stores the deleted BlockStacks as XML nodes.
 */
function UndoManager() {
  const UM = UndoManager;
  UM.undoButton = null;
  UM.undoStack = [];
  UM.undoLimit = 20;
}

/**
 * Assigns a button to the UndoManager, which automatically enables/disables the button and adds the appropriate
 * callback functions
 * @param {Button} button
 */
UndoManager.setUndoButton = function(button) {
  const UM = UndoManager;
  UM.undoButton = button;
  UM.undoButton.setCallbackFunction(UndoManager.undoDelete, true);
  UM.updateButtonEnabled();
};

/**
 * Deletes a Comment and adds it to the undo stack.  If the stack is larger
 * than the limit, the last item is removed.
 * @param stack
 */
UndoManager.deleteComment = function(comment) {
  const UM = UndoManager;
  const doc = XmlWriter.newDoc("undoData");
  var commentData = comment.createXml(doc);
  comment.delete()
  UM.undoStack.push(commentData);
  while (UM.undoStack.length > UM.undoLimit) {
    UM.undoStack.shift();
  }
  UM.updateButtonEnabled();
}

/**
 * Deletes a BlockStack and adds it to the undo stack.  If the stack is larger
 * than the limit, the last item is removed.
 * @param stack
 */
UndoManager.deleteStack = function(stack) {
  const UM = UndoManager;
  const doc = XmlWriter.newDoc("undoData");
  var stackData;
  if (FinchBlox && (LevelManager.currentLevel != 3) && stack.firstBlock.isStartBlock) {
    TabManager.activeTab.addStartBlock();
    if (stack.firstBlock.nextBlock != null) {
      stackData = stack.createXml(doc, true);
    } else {
      stack.remove();
      return;
    }
  } else {
    stackData = stack.createXml(doc);
  }
  stack.deleteComments();
  stack.remove();
  UM.undoStack.push(stackData);
  while (UM.undoStack.length > UM.undoLimit) {
    UM.undoStack.shift();
  }
  UM.updateButtonEnabled();
};

/**
 * Deletes the entire contents of the active tab
 * Used in FinchBlox for the trash button.
 */
UndoManager.deleteTab = function() {
  const UM = UndoManager;
  const tab = TabManager.activeTab;
  const doc = XmlWriter.newDoc("undoData");
  var tabData;
  if (FinchBlox && (LevelManager.currentLevel != 3)) {
    tabData = tab.createXml(doc, true);
    tab.clear();
    TabManager.activeTab.addStartBlock();
  } else {
    tabData = tab.createXml(doc);
    tab.clear();
  }
  UM.undoStack.push(tabData);
  while (UM.undoStack.length > UM.undoLimit) {
    UM.undoStack.shift();
  }
  UM.updateButtonEnabled();
}

/**
 * Pops an item from the stack and rebuilds it, placing it in the corner of the canvas
 */
/**
 * How many programs restoring this undo entry would add to the tab.
 *
 * An entry is a single stack, a whole tab (several stacks at once, from the trash
 * button), or a comment. Only stacks become programs the board has to run.
 * @param {Node} stackNode
 * @return {number}
 */
UndoManager.programsIn = function(stackNode) {
  if (stackNode == null) {
    return 0;
  }
  if (stackNode.nodeName === "comment") {
    return 0;
  }
  if (stackNode.nodeName === "tab") {
    const stacksNode = XmlWriter.findSubElement(stackNode, "stacks");
    return XmlWriter.findSubElements(stacksNode, "stack").length;
  }
  return 1;
};

/**
 * Whether restoring the next undo entry would push the tab past the number of
 * programs the board can run concurrently.
 *
 * Undo is the one way left to exceed that limit: dropping is refused and the
 * palette hats are greyed out, but restoring a deleted program bypassed both and
 * produced a canvas that only failed later, at send time.
 * @return {boolean}
 */
UndoManager.wouldExceedProgramLimit = function() {
  const UM = UndoManager;
  if (!FinchBlox || typeof BlockMoveManager === "undefined" ||
      typeof ProgramCompiler === "undefined" || UM.undoStack.length === 0) {
    return false;
  }
  const next = UM.undoStack[UM.undoStack.length - 1];
  const adding = UM.programsIn(next);
  if (adding === 0) {
    return false;
  }
  const current = BlockMoveManager.countPrograms(null);
  return current + adding > ProgramCompiler.MAX_HANDLERS;
};

UndoManager.undoDelete = function() {
  const UM = UndoManager;
  /* Refuse rather than restore something that cannot run. Saying so, and saying
   * what to do about it, beats letting the canvas fill up and failing only when the
   * child presses send. */
  if (UM.wouldExceedProgramLimit()) {
    DialogManager.showAlertDialog(AppName,
      Language.getStr("undo_program_limit"), Language.getStr("OK"));
    return;
  }
  /* The loop condition has to include the stack being non-empty, not just "no
   * success yet". Tab.undoDelete returns false when the entry cannot be imported,
   * and the emptiness check used to happen only once, before the loop: if every
   * entry failed, this popped the whole history and then called undoDelete with
   * undefined, which throws on reading .nodeName. So one unimportable entry both
   * wiped the undo history and blew up. */
  let success = false;
  while (!success && UM.undoStack.length > 0) {
    success = TabManager.undoDelete(UM.undoStack.pop());
  }
  UM.updateButtonEnabled();
  if (success) {
    SaveManager.markEdited();
  }
};

/**
 * Updates the enabled/disabled state of the undo button based in if the stack is empty
 */
UndoManager.updateButtonEnabled = function() {
  const UM = UndoManager;
  if (UM.undoButton == null) return;
  if (UM.undoStack.length > 0) {
    UM.undoButton.enable();
  } else {
    UM.undoButton.disable();
  }
};

/**
 * Deletes the undo stack (for when a program is closed/opened)
 */
UndoManager.clearUndos = function() {
  const UM = UndoManager;
  UM.undoStack = [];
  UM.updateButtonEnabled();
};
