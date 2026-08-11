import test from "node:test";
import assert from "node:assert/strict";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_THEME_STORAGE_KEY,
  createAppearanceStore,
  normalizeAppearance,
  parseAppearance,
} from "../src/preferences.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("appearance defaults are valid and malformed fields fall back independently", () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("not json"), DEFAULT_APPEARANCE);

  const normalized = normalizeAppearance({
    version: 1,
    colorMode: "dark",
    wordWrap: false,
    statusBar: "no",
    fontFamily: "mono",
    fontSize: 999,
    fontWeight: 600,
    fontStyle: "italic",
    lineSpacing: 1.4,
  });
  assert.deepEqual(normalized, {
    ...DEFAULT_APPEARANCE,
    colorMode: "dark",
    wordWrap: false,
    fontFamily: "mono",
    fontWeight: 600,
    fontStyle: "italic",
    lineSpacing: 1.4,
  });
});

test("the appearance store persists updates without touching note storage", () => {
  const storage = memoryStorage({ "unrelated.note": "plain text" });
  const store = createAppearanceStore({ storage });
  store.load();
  const result = store.update({
    fontFamily: "sans",
    fontSize: 24,
    wordWrap: false,
  });

  assert.equal(result.persisted, true);
  assert.equal(storage.values.get("unrelated.note"), "plain text");
  assert.deepEqual(
    JSON.parse(storage.values.get(APPEARANCE_STORAGE_KEY)),
    result.preferences,
  );
});

test("a legacy fixed theme migrates only when no appearance record exists", () => {
  const storage = memoryStorage({ [LEGACY_THEME_STORAGE_KEY]: "dark" });
  const result = createAppearanceStore({ storage }).load();

  assert.equal(result.preferences.colorMode, "dark");
  assert.equal(storage.values.has(LEGACY_THEME_STORAGE_KEY), false);
  assert.equal(
    JSON.parse(storage.values.get(APPEARANCE_STORAGE_KEY)).colorMode,
    "dark",
  );
});

test("reset and clear restore defaults and report unavailable persistence", () => {
  const storage = memoryStorage();
  const store = createAppearanceStore({ storage });
  store.load();
  store.update({ colorMode: "light", statusBar: false });
  assert.deepEqual(store.reset().preferences, DEFAULT_APPEARANCE);
  assert.deepEqual(store.clear().preferences, DEFAULT_APPEARANCE);
  assert.equal(storage.values.has(APPEARANCE_STORAGE_KEY), false);

  const unavailable = createAppearanceStore({ storage: null });
  assert.equal(unavailable.update({ colorMode: "dark" }).persisted, false);
  assert.equal(unavailable.get().colorMode, "dark");
});
