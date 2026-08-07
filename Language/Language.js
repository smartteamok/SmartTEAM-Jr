/**
 * The Language class controls all text displayed by the frontend. On startup,
 *  the frontend provides the system language. This language will be used if
 *  available. Otherwise, English is used.
 */
function Language() {};

Language.lang = "en"; //The current language. English by default.

/**
 * ==== FORCE A LANGUAGE FOR TESTING ====
 *
 * Set this to a code from Language.langs ("es", "en", "pt", "fr", ...) to pin the
 * UI to that language and ignore both the browser and any previous choice. Leave
 * it null for normal behaviour (follow the browser).
 *
 *   Language.FORCE = "en";   // check the English strings
 *   Language.FORCE = null;   // back to following the browser
 *
 * One line, no rebuild: the editor loads this file directly.
 */
Language.FORCE = null;
Language.langs = ["ar", "ca", "da", "de", "en", "es", "fi", "fr", "he", "ko", "nl", "pt", "sv", "zhs", "zht"];
//Language.rtlLangs = [];
Language.rtlLangs = ["ar", "he"];
Language.isRTL = false;

//The char below forces the chars following it to be displayed ltr. Useful for
// correctly displaying negative numbers and parentheses. The char itself is invisible.
Language.forceLTR = String.fromCharCode(8206);

Language.names = {
  "ar":"العربية",  //Arabic
  "ca":"Català", //Catalan
  "da":"Dansk",  //Danish
  "de":"Deutsch",  //German
  "en":"English",  //English
  "es":"Español",  //Spanish
  "fi":"suomi",  //Finnish - language names not capitalized in Finnish
  "fr":"Français",  //French
  "he":"עברית",  //Hebrew
  "ja":"日本語",  //Japanese
  "ko":"한국어",  //Korean
  "nl":"Nederlands",  //Dutch
  "pt":"Português",  //Portuguese
  "sv":"svenska",  //Swedish - language names not capitalized in Swedish
  "zhs":"简体中文",  //Simplified Chinese (zh-Hans)
  "zht":"繁體中文"  //Traditional Chinese (zh-Hant)
}
/**
 * Set the language to a given language if available. Used when a system Language
 *  is returned by the backend.
 * @param {string} lang - Language code of the language requested.
 */
Language.setLanguage = function(lang) {
    const code = lang.substring(0, 2);
    if (Language.langs.indexOf(code) != -1) {
      Language.lang = code;
    } else if (code == "zh") {
      if (lang.substring(0, 7) == "zh-Hans") { //iOS Simplified Chinese
        Language.lang = "zhs";
      } else if (lang.substring(0, 7) == "zh-Hant") { //iOS Traditional Chinese
        Language.lang = "zht";
      } else if (lang.substring(0, 5) == "zh_CN") { //Android Simplified Chinese
        Language.lang = "zhs";
      } else if (lang.substring(0, 5) == "zh_TW") { //Android Traditional Chinese
        Language.lang = "zht";
      } else {
        Language.lang = "zhs";
      }
    } else {
      Language.lang = "en";
    }
}
/**
 * Normalises a locale tag ("es-AR", "pt_BR", "zh-Hans") to a supported code, or
 * null when there is no match. Shares its mapping with setLanguage, which takes
 * the language reported by a native backend.
 * @param {string} tag
 * @return {string|null}
 */
Language.normalize = function(tag) {
  if (tag == null) {
    return null;
  }
  const normalized = String(tag).replace("_", "-");
  const code = normalized.substring(0, 2).toLowerCase();
  if (code === "zh") {
    return normalized.toLowerCase().indexOf("hant") >= 0 ||
      normalized.toLowerCase().indexOf("-tw") >= 0 ? "zht" : "zhs";
  }
  return Language.langs.indexOf(code) !== -1 ? code : null;
};

/**
 * Picks the language to use and stores it in Language.lang. Precedence:
 *
 *   1. Language.FORCE          — the testing override
 *   2. sessionStorage          — a language the user picked in this session
 *   3. navigator.language(s)   — what the browser reports
 *   4. English
 *
 * Needed because this fork runs as a plain web page: the original frontend was
 * told the system language by its native backend (CallbackManager.tablet
 * .getLanguage), and with no backend to do that the UI silently stayed English.
 * @return {string} the code that was applied
 */
Language.applyPreferred = function() {
  const forced = Language.normalize(Language.FORCE);
  if (forced != null) {
    Language.lang = forced;
    return Language.lang;
  }
  let stored = null;
  try {
    stored = sessionStorage.getItem("language");
  } catch (e) {
    // sessionStorage can throw on a locked-down origin; fall through.
  }
  const fromStorage = Language.normalize(stored);
  if (fromStorage != null) {
    Language.lang = fromStorage;
    return Language.lang;
  }
  const candidates = [];
  if (typeof navigator !== "undefined") {
    if (navigator.languages != null) {
      candidates.push.apply(candidates, navigator.languages);
    }
    if (navigator.language != null) {
      candidates.push(navigator.language);
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    const match = Language.normalize(candidates[i]);
    if (match != null) {
      Language.lang = match;
      return Language.lang;
    }
  }
  Language.lang = "en";
  return Language.lang;
};

/**
 * getStr plus positional substitution, for messages that embed a value.
 * Placeholders are {0}, {1}, ... — keeping the value out of the translated text
 * so translators do not have to rebuild the sentence around it.
 * @param {string} str - dictionary key
 * @param {...*} args - values for {0}, {1}, ...
 * @return {string}
 */
Language.format = function(str) {
  const args = Array.prototype.slice.call(arguments, 1);
  return String(Language.getStr(str)).replace(/\{(\d+)\}/g, function(match, i) {
    return args[i] != null ? String(args[i]) : match;
  });
};

/**
 * Get the translation for the given key.
 * @param {string} str - The language dictionary key.
 * @return {string} - The text entry for the given key in the current language.
 */
/**
 * Reads a key out of a dictionary, or null if it does not have one of its own.
 *
 * The own-property check matters: plain index access inherits from
 * Object.prototype, so a key named "constructor" or "toString" would return a
 * function instead of a missing translation. The eval this replaced had the same
 * hole, plus it broke on any key containing a character that is not valid in an
 * identifier (a dash, for instance) and put an eval on the hot path of every
 * string the UI draws.
 * @param {object} dictionary
 * @param {string} key
 * @return {string|null}
 */
Language.lookup = function(dictionary, key) {
  if (dictionary == null || key == null) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(dictionary, key)) {
    return null;
  }
  const value = dictionary[key];
  return typeof value === "string" ? value : null;
};

Language.getStr = function(str) {
    let translatedStr = Language.lookup(Language[Language.lang], str);
    if (translatedStr == null && !DebugOptions.enabled) {
      translatedStr = Language.lookup(Language.en, str);
    }
    if (translatedStr != null) {
        return translatedStr;
    } else {
        //console.log("Translation? " + str);
        return "Translation required";
    }
}
