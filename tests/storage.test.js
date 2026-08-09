import test from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  createEmptyDocument,
  loadDocument,
  saveDocument,
} from "../src/storage.js";

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

test("loadDocument returns an empty document when storage has no note", () => {
  const result = loadDocument(new MemoryStorage());

  assert.deepEqual(result, {
    document: createEmptyDocument(),
    storageAvailable: true,
    migrated: false,
  });
});

test("saveDocument and loadDocument round-trip a title and body", () => {
  const storage = new MemoryStorage();
  const document = {
    version: 1,
    title: "Shopping",
    body: "Tea\nCoffee",
  };

  saveDocument(storage, document);

  assert.deepEqual(loadDocument(storage), {
    document,
    storageAvailable: true,
    migrated: false,
  });
});

test("loadDocument migrates the legacy body without deleting it", () => {
  const storage = new MemoryStorage({
    [LEGACY_STORAGE_KEY]: "Legacy body",
  });

  const result = loadDocument(storage);

  assert.deepEqual(result, {
    document: {
      version: 1,
      title: "",
      body: "Legacy body",
    },
    storageAvailable: true,
    migrated: true,
  });
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), "Legacy body");
  assert.equal(
    storage.getItem(DOCUMENT_STORAGE_KEY),
    JSON.stringify(result.document),
  );
});

test("loadDocument preserves a legacy body when migration cannot be saved", () => {
  const storage = new MemoryStorage({
    [LEGACY_STORAGE_KEY]: "Unsaved legacy body",
  });
  storage.setItem = () => {
    throw new Error("quota exceeded");
  };

  const result = loadDocument(storage);

  assert.equal(result.document.body, "Unsaved legacy body");
  assert.equal(result.storageAvailable, false);
  assert.equal(result.migrated, false);
});

test("loadDocument handles unavailable and malformed storage", () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("blocked");
    },
  };
  const malformedStorage = new MemoryStorage({
    [DOCUMENT_STORAGE_KEY]: "{bad json",
  });

  assert.equal(loadDocument(unavailableStorage).storageAvailable, false);
  assert.deepEqual(loadDocument(malformedStorage), {
    document: createEmptyDocument(),
    storageAvailable: false,
    migrated: false,
  });
});

test("saveDocument rejects unavailable storage and invalid records", () => {
  assert.throws(() => saveDocument(null, createEmptyDocument()));
  assert.throws(() =>
    saveDocument(new MemoryStorage(), {
      version: 1,
      title: "Missing body",
    }),
  );
});
