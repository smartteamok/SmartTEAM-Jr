/**
 * Static class stores Settings and makes them accessible to other classes
 */
function SettingsManager() {
  const SM = SettingsManager;
  SM.zoom = new Setting("zoom", 1, true, false, GuiElements.minZoomMult, GuiElements.maxZoomMult);
  SM.enableSnapNoise = new Setting("enableSnapNoise", "true"); //"false");
  SM.sideBarVisible = new Setting("sideBarVisible", "true");
  // FinchBlox: "true" = modo programa (compilar+transferir), "false" = modo live
  SM.programMode = new Setting("programMode", "false");
}

/**
 * Loads settings from the backend and calls callbackFn when finished
 * @param {function} callbackFn - Called when done loading/tying to load settings
 */
SettingsManager.loadSettings = function(callbackFn) {
  const SM = SettingsManager;
  SM.sideBarVisible.readValue(function() {
    SM.enableSnapNoise.readValue(function() {
      SM.programMode.readValue(function() {
        SM.zoom.readValue(callbackFn);
      });
    });
  });
};
