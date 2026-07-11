/**
 * The bar at the top of the screen.  The TitleBar is a static class which builds the title bar when TitleBar() is
 * called by GuiElements.  It changes its appearance on small screens, becoming shorter and adding a show/hide button
 * to show/hide the BlockPalette.  Its title shows the name of the current project.
 */
function TitleBar() {
  let TB = TitleBar;
  TB.titleTextVisble = true;
  TB.titleText = "";
  TB.prevTitleText = "";
  TB.debugEnabled = false;
  TitleBar.createBar();
  TitleBar.makeButtons();
  TitleBar.makeTitleText();
}

/**
 * The TitleBar must set certain graphics before the BlockPalette, but others after.  Thus it has two setGraphics
 * functions.
 */
TitleBar.setGraphicsPart1 = function() {
  const TB = TitleBar;
  if (GuiElements.smallMode) {
    TB.height = 35;
    TB.buttonMargin = Button.defaultMargin / 2;
  } else {
    if (FinchBlox) {
      //Barra flotante SmartTEAM: separada de los bordes, esquinas redondeadas
      //y muesca central cóncava donde cuelgan Play/Stop. El logo va arriba,
      //centrado sobre la muesca.
      TB.inset = 14; //separación de la barra a los bordes
      TB.barH = 84; //alto de la barra flotante
      TB.barRadius = 26; //redondeo de esquinas exteriores
      TB.notchDepth = 30; //cuánto sube el borde inferior en el centro (muesca)
      TB.notchShoulder = 16; //radio de los hombros de la muesca (curva suave)
      TB.height = TB.barH + 2 * TB.inset;
      TB.solidHeight = 0; //el lienzo pasa por detrás de la barra flotante
    } else {
      TB.height = 54;
    }
    TB.buttonMargin = Button.defaultMargin;
  }
  TB.width = GuiElements.width;

  if (FinchBlox) {
    TB.tallButtonH = 62;
    TB.buttonH = 54; //botones cuadrados secundarios (nivel)
    TB.buttonW = 54;
    const maxBnWidth = (TB.width - 6 * TB.buttonMargin) / 8;
    TB.buttonW = Math.min(maxBnWidth, TB.buttonW);
    TB.longButtonW = 112; //ancho de Play y Stop (botones PRINCIPALES)
    const maxLongBnW = maxBnWidth * 2;
    TB.longButtonW = Math.min(maxLongBnW, TB.longButtonW);

    TB.bnIconMargin = 3;
    TB.bg = Colors.stViolet;
    TB.bnIconH = 26;
    const maxIconHeight = maxBnWidth * 0.7;
    TB.bnIconH = Math.min(maxIconHeight, TB.bnIconH);

    TB.defaultCornerRounding = 20;
  } else {
    TB.buttonW = TB.height * 64 / 54;
    const maxBnWidth = (TB.width - 11 * TB.buttonMargin - DeviceStatusLight.radius * 2) / 7;
    TB.buttonW = Math.min(maxBnWidth, TB.buttonW);
    TB.longButtonW = 85;
    TB.bnIconMargin = 3;
    TB.bg = Colors.lightGray;
    TB.buttonH = TB.height - 2 * TB.buttonMargin;
    TB.bnIconH = TB.buttonH - 2 * TB.bnIconMargin;
    const maxIconHeight = maxBnWidth * 0.7;
    TB.bnIconH = Math.min(maxIconHeight, TB.bnIconH);
  }
  TB.flagFill = Colors.green;
  TB.batteryFill = Colors.lightGray;
  TB.stopFill = Colors.red;
  TB.titleColor = Colors.white;
  TB.font = Font.uiFont(16).bold();

  TB.shortButtonW = TB.buttonH;
  TB.shortButtonW = TB.buttonW;
};

