"use strict";

/**
 * The BlockPalette is the side panel on the left that holds all the Blocks.  BlockPalette is a static class, since
 * there is only one Palette.  The BlockPalette class creates and manages a set of Categories, each of which
 * controls the Blocks inside it and the CategoryBN that brings it into the foreground.
 */
function BlockPalette() {
  BlockPalette.categories = []; // List of categories
  BlockPalette.selectedCat = null; // category in the foreground
  BlockPalette.createCatBg(); // Black bar along left side of screen
  BlockPalette.createPalBg(); // Dark gray rectangle behind the CategoryBNs
  BlockPalette.createCategories();
  BlockPalette.selectFirstCat();
  BlockPalette.visible = true;
  // Stores a group featuring a trash icon that appears when Blocks are dragged over it
  BlockPalette.trash = null;
  if (GuiElements.paletteLayersVisible && SettingsManager.sideBarVisible.getValue() !== "true") {
    // Hide the Palette if it should be hidden but isn't
    GuiElements.hidePaletteLayers(true);
  }
}
BlockPalette.setGraphics = function() {

  // Dimensions used within a category
  BlockPalette.mainVMargin = 10; // The space before the first Block in a Category
  BlockPalette.mainHMargin = Button.defaultMargin; // The space between the Blocks and the left side of the screen
  BlockPalette.sectionMargin = 10; // The additional space added between sections
  BlockPalette.insideBnH = 38; // Height of buttons within a category (such as Create Variable button)
  BlockPalette.insideBnW = 150; // Width of buttons within a category

  BlockPalette.catVMargin = Button.defaultMargin; // Margins between buttons
  BlockPalette.catHMargin = Button.defaultMargin;

  // Dimensions for the region with CategoryBNs
  if (FinchBlox) {
    //Bandeja flotante SmartTEAM: separada de los bordes, tinte por categoría
    //y muesca central ("panza" hacia adentro) donde anidan las pestañas,
    //como el FinchBlox original
    BlockPalette.inset = 14;
    BlockPalette.cornerRadius = 26;
    BlockPalette.notchRadius = 10; //la muesca baja 2*notchRadius
    BlockPalette.width = GuiElements.width;
    BlockPalette.height = 120;
    BlockPalette.y = GuiElements.height - BlockPalette.height - BlockPalette.inset;
    BlockPalette.bg = Colors.stCyanTint;
    BlockPalette.mainVMargin = 34; //centra verticalmente los bloques bajo la muesca
    BlockPalette.catW = 300;
    BlockPalette.catX = GuiElements.width / 2 - BlockPalette.catW / 2;
    BlockPalette.catH = 52;
    //Las pestañas apoyan sobre el piso de la muesca
    BlockPalette.catY = BlockPalette.y + 2 * BlockPalette.notchRadius - BlockPalette.catH;
    BlockPalette.blockMargin = 20; // The horizontal spacing between Blocks
    BlockPalette.trashHeight = BlockPalette.height * 0.6;
    BlockPalette.trashIconVP = VectorPaths.faTrash;
    BlockPalette.trashOpacity = 0.9;
    BlockPalette.trashColor = Colors.stGray400;
    BlockPalette.blockButtonOverhang = 10; //12; //How much block buttons are allowd to hang over the bottom of the block
  } else {
    BlockPalette.width = 253;
    BlockPalette.catY = TitleBar.height;
    BlockPalette.catH = 30 * 3 + BlockPalette.catVMargin * 3; // 3 rows of BNs, 3 margins, 30 = height per BN
    BlockPalette.height = GuiElements.height - TitleBar.height - BlockPalette.catH;
    BlockPalette.y = BlockPalette.catY + BlockPalette.catH;
    BlockPalette.bg = Colors.white;
    BlockPalette.catW = BlockPalette.width;
    BlockPalette.catX = 0;
    BlockPalette.blockMargin = 5; // The vertical spacing between Blocks
    BlockPalette.trashHeight = 120;
    BlockPalette.trashIconVP = VectorPaths.trash;
    BlockPalette.trashOpacity = 0.8;
    BlockPalette.trashColor = Colors.black;
  }

  BlockPalette.catBg = Colors.white;
  BlockPalette.labelFont = Font.uiFont(13);
  BlockPalette.labelColor = Colors.black;


};

