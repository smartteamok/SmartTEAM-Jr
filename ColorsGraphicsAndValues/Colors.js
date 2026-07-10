"use strict";
/*
 * Static.  Holds constant values for colors used throughout the UI (lightGray, darkGray, black, white)
 */

function Colors() {
  Colors.setCommon();
  Colors.setCategory();
  Colors.setMultipliers();
}

Colors.setCommon = function() {
  //Gray scale...
  Colors.white = "#FFFFFF"; //"#fff";
  Colors.labelTextDisabled = "#e4e4e4";
  Colors.lightLightGray = "#CDCDCD";
  Colors.windowColor = "#CCC";
  Colors.canvasGray = "#C1C1C1";
  Colors.valueTextGrayed = "#AAAAAA" //"#aaa";
  Colors.mediumLightGray = "#999999" //"#999";
  Colors.lightGray = "#7B7B7B";
  Colors.darkGray = "#282828";
  Colors.darkDarkGray = "#151515";
  Colors.black = "#000000" //"#000";
  //Basic colors
  Colors.red = "#FF0000";
  Colors.green = "#00FF00";
  Colors.blue = "#0000FF";
  Colors.yellow = "#FFFF00";
  Colors.cyan = "#00FFFF";
  Colors.magenta = "#FF00FF";
  Colors.darkRed = "#c00000";
  Colors.lightYellow = "#FFFFCC";
  //Current BBT colors
  Colors.bbt = "#209BA9";
  Colors.tabletOrange = "#FAA525";
  Colors.operatorsGreen = "#8EC449";
  Colors.soundPurple = "#EE00FF";
  Colors.controlYellow = "#FFCC00";
  Colors.variablesDkOrange = "#FF5B00";
  Colors.inactiveGray = "#a3a3a3";
  //SmartTEAM Design System tokens
  Colors.stViolet = "#796EB0";     //violet-500: marca / barra / sonido
  Colors.stVioletDark = "#6457A0"; //violet-600
  Colors.stVioletTint = "#ECE9F4"; //violet-100
  Colors.stCyan = "#35BFE9";       //cyan-500: movimiento
  Colors.stCyanDark = "#1FA9D6";   //cyan-600
  Colors.stCyanTint = "#E1F5FC";   //cyan-100
  Colors.stAmber = "#FFB800";      //amber-500: luces/color, undo
  Colors.stAmberDark = "#F0A500";  //amber-600
  Colors.stAmberTint = "#FFF3D6";  //amber-100
  Colors.stGreen = "#59BB6A";      //green-500: play, sensores, conectado
  Colors.stGreenDark = "#45A156";  //green-600
  Colors.stGreenTint = "#E4F4E7";  //green-100
  Colors.stCoral = "#EF506D";      //coral-500: stop, control, desconectado
  Colors.stCoralDark = "#DA3656";  //coral-600
  Colors.stCoralTint = "#FDE4E9";  //coral-100
  Colors.stPaper = "#F3F7FD";      //fondo del lienzo
  Colors.stInk = "#160A60";        //indigo-ink: texto
  Colors.stGray400 = "#9A9BA0";    //papelera
  //BBT Style guide colors (remapeados a tokens SmartTEAM donde aplica)
  Colors.easternBlue = Colors.stCyan; //antes bbt blue #089BAB, hoy movimiento
  Colors.neonCarrot = Colors.stAmber;
  Colors.fountainBlue = "#62BCC7"; //lighter blue
  Colors.seance = Colors.stViolet; //antes dark purple #881199, hoy sonido/marca
  Colors.bbtDarkGray = "#535353";
  Colors.iron = "#CACACA";
  //FinchBlox
  Colors.blockPaletteMotion = Colors.stCyanTint;
  Colors.blockPaletteColor = Colors.stAmberTint;
  Colors.blockPaletteSound = Colors.stVioletTint;
  Colors.blockPaletteControl = Colors.stCoralTint;
  Colors.flagGreen = Colors.stGreen;
  Colors.fbDarkGreen = Colors.stGreenDark;
  Colors.stopRed = Colors.stCoral;
  Colors.finchGreen = Colors.stGreen;
  Colors.fbYellow = Colors.stAmber; //estado intermedio de conexión
  Colors.fbHighlight = "#ffff00";
  Colors.fbGray = "#E8E8E8";
  Colors.levelBN = "#E8E8E8";
  Colors.fbYellowBorder = Colors.stCoralDark; //borde de control (bloques coral)
  Colors.fbBlueBorder = Colors.stCyanDark;
  Colors.fbPurpleBorder = Colors.stVioletDark;
  Colors.fbOrangeBorder = Colors.stAmberDark;
  Colors.darkTeal = "#114F53";
  if (FinchBlox) {
    Colors.inactiveGray = Colors.fbGray;
  }
};