TitleBar.setGraphicsPart2 = function() {
  /* Compute the locations of all the buttons */
  const TB = TitleBar
  if (FinchBlox) {
    TB.finchBnX = 2 * TB.buttonMargin;
    //TB.levelBnX = TB.finchBnX + TB.finchBnW + TB.buttonMargin;
    //TB.levelBnY = (TB.height/2) - (TB.tallButtonH/2);
    //TB.levelBnX = TB.width - TB.sideWidth/2 - TB.buttonMargin/2 - TB.buttonW;
    TB.flagBnX = (GuiElements.width - TB.buttonMargin) / 2 - TB.longButtonW;
    TB.stopBnX = (GuiElements.width + TB.buttonMargin) / 2;
    //TB.trashBnX = GuiElements.width - 2 * TB.buttonMargin - TB.buttonW;
    //TB.undoBnX = TB.trashBnX - TB.buttonW - TB.buttonMargin;
    //TB.undoBnX = TB.width - TB.sideWidth/2 + TB.buttonMargin/2;
  } else {
    TB.stopBnX = GuiElements.width - TB.buttonW - TB.buttonMargin;
    TB.flagBnX = TB.stopBnX - TB.buttonW - TB.buttonMargin;
    TB.undoBnX = TB.flagBnX - TB.buttonW - TB.buttonMargin;
  }

  TB.batteryBnX = TB.undoBnX - TB.buttonW - TB.buttonMargin;
  TB.debugX = TB.batteryBnX - TB.longButtonW - TB.buttonMargin;

  TB.fileBnX = TB.buttonMargin;
  TB.viewBnX = TB.fileBnX + TB.buttonMargin + TB.buttonW;
  TB.hummingbirdBnX = TB.viewBnX + TB.buttonMargin + TB.buttonW;

  TB.titleLeftX = BlockPalette.width;
  TB.titleRightX = TB.undoBnX - TB.buttonMargin;
  TB.titleWidth = TB.titleRightX - TB.titleLeftX;

  let suggestedUndoBnX = TB.hummingbirdBnX + TB.buttonW + TB.buttonMargin;
  if (TB.undoBnX < suggestedUndoBnX) {
    TB.hummingbirdBnX = TB.undoBnX - TB.buttonW - TB.buttonMargin;
  }
  TB.statusX = TB.hummingbirdBnX + 2 * TB.buttonMargin;
};

/**
 * Creates the rectangle for the TitleBar
 */
TitleBar.createBar = function() {
  const TB = TitleBar;
  if (FinchBlox) {
    //Barra flotante violeta con esquinas redondeadas y muesca central
    TB.bgRect = GuiElements.create.path(GuiElements.layers.titleBg);
    TB.bgRect.setAttributeNS(null, "fill", TB.bg);
    TB.bgRect.setAttributeNS(null, "d", TB.barPathD());
  } else {
    TB.bgRect = GuiElements.draw.rect(0, 0, TB.width, TB.height, TB.bg);
    GuiElements.layers.titleBg.appendChild(TB.bgRect);
  }
};

/**
 * Contorno de la barra flotante FinchBlox: rectángulo redondeado con una
 * muesca cóncava en el borde inferior que abraza a Play/Stop. Comandos
 * absolutos, simétrico. Deja los límites de la muesca en TB.notchLeftX /
 * TB.notchRightX para ubicar los botones.
 * @return {string} - atributo "d" del path
 */