/**
 * Called when the zoom level changes or the screen is resized to recompute dimensions
 */
BlockPalette.updateZoom = function() {
  let BP = BlockPalette;
  BP.setGraphics();
  if (FinchBlox) {
    BP.palRect.setAttributeNS(null, "d", BP.trayPathD());
    GuiElements.update.rect(BP.catRect, 0, BP.catY, 0, BP.catH);
  } else {
    GuiElements.update.rect(BP.palRect, 0, BP.y, BP.width, BP.height);
    GuiElements.update.rect(BP.catRect, 0, BP.catY, BP.width, BP.catH);
  }
  //GuiElements.move.group(GuiElements.layers.categories, 0, TitleBar.height);
  GuiElements.move.group(GuiElements.layers.categories, BP.catX, BP.catY);
  for (let i = 0; i < BlockPalette.categories.length; i++) {
    BlockPalette.categories[i].updateZoom();
  }
};

/**
 * Creates the gray rectangle below the CategoryBNs
 */
BlockPalette.createCatBg = function() {
  //if(!FinchBlox){
  let BP = BlockPalette;
  let bgW = BP.catW;
  if (FinchBlox) {
    bgW = 0;
  }
  //BP.catRect = GuiElements.draw.rect(0, BP.catY, BP.width, BP.catH, BP.catBg);
  //BP.catRect = GuiElements.draw.rect(BP.catX, BP.catY, BP.catW, BP.catH, BP.catBg);
  BP.catRect = GuiElements.draw.rect(BP.catX, BP.catY, bgW, BP.catH, BP.catBg);
  GuiElements.layers.catBg.appendChild(BP.catRect);
  //GuiElements.move.group(GuiElements.layers.categories, 0, TitleBar.height);
  GuiElements.move.group(GuiElements.layers.categories, BP.catX, BP.catY);
  //}

};

/**
 * Creates the long black rectangle on the left of the screen
 */
BlockPalette.createPalBg = function() {
  let BP = BlockPalette;
  if (FinchBlox) {
    //Bandeja flotante con esquinas redondeadas y muesca para las pestañas
    BP.palRect = GuiElements.create.path(GuiElements.layers.paletteBG);
    BP.palRect.setAttributeNS(null, "fill", BP.bg);
    BP.palRect.setAttributeNS(null, "d", BP.trayPathD());
  } else {
    BP.palRect = GuiElements.draw.rect(0, BP.y, BP.width, BP.height, BP.bg);
    GuiElements.layers.paletteBG.appendChild(BP.palRect);
  }
};

/**
 * Contorno de la bandeja FinchBlox: rectángulo redondeado cuyo borde superior
 * baja en el centro (S-curvas) formando el hueco donde anidan las pestañas
 * de categoría.
 * @return {string} - atributo "d" del path
 */
