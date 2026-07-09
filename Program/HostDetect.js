"use strict";

/**
 * Si este frontend corre embebido en un iframe cuyo padre implementa
 * parseFinchBloxRequest (la página host webble/ con Web Bluetooth, o cualquier
 * otro host PWA), activa el modo PWA de HtmlServer ANTES del primer request.
 * Debe cargarse después de GuiElements.js y antes de que dispare window.load.
 */
(function() {
  try {
    if (window.parent !== window &&
      typeof window.parent.parseFinchBloxRequest === "function") {
      GuiElements.isPWA = true;
    }
  } catch (e) {
    // window.parent de otro origen: no es nuestro host
  }
})();