TitleBar.barPathD = function() {
  const TB = TitleBar;
  const x = TB.inset, y = TB.inset;
  const W = TB.width - 2 * TB.inset;
  const H = TB.barH;
  const r = TB.barRadius;
  const dep = TB.notchDepth;
  const sh = TB.notchShoulder;
  const cx = TB.width / 2;
  const half = TB.longButtonW + TB.buttonMargin / 2 + 12; //medio ancho del par Play+Stop
  const nL = cx - half, nR = cx + half;
  TB.notchLeftX = nL;
  TB.notchRightX = nR;

  let d = "M " + (x + r) + " " + y;
  d += " H " + (x + W - r);
  d += " A " + r + " " + r + " 0 0 1 " + (x + W) + " " + (y + r); //esq. sup-der
  d += " V " + (y + H - r);
  d += " A " + r + " " + r + " 0 0 1 " + (x + W - r) + " " + (y + H); //esq. inf-der
  d += " H " + (nR + sh);
  d += " A " + sh + " " + sh + " 0 0 1 " + nR + " " + (y + H - sh); //hombro der (sube)
  d += " V " + (y + H - dep + sh);
  d += " A " + sh + " " + sh + " 0 0 0 " + (nR - sh) + " " + (y + H - dep); //al techo
  d += " H " + (nL + sh); //techo de la muesca
  d += " A " + sh + " " + sh + " 0 0 0 " + nL + " " + (y + H - dep + sh); //baja izq
  d += " V " + (y + H - sh);
  d += " A " + sh + " " + sh + " 0 0 1 " + (nL - sh) + " " + (y + H); //hombro izq (baja)
  d += " H " + (x + r);
  d += " A " + r + " " + r + " 0 0 1 " + x + " " + (y + H - r); //esq. inf-izq
  d += " V " + (y + r);
  d += " A " + r + " " + r + " 0 0 1 " + (x + r) + " " + y; //esq. sup-izq
  d += " Z";
  return d;
};

/**
 * Creates all the buttons and menus
 */