BlockPalette.trayPathD = function() {
  const BP = BlockPalette;
  const x0 = BP.inset;
  const W = BP.width - 2 * BP.inset;
  const H = BP.height;
  const r0 = BP.cornerRadius;
  const rN = BP.notchRadius;
  const cx = BP.width / 2;
  //La muesca se ajusta a la cantidad de pestañas del nivel actual
  let tabCount = 3;
  if (BP.categories != null && BP.categories.length > 0 && typeof LevelManager !== "undefined") {
    let visible = 0;
    BP.categories.forEach(function(cat) {
      if (cat.level == LevelManager.currentLevel) visible++;
    });
    if (visible > 0) tabCount = visible;
  }
  const gapHalf = (tabCount * CategoryBN.width + (tabCount - 1) * CategoryBN.hMargin) / 2 + 16;
  const notchLeft = cx - gapHalf - 2 * rN;

  var d = "m " + (x0 + r0) + "," + BP.y;
  d += " l " + (notchLeft - (x0 + r0)) + ",0";
  d += " a " + rN + " " + rN + " 0 0 1 " + rN + " " + rN;
  d += " a " + rN + " " + rN + " 0 0 0 " + rN + " " + rN;
  d += " l " + (2 * gapHalf) + ",0";
  d += " a " + rN + " " + rN + " 0 0 0 " + rN + " " + (-rN);
  d += " a " + rN + " " + rN + " 0 0 1 " + rN + " " + (-rN);
  d += " l " + ((x0 + W - r0) - (cx + gapHalf + 2 * rN)) + ",0";
  d += " a " + r0 + " " + r0 + " 0 0 1 " + r0 + " " + r0;
  d += " l 0," + (H - 2 * r0);
  d += " a " + r0 + " " + r0 + " 0 0 1 " + (-r0) + " " + r0;
  d += " l " + (-(W - 2 * r0)) + ",0";
  d += " a " + r0 + " " + r0 + " 0 0 1 " + (-r0) + " " + (-r0);
  d += " l 0," + (-(H - 2 * r0));
  d += " a " + r0 + " " + r0 + " 0 0 1 " + r0 + " " + (-r0);
  d += " z";
  return d;
};

BlockPalette.updatePaletteColor = function(color) {
  GuiElements.update.color(BlockPalette.palRect, color);
}

/**
 * Creates the categories listed in the BlockList
 */
BlockPalette.createCategories = function() {
  const catCount = BlockList.catCount();

  if (FinchBlox) {
    let currentY = 0;
    let currentX = BlockPalette.catW / 2 - 1.5 * CategoryBN.width - CategoryBN.hMargin;
    for (let i = 0; i < catCount; i++) {
      const currentCat = new Category(currentX, currentY, BlockList.getCatName(i), BlockList.getCatId(i));
      BlockPalette.categories.push(currentCat);
      if (i == 2) {
        currentX = BlockPalette.catW / 2 - 1.5 * CategoryBN.width - CategoryBN.hMargin;
      } else if (i == 5) {
        //currentX = BlockPalette.catW/2 - 2.5*CategoryBN.width - 2*CategoryBN.hMargin;
        currentX = BlockPalette.catW / 2 - 2 * CategoryBN.width - 1.5 * CategoryBN.hMargin;
      } else {
        currentX += CategoryBN.width + CategoryBN.hMargin;
      }
    }

  } else {
    const numberOfRows = Math.ceil(catCount / 2);

    // Automatically alternates between two columns while adding categories
    const col1X = BlockPalette.catHMargin;
    const col2X = BlockPalette.catHMargin + CategoryBN.hMargin + CategoryBN.width;

    let firstColumn = true;
    let currentY = BlockPalette.catVMargin;
    let currentX = col1X;
    let usedRows = 0;
    for (let i = 0; i < catCount; i++) {
      if (firstColumn && usedRows >= numberOfRows) {
        currentX = col2X;
        firstColumn = false;
        currentY = BlockPalette.catVMargin;
      }
      const currentCat = new Category(currentX, currentY, BlockList.getCatName(i), BlockList.getCatId(i));
      BlockPalette.categories.push(currentCat);
      usedRows++;
      currentY += CategoryBN.height + CategoryBN.vMargin;
    }
  }


};

/**
 * Retrieves the category with the given id.  Called when a specific category needs to be refreshed
 * @param {string} id
 * @return {Category}
 */
BlockPalette.getCategory = function(id) {
  let i = 0;
  while (BlockPalette.categories[i].id !== id) {
    i++;
  }
  return BlockPalette.categories[i];
};

/**
 * Selects the first category, making it visible on the screen
 */
BlockPalette.selectFirstCat = function() {
  BlockPalette.categories[0].select();
};

/**
 * Determines whether the specified point is over the Palette.  Used for determining if Blocks should be deleted
 * @param {number} x
 * @param {number} y
 * @return {boolean}
 */
