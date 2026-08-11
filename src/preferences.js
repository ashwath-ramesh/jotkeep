export const APPEARANCE_STORAGE_KEY = "jotkeep.appearance.v1";
export const LEGACY_THEME_STORAGE_KEY = "jotkeep.theme.v1";
export const APPEARANCE_VERSION = 1;

export const APPEARANCE_OPTIONS = Object.freeze({
  colorMode: Object.freeze(["system", "light", "dark"]),
  fontFamily: Object.freeze(["newsreader", "sans", "mono"]),
  fontSize: Object.freeze([14, 16, 18, 20, 24, 28]),
  fontWeight: Object.freeze([400, 600]),
  fontStyle: Object.freeze(["normal", "italic"]),
  lineSpacing: Object.freeze([1.4, 1.6, 1.85, 2.1]),
});

export const DEFAULT_APPEARANCE = Object.freeze({
  version: APPEARANCE_VERSION,
  colorMode: "system",
  wordWrap: true,
  statusBar: true,
  fontFamily: "newsreader",
  fontSize: 18,
  fontWeight: 400,
  fontStyle: "normal",
  lineSpacing: 1.85,
});

function cloneDefaults() {
  return { ...DEFAULT_APPEARANCE };
}

function optionOrDefault(key, value) {
  return APPEARANCE_OPTIONS[key].includes(value)
    ? value
    : DEFAULT_APPEARANCE[key];
}

export function normalizeAppearance(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== APPEARANCE_VERSION
  ) {
    return cloneDefaults();
  }

  return {
    version: APPEARANCE_VERSION,
    colorMode: optionOrDefault("colorMode", value.colorMode),
    wordWrap:
      typeof value.wordWrap === "boolean"
        ? value.wordWrap
        : DEFAULT_APPEARANCE.wordWrap,
    statusBar:
      typeof value.statusBar === "boolean"
        ? value.statusBar
        : DEFAULT_APPEARANCE.statusBar,
    fontFamily: optionOrDefault("fontFamily", value.fontFamily),
    fontSize: optionOrDefault("fontSize", value.fontSize),
    fontWeight: optionOrDefault("fontWeight", value.fontWeight),
    fontStyle: optionOrDefault("fontStyle", value.fontStyle),
    lineSpacing: optionOrDefault("lineSpacing", value.lineSpacing),
  };
}

export function parseAppearance(serialized) {
  if (serialized === null || serialized === undefined) {
    return cloneDefaults();
  }

  try {
    return normalizeAppearance(JSON.parse(serialized));
  } catch {
    return cloneDefaults();
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createAppearanceStore({ storage = defaultStorage() } = {}) {
  let preferences = cloneDefaults();
  let persistenceAvailable = storage !== null && storage !== undefined;

  function persist(next) {
    if (!persistenceAvailable) {
      return false;
    }

    try {
      storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
      storage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    if (!persistenceAvailable) {
      return { preferences: { ...preferences }, persisted: false };
    }

    let serialized = null;
    let legacyTheme = null;
    let persisted = true;
    try {
      serialized = storage.getItem(APPEARANCE_STORAGE_KEY);
      legacyTheme = storage.getItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      return { preferences: { ...preferences }, persisted: false };
    }

    preferences = parseAppearance(serialized);
    if (
      serialized === null &&
      (legacyTheme === "light" || legacyTheme === "dark")
    ) {
      preferences.colorMode = legacyTheme;
      persisted = persist(preferences);
    }

    return { preferences: { ...preferences }, persisted };
  }

  function update(changes) {
    preferences = normalizeAppearance({ ...preferences, ...changes });
    return {
      preferences: { ...preferences },
      persisted: persist(preferences),
    };
  }

  function reset() {
    preferences = cloneDefaults();
    return {
      preferences: { ...preferences },
      persisted: persist(preferences),
    };
  }

  function clear() {
    preferences = cloneDefaults();
    if (!persistenceAvailable) {
      return { preferences: { ...preferences }, persisted: false };
    }

    try {
      storage.removeItem(APPEARANCE_STORAGE_KEY);
      storage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return { preferences: { ...preferences }, persisted: true };
    } catch {
      return { preferences: { ...preferences }, persisted: false };
    }
  }

  return {
    clear,
    get: () => ({ ...preferences }),
    load,
    reset,
    update,
  };
}