TitleBar.makeButtons = function() {
  const TB = TitleBar;
  const TBLayer = GuiElements.layers.titlebar;
  if (FinchBlox) {
    const r = TB.defaultCornerRounding;
    const edge = TB.inset + 18; //padding interno de la barra flotante
    //Jerarquía de tamaños: Play/Stop principales, Conectar/Nivel secundarios,
    //Deshacer/toggle terciarios. Cada grupo centrado en la barra por su alto.
    const primaryH = 66; //Play / Stop
    const secondaryH = 54; //Conectar, Nivel
    const tertiaryH = 46; //Deshacer
    const secondaryY = TB.inset + (TB.barH - secondaryH) / 2;
    const tertiaryY = TB.inset + (TB.barH - tertiaryH) / 2;

    // Logo SmartTEAM blanco, centrado en la franja superior de la muesca
    const logoH = 34;
    const logoW = logoH * 611.316 / 374; //proporción del SVG del logo
    const logoX = (TB.width - logoW) / 2;
    const logoY = TB.inset + (TB.barH - TB.notchDepth - logoH) / 2;
    TB.logoImg = GuiElements.create.image();
    TB.logoImg.setAttributeNS("http://www.w3.org/1999/xlink", "href", "Images/smartteam-logo-white.svg");
    TB.logoImg.setAttributeNS(null, "x", logoX);
    TB.logoImg.setAttributeNS(null, "y", logoY);
    TB.logoImg.setAttributeNS(null, "width", logoW);
    TB.logoImg.setAttributeNS(null, "height", logoH);
    TB.logoImg.setAttributeNS(null, "visibility", "visible");
    TBLayer.appendChild(TB.logoImg);

    TB.updateStatus = function(status) {
      GuiElements.alert("TitleBar update status to " + status);
      const bn = TitleBar.finchButton;
      if (bn == null) return;
      const connected = (status === DeviceManager.statuses.connected);
      const color = connected ? Colors.stGreen : Colors.stCoral;
      const statusText = connected ? Language.getStr("Status_Connected") : Language.getStr("Status_Disconnected");
      bn.updateBgColor(color);
      bn.updateRobotStatus(statusText);
      if (connected) {
        DeviceManager.checkBattery();
      }
    }
    DeviceManager.setStatusListener(TB.updateStatus);

    //Conectar robot a la izquierda (secundario); acotado antes de que el
    //borde inferior suba hacia la muesca
    const connectBnX = edge;
    const connectBnW = Math.max(120, Math.min(180, TB.notchLeftX - connectBnX - 8));
    TB.finchButton = new Button(connectBnX, secondaryY, connectBnW, secondaryH, TBLayer, Colors.stCoral, r, r);
    TB.finchButton.addRobotBnContent();
    TB.finchButton.setCallbackFunction(function() {
      switch (DeviceManager.getStatus()) {
        case DeviceManager.statuses.noDevices:
          (new DiscoverDialog(DeviceFinch)).show();
          break;
        case DeviceManager.statuses.connected:
          DeviceManager.removeAllDevices();
          break;
        default:
          DeviceManager.removeAllDevices();
          (new DiscoverDialog(DeviceFinch)).show();
      }
    }, true);

    // Centro: Play / Stop (PRINCIPALES) colgando encastrados en la muesca.
    // En modo vivo Play ejecuta; en modo programa (descarga) el mismo Play
    // compila y transfiere a la placa, y Stop se apaga. No hay botón Enviar
    // aparte. Ver ProgramModeManager.
    const primaryR = 22;
    const playStopY = TB.inset + TB.barH - TB.notchDepth + 4;
    TB.flagBn = new Button(TB.flagBnX, playStopY, TB.longButtonW, primaryH, TBLayer, Colors.flagGreen, primaryR, primaryR);
    TB.flagBn.addIcon(VectorPaths.faPlay, TB.bnIconH);
    TB.flagBn.setCallbackFunction(function() {
      if (ProgramModeManager.isProgramMode()) {
        ProgramModeManager.sendClicked();
      } else {
        CodeManager.eventFlagClicked();
      }
    }, false);

    TB.stopBn = new Button(TB.stopBnX, playStopY, TB.longButtonW, primaryH, TBLayer, Colors.stopRed, primaryR, primaryR);
    TB.stopBn.addIcon(VectorPaths.stStopSquare, TB.bnIconH * 0.9);
    TB.stopBn.setCallbackFunction(CodeManager.stop, false);

    // Derecha: grupo Modo+Nivel (secundarios) junto, aire, y Deshacer
    // (terciario) separado para que se lean como bloques funcionales
    TB.undoBnX = TB.width - TB.inset - 18 - tertiaryH;
    TB.levelBnX = TB.undoBnX - 24 - TB.buttonW; //aire entre grupos

    const cell = 40; //celdas del toggle segmentado
    const cellPad = 4;
    const toggleW = 2 * cell + 3 * cellPad;
    const toggleH = cell + 2 * cellPad;
    const toggleX = TB.levelBnX - TB.buttonMargin - toggleW;
    const toggleY = TB.inset + (TB.barH - toggleH) / 2;
    TB.modeGroup = GuiElements.create.group(toggleX, toggleY, TBLayer);
    const modeBg = GuiElements.draw.rect(0, 0, toggleW, toggleH, Colors.stVioletDark, 16, 16);
    TB.modeGroup.appendChild(modeBg);
    TB.liveCellBn = new Button(cellPad, cellPad, cell, cell, TB.modeGroup, Colors.stVioletDark, 12, 12);
    TB.liveCellBn.addColorIcon(VectorPaths.faBolt, cell * 0.55, Colors.stAmber);
    TB.liveCellBn.setCallbackFunction(function() {
      if (ProgramModeManager.isProgramMode()) {
        ProgramModeManager.toggle();
      }
    }, true);
    TB.progCellBn = new Button(2 * cellPad + cell, cellPad, cell, cell, TB.modeGroup, Colors.stVioletDark, 12, 12);
    TB.progCellBn.addColorIcon(VectorPaths.stChip, cell * 0.55, Colors.white);
    TB.progCellBn.setCallbackFunction(function() {
      if (!ProgramModeManager.isProgramMode()) {
        ProgramModeManager.toggle();
      }
    }, true);

    TB.updateModeButtons = function() {
      const programMode = ProgramModeManager.isProgramMode();
      //Celda activa en blanco; la inactiva se funde con el fondo del toggle
      TB.liveCellBn.updateBgColor(programMode ? Colors.stVioletDark : Colors.white);
      TB.progCellBn.iconColor = programMode ? Colors.stViolet : Colors.white;
      TB.progCellBn.updateBgColor(programMode ? Colors.white : Colors.stVioletDark);
      if (programMode) {
        TB.stopBn.disable();
        GuiElements.update.opacity(TB.stopBn.group, 0.3);
      } else {
        TB.stopBn.enable();
        GuiElements.update.opacity(TB.stopBn.group, 1);
      }
    };
    TB.updateModeButtons();

    TB.undoButton = new Button(TB.undoBnX, tertiaryY, tertiaryH, tertiaryH, TBLayer, Colors.stAmber, 16, 16);
    TB.undoButton.addIcon(VectorPaths.faUndoAlt, TB.bnIconH * 0.75);
    UndoManager.setUndoButton(TB.undoButton);

    TB.levelButton = new Button(TB.levelBnX, secondaryY, TB.buttonW, secondaryH, TBLayer, Colors.white, r, r);
    TB.levelButton.addText(LevelManager.currentLevel, LevelManager.levelButtonFont, Colors.stViolet);
    TB.levelButton.setCallbackFunction(function() {
      (new LevelDialog()).show();
    }, true);

    TB.fileBn = new FBFileNameDisplay();
    const rcBnW = TB.fileBn.H + TB.fileBn.r //TB.shortButtonW
    const rcBnH = TB.fileBn.H - TB.fileBn.margin
    const rcBnX = TB.width - rcBnW + TB.fileBn.r
    const rcBnY = TB.height + 2 * TB.fileBn.margin + TB.fileBn.H
    if (GuiElements.isPWA) {

      //Add the zoom and recenter buttons
      const zoomBnW = 25
      const zoomBnM = 5 
      const bgColor = TB.fileBn.bgColor 
      const zoomGroupY =  (TB.height + 2 * TB.fileBn.margin + TB.fileBn.H)
      const iconColor =  TB.bg 
      TB.zoomBnGroup = GuiElements.create.group(TB.width - zoomBnW - 1.5*zoomBnM, zoomGroupY, TBLayer);
      const zoomBnBg = GuiElements.draw.rect(0, 0, zoomBnW + 3*zoomBnM, 3*zoomBnW + 6*zoomBnM, bgColor, 10, 10);
      TB.zoomBnGroup.appendChild(zoomBnBg);
      const zoomPlusBn = new Button(zoomBnM, 2*zoomBnM, zoomBnW, zoomBnW, TB.zoomBnGroup, bgColor, 5, 5, bgColor)
      zoomPlusBn.addColorIcon(VectorPaths.bdZoomIn, 0.75*zoomBnW, iconColor)
      zoomPlusBn.setCallbackFunction(function() {
        TabManager.wheelZoom(GuiElements.width/2, GuiElements.height/2, false, true)
      }, false)
      const zoomMinusBn = new Button(zoomBnM, 3*zoomBnM + zoomBnW, zoomBnW, zoomBnW, TB.zoomBnGroup, bgColor, 5, 5, bgColor)
      zoomMinusBn.addColorIcon(VectorPaths.bdZoomOut, 0.17*zoomBnW, iconColor)
      zoomMinusBn.setCallbackFunction(function() {
        TabManager.wheelZoom(GuiElements.width/2, GuiElements.height/2, true, true)
      }, false)
      const recenterBn = new Button(zoomBnM, 4*zoomBnM + 2*zoomBnW, zoomBnW, zoomBnW, TB.zoomBnGroup, bgColor, 5, 5, bgColor)
      recenterBn.addColorIcon(VectorPaths.bdRecenter, 0.85*zoomBnW, iconColor)
      recenterBn.setCallbackFunction(function() {
        TabManager.activeTab.recenter()
      }, false)

    } else {

      //Just add recenter button. Users will pinch to zoom
      TB.recenterBn = new Button(rcBnX, rcBnY, rcBnW, rcBnH, TBLayer, TB.fileBn.bgColor, TB.fileBn.r, TB.fileBn.r)
      TB.recenterBn.addColorIcon(VectorPaths.faCrosshairs, TB.bnIconH * 0.5, Colors.bbtDarkGray)
      TB.recenterBn.setCallbackFunction(function() {
        TabManager.activeTab.recenter()
      })
    }

  } else {
    TB.flagBn = new Button(TB.flagBnX, TB.buttonMargin, TB.buttonW, TB.buttonH, TBLayer);
    TB.flagBn.addColorIcon(VectorPaths.flag, TB.bnIconH, TB.flagFill);
    TB.flagBn.setCallbackFunction(CodeManager.eventFlagClicked, false);
    TB.stopBn = new Button(TB.stopBnX, TB.buttonMargin, TB.buttonW, TB.buttonH, TBLayer);
    TB.stopBn.addColorIcon(VectorPaths.stop, TB.bnIconH, TB.stopFill);
    TB.stopBn.setCallbackFunction(CodeManager.stop, false);
    TB.batteryBn = new Button(TB.batteryBnX, TB.buttonMargin, TB.buttonW, TB.buttonH, TBLayer);
    TB.batteryBn.addColorIcon(VectorPaths.battery, TB.bnIconH, TB.batteryFill);
    TB.batteryMenu = new BatteryMenu(TB.batteryBn);

    TB.hummingbirdBn = new Button(TB.hummingbirdBnX, TB.buttonMargin, TB.longButtonW, TB.buttonH, TBLayer);
    const hbBnIconOffset = 2 * TB.buttonMargin;
    TB.hummingbirdBn.addIcon(VectorPaths.connect, TB.bnIconH * 0.8, hbBnIconOffset);
    TB.hummingbirdMenu = new DeviceMenu(TB.hummingbirdBn);
    TB.deviceStatusLight = new DeviceStatusLight(TB.statusX, TB.height / 2, TBLayer, DeviceManager);

    TB.fileBn = new Button(TB.fileBnX, TB.buttonMargin, TB.buttonW, TB.buttonH, TBLayer);
    TB.fileBn.addIcon(VectorPaths.file, TB.bnIconH);
    TB.fileBn.setCallbackFunction(OpenDialog.closeFileAndShowDialog, true);

    TB.viewBn = new Button(TB.viewBnX, TB.buttonMargin, TB.buttonW, TB.buttonH, TBLayer);
    TB.viewBn.addIcon(VectorPaths.settings, TB.bnIconH);
    TB.viewMenu = new SettingsMenu(TB.viewBn);
    TB.viewBn.setLongTouchFunction(function() {
      //DialogManager.showAlertDialog("Test", "Test", "Test");
      GuiElements.alert("Long touch");
      TB.viewMenu.reloadAdvanced();
    });

    TB.undoButton = new Button(TB.undoBnX, TB.buttonMargin, TB.buttonW, TB.buttonH, TBLayer);
    TB.undoButton.addIcon(VectorPaths.undoDelete, TB.bnIconH * 0.9);
    UndoManager.setUndoButton(TB.undoButton);
  }

  TB.debugBn = null;
  if (TB.debugEnabled) {
    TB.enableDebug();
  }
};