BlockPalette.isStackOverPalette = function(x, y) {
  const BP = BlockPalette;
  if (!GuiElements.paletteLayersVisible) return false;
  return CodeManager.move.pInRange(x, y, 0, BP.catY, BP.width, GuiElements.height - TitleBar.height);
};

/**
 * Makes a trash can icon appear over the Palette to indicate that the Blocks being dragged will be deleted
 */
BlockPalette.showTrash = function() {
  let BP = BlockPalette;
  // If the trash is not visible
  if (!BP.trash) {
    BP.trash = GuiElements.create.group(0, 0);
    let trashBg;
    if (FinchBlox) {
      //Usa el tinte de la categoría activa para fundirse con la bandeja
      let bgColor = BP.bg;
      if (BP.selectedCat != null && Colors.blockPalette[BP.selectedCat.id] != null) {
        bgColor = Colors.blockPalette[BP.selectedCat.id];
      }
      trashBg = GuiElements.create.path(BP.trash);
      trashBg.setAttributeNS(null, "d", BP.trayPathD());
      trashBg.setAttributeNS(null, "fill", bgColor);
    } else {
      trashBg = GuiElements.draw.rect(0, BP.y, BP.width, BP.height, BP.bg);
    }
    GuiElements.update.opacity(trashBg, BP.trashOpacity);
    BP.trash.appendChild(trashBg);

    let trashWidth = VectorIcon.computeWidth(BP.trashIconVP, BP.trashHeight);
    let imgX = BP.width / 2 - trashWidth / 2; // Center X
    let imgY = BP.y + BP.height / 2 - BP.trashHeight / 2; // Center Y
    let trashIcon = new VectorIcon(imgX, imgY, BP.trashIconVP, BP.trashColor, BP.trashHeight, BP.trash);

    // Add to group
    GuiElements.layers.trash.appendChild(BP.trash);
  }
};

/**
 * Removes the trash icon
 */
BlockPalette.hideTrash = function() {
  let BP = BlockPalette;
  if (BP.trash) {
    BP.trash.remove();
    BP.trash = null;
  }
};

/**
 * Recursively tells a specific section of a category to expand/collapse
 * @param {string} id - The id of the section
 * @param {boolean} collapsed - Whether the section should expand or collapse
 */
BlockPalette.setSuggestedCollapse = function(id, collapsed) {
  BlockPalette.passRecursively("setSuggestedCollapse", id, collapsed);
};

/**
 * Recursively tells categories that a file is now open
 */
BlockPalette.markOpen = function() {
  BlockPalette.passRecursively("markOpen");
};

/**
 * Recursively passes message to all children (Categories and their children) of the Palette
 * @param {string} message
 */
BlockPalette.passRecursivelyDown = function(message) {
  Array.prototype.unshift.call(arguments, "passRecursivelyDown");
  BlockPalette.passRecursively.apply(BlockPalette, arguments);
};

/**
 * Recursively passes a message to all categories
 * @param {string} functionName - The function to call on each category
 */
BlockPalette.passRecursively = function(functionName) {
  const args = Array.prototype.slice.call(arguments, 1);
  BlockPalette.categories.forEach(function(category) {
    category[functionName].apply(category, args);
  });
};

/**
 * Reloads all categories.  Called when a new file is opened.
 */
BlockPalette.refresh = function() {
  BlockPalette.categories.forEach(function(category) {
    category.refreshGroup();
  })
};

/**
 * For FinchBlox. Shows/hides appropriate categories for selected level.
 */
BlockPalette.setLevel = function() {
  BlockPalette.categories.forEach(function(category) {
    category.button.setHidden();
  })
  //La muesca de la bandeja se adapta a la cantidad de pestañas del nivel
  BlockPalette.palRect.setAttributeNS(null, "d", BlockPalette.trayPathD());
  //  switch (LevelMenu.currentLevel){
  switch (LevelManager.currentLevel) {
    case 1:
      BlockPalette.getCategory("motion_1").select();
      break;
    case 2:
      BlockPalette.getCategory("motion_2").select();
      break;
    case 3:
      BlockPalette.getCategory("motion_3").select();
      break;
  }
}