Colors.setCategory = function() {
  Colors.categoryColors = {
    "robots": Colors.bbt,
    "hummingbird": Colors.bbt,
    "hummingbirdbit": Colors.bbt,
    "microbit": Colors.bbt,
    "flutter": Colors.bbt,
    "finch": Colors.bbt,
    "tablet": Colors.tabletOrange,
    "operators": Colors.operatorsGreen,
    "sound": Colors.soundPurple,
    "control": Colors.controlYellow,
    "variables": Colors.variablesDkOrange,
    "lists": Colors.red,
    "inactive": Colors.inactiveGray,
    "motion_1": Colors.easternBlue,
    "color_1": Colors.neonCarrot,
    "sound_1": Colors.seance,
    "motion_2": Colors.easternBlue,
    "color_2": Colors.neonCarrot,
    "sound_2": Colors.seance,
    "motion_3": Colors.easternBlue,
    "color_3": Colors.neonCarrot,
    "sound_3": Colors.seance,
    "control_3": Colors.stCoral,
    "sensor_3": Colors.stGreen,
    "start": Colors.stGreen //pseudo-categoría del bloque de inicio (verde)
  };
  //In FinchBlox, the block palette changes colors per category
  Colors.blockPalette = {
    "motion_1": Colors.blockPaletteMotion,
    "color_1": Colors.blockPaletteColor,
    "sound_1": Colors.blockPaletteSound,
    "motion_2": Colors.blockPaletteMotion,
    "color_2": Colors.blockPaletteColor,
    "sound_2": Colors.blockPaletteSound,
    "motion_3": Colors.blockPaletteMotion,
    "color_3": Colors.blockPaletteColor,
    "sound_3": Colors.blockPaletteSound,
    "control_3": Colors.blockPaletteControl,
    "sensor_3": Colors.stGreenTint
  };
  //In FinchBlox, each block is outlined with a darker color
  Colors.blockOutline = {
    "motion_1": Colors.fbBlueBorder,
    "color_1": Colors.fbOrangeBorder,
    "sound_1": Colors.fbPurpleBorder,
    "motion_2": Colors.fbBlueBorder,
    "color_2": Colors.fbOrangeBorder,
    "sound_2": Colors.fbPurpleBorder,
    "motion_3": Colors.fbBlueBorder,
    "color_3": Colors.fbOrangeBorder,
    "sound_3": Colors.fbPurpleBorder,
    "control_3": Colors.fbYellowBorder,
    "sensor_3": Colors.stGreenDark,
    "start": Colors.stGreenDark,
    "inactive": Colors.iron
  }
};

Colors.setMultipliers = function() {
  // Used for gradients
  Colors.gradStart = 1;
  Colors.gradEnd = 0.75;
  Colors.gradDarkStart = 0.25;
  Colors.gradDarkEnd = 0.5;
};

/**
 * Creates normal and dark gradients for all categories
 */
Colors.createGradients = function() {
  Colors.createGradientSet("gradient_", Colors.gradStart, Colors.gradEnd);
  Colors.createGradientSet("gradient_dark_", Colors.gradDarkStart, Colors.gradDarkEnd);
};

/**
 * Creates gradients for all categories
 * @param {string} name
 * @param {number} multStart
 * @param {number} multEnd
 */
Colors.createGradientSet = function(name, multStart, multEnd) {
  Object.keys(Colors.categoryColors).map(function(category) {
    let color = Colors.categoryColors[category];
    Colors.createGradientFromColorAndMults(name, category, color, multStart, multEnd);
  });
};

/**
 * Creates a gradient in the SVG going from one darkness to another
 * @param {string} name - Used to identify the type of gradient ("gradient_" or "gradient_dark_")
 * @param {string} catId - Used to get the specific gradient
 * @param {string} color - color in hex
 * @param {number} multStart - number from 0 to 1 to determine the darkness of the start color
 * @param {number} multEnd - number from 0 to 1 for end color darkness
 */
Colors.createGradientFromColorAndMults = function(name, catId, color, multStart, multEnd) {
  const darken = Colors.darkenColor;
  const color1 = darken(color, multStart);
  const color2 = darken(color, multEnd);
  GuiElements.create.gradient(name + catId, color1, color2);
};

/**
 * Multiplies the rgb values by amt to make them darker. Colors must be specified
 * with 6 characters, not 3 (eg. #FFFFFF not #FFF).
 * @param {string} color - color in hex
 * @param {number} amt - number from 0 to 1
 * @return {string} - color in hex
 */
Colors.darkenColor = function(color, amt) {
  // Source:
  // stackoverflow.com/questions/5560248/programmatically-lighten-or-darken-a-hex-color-or-rgb-and-blend-colors
  const col = parseInt(color.slice(1), 16);
  let result = (((col & 0x0000FF) * amt) | ((((col >> 8) & 0x00FF) * amt) << 8) | (((col >> 16) * amt) << 16)).toString(16);
  while (result.length < 6) {
    result = "0" + result;
  }
  return "#" + result;
};

/**
 * Gets the color for a category
 * @param {string} category
 * @return {string} - color in hex
 */
Colors.getColor = function(category) {
  return Colors.categoryColors[category];
};

/**
 * Gets the gradient specified
 * @param {string} category - Should start with "gradient_" or "gradient_dark_"
 * @return {string} - Url to gradient
 */
Colors.getGradient = function(category) {
  return "url(#gradient_" + category + ")";
};

/**
 * Returns the hex value for a given RGB value
 */
Colors.rgbToHex = function(r, g, b) {
  r = Math.round(r);
  g = Math.round(g);
  b = Math.round(b);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