/**
 * Removes all the buttons so they can be redrawn
 */
TitleBar.removeButtons = function() {
  let TB = TitleBar;
  TB.flagBn.remove();
  TB.stopBn.remove();
  TB.fileBn.remove();
  TB.undoButton.remove();
  if (FinchBlox) {
    TB.finchButton.remove();
    TB.levelButton.remove();
    if (TB.logoImg != null) TB.logoImg.remove();
    if (TB.modeGroup != null) TB.modeGroup.remove();
    if (TB.recenterBn != null) {
      TB.recenterBn.remove();
      TB.recenterBn = null;
    }
    if (TB.zoomBnGroup != null) {
      TB.zoomBnGroup.remove();
      TB.zoomBnGroup = null;
    }
  } else {
    TB.viewBn.remove();
    TB.hummingbirdBn.remove();
    TB.batteryBn.remove();
    TB.deviceStatusLight.remove();
  }
  if (TB.debugBn != null) TB.debugBn.remove();
  if (TB.showHideBn != null) TB.showHideBn.remove();
};

/**
 * Makes the text element for the TitleBar
 */
TitleBar.makeTitleText = function() {
  const TB = TitleBar;
  TB.titleLabel = GuiElements.draw.text(0, 0, "", TB.font, TB.titleColor);
  GuiElements.layers.titlebar.appendChild(TB.titleLabel);
};



/**
 * Sets the text of the TitleBar
 * @param {string|null} text - The text to display or null if there is no text
 */
TitleBar.setText = function(text) {
  const TB = TitleBar;
  if (text == null) text = TB.prevTitleText;
  else TB.prevTitleText = text;
  TB.titleText = text;
  TitleBar.updateText();
};

/**
 * Moves the text to the correct position
 */
TitleBar.updateText = function() {
  let TB = TitleBar;
  if (GuiElements.width < BlockPalette.width * 2) {
    if (TB.titleTextVisble) {
      // The text doesn't fit.  Hide it.
      TB.titleLabel.remove();
      TB.titleTextVisble = false;
    }
  } else {
    if (!TB.titleTextVisble) {
      // The text fits but is hidden. Show it.
      GuiElements.layers.titlebar.appendChild(TB.titleLabel);
      TB.titleTextVisble = true;
    }
    let maxWidth = TB.titleWidth;
    GuiElements.update.textLimitWidth(TB.titleLabel, TB.titleText, maxWidth);
    let width = GuiElements.measure.textWidth(TB.titleLabel);
    let x = GuiElements.width / 2 - width / 2;
    let y = TB.height / 2 + TB.font.charHeight / 2;
    if (x < TB.titleLeftX) {
      x = TB.titleLeftX;
    } else if (x + width > TB.titleRightX) {
      x = TB.titleRightX - width;
    }
    GuiElements.move.text(TB.titleLabel, x, y);
  }
};

/**
 * Builds the debug Button
 */
TitleBar.enableDebug = function() {
  const TB = TitleBar;
  TB.debugEnabled = true;
  const TBLayer = GuiElements.layers.titlebar;
  if (TB.debugBn == null) {
    TB.debugBn = new Button(TB.debugX, TB.buttonMargin, TB.longButtonW, TB.buttonH, TBLayer);
    TB.debugBn.addText("Debug");
    TB.debugMenu = new DebugMenu(TB.debugBn);
  }
};

/**
 * Hides the debug button
 */
TitleBar.hideDebug = function() {
  TitleBar.debugEnabled = false;
  TitleBar.debugBn.remove();
  TitleBar.debugBn = null;
};

/**
 * Like setGraphics, there are two updateZoom functions
 */
TitleBar.updateZoomPart1 = function() {
  TitleBar.setGraphicsPart1();
};

/**
 * Redraws the buttons
 */
TitleBar.updateZoomPart2 = function() {
  let TB = TitleBar;
  var viewShowing = false;
  if (!FinchBlox) {
    viewShowing = TB.viewBn.toggled;
  }
  TB.setGraphicsPart2();
  if (FinchBlox) {
    TB.bgRect.setAttributeNS(null, "d", TB.barPathD());
  } else {
    GuiElements.update.rect(TB.bgRect, 0, 0, TB.width, TB.height);
  }
  TB.removeButtons();
  TB.makeButtons();
  if (!FinchBlox && viewShowing) {
    // This menu must stay open even while resizing
    TB.viewBn.press();
    TB.viewBn.release();
    // Pressing the button shows the menu.
  }
  TB.updateText();
};

/**
 * Determines whether the specified point is over the TitleBar.  Used for
 * determining if Blocks should be deleted in FinchBlox.
 * @param {number} x
 * @param {number} y
 * @return {boolean}
 */
TitleBar.isStackOverTitleBar = function(x, y) {
  const TB = TitleBar;
  return CodeManager.move.pInRange(x, y, 0, 0, TB.width, TB.height);
}

/**
 * Used in FinchBlox. Flashes the finch button if the user tries to run blocks
 * without a finch connected.
 */
TitleBar.flashFinchButton = function() {
  const finchBn = TitleBar.finchButton;
  if (finchBn != null) {
    finchBn.flash();
  }
}
