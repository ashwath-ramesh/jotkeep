import test from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  NOTES_DOCUMENT_STORAGE_KEY,
  LAST_BACKUP_STORAGE_KEY,
  PLAINJOT_STORAGE_KEYS,
  clearPlainJotData,
  createEmptyDocument,
  createNotesDocument,
  loadDocument,
  loadNotesDocument,
  loadLastBackupMetadata,
  saveLastBackupMetadata,
  saveDocument,
  saveNotesDocument,
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

  removeItem(key) {
    this.values.delete(key);
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

const MIGRATION_TIME = "2026-08-09T12:00:00.000Z";
const migrationOptions = {
  idFactory: () => "note_migrated",
  now: () => new Date(MIGRATION_TIME),
};

test("version-2 notes documents round-trip collection state and preferences", () => {
  const storage = new MemoryStorage();
  const document = createNotesDocument(migrationOptions);
  document.notes[0].title = "Shopping";
  document.notes[0].content = "Tea\nCoffee";
  document.notes.push({
    id: "note_active",
    title: "Selected note",
    content: "This note should remain selected.",
    createdAt: MIGRATION_TIME,
    updatedAt: MIGRATION_TIME,
  });
  document.activeNoteId = "note_active";
  document.preferences.sortBy = "title";
  document.preferences.listView = "compact";

  saveNotesDocument(storage, document);

  assert.deepEqual(loadNotesDocument(storage, migrationOptions), {
    document,
    storageAvailable: true,
    migrated: false,
    canSave: true,
  });
});

test("loadNotesDocument migrates the structured single note and retains it", () => {
  const legacyDocument = {
    version: 1,
    title: "Existing title",
    body: "Existing body",
  };
  const storage = new MemoryStorage({
    [DOCUMENT_STORAGE_KEY]: JSON.stringify(legacyDocument),
  });

  const result = loadNotesDocument(storage, migrationOptions);

  assert.equal(result.migrated, true);
  assert.equal(result.storageAvailable, true);
  assert.equal(result.document.notes[0].title, "Existing title");
  assert.equal(result.document.notes[0].content, "Existing body");
  assert.equal(result.document.activeNoteId, "note_migrated");
  assert.equal(
    storage.getItem(DOCUMENT_STORAGE_KEY),
    JSON.stringify(legacyDocument),
  );
  assert.equal(
    storage.getItem(NOTES_DOCUMENT_STORAGE_KEY),
    JSON.stringify(result.document),
  );
});

test("loadNotesDocument migrates the body-only note and retains it", () => {
  const storage = new MemoryStorage({
    [LEGACY_STORAGE_KEY]: "Original body",
  });

  const result = loadNotesDocument(storage, migrationOptions);

  assert.equal(result.document.notes[0].content, "Original body");
  assert.equal(result.document.notes[0].title, "");
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), "Original body");
  assert.equal(result.migrated, true);
});

test("a failed migration keeps content in memory and leaves legacy data intact", () => {
  const legacyDocument = { version: 1, title: "Kept", body: "Safe" };
  const storage = new MemoryStorage({
    [DOCUMENT_STORAGE_KEY]: JSON.stringify(legacyDocument),
  });
  storage.setItem = () => {
    throw new Error("quota exceeded");
  };

  const result = loadNotesDocument(storage, migrationOptions);

  assert.equal(result.document.notes[0].title, "Kept");
  assert.equal(result.document.notes[0].content, "Safe");
  assert.equal(result.storageAvailable, false);
  assert.equal(result.migrated, false);
  assert.equal(result.canSave, true);
  assert.equal(
    storage.getItem(DOCUMENT_STORAGE_KEY),
    JSON.stringify(legacyDocument),
  );
});

test("a malformed version-2 value is never replaced by legacy content", () => {
  const storage = new MemoryStorage({
    [NOTES_DOCUMENT_STORAGE_KEY]: "{malformed",
    [DOCUMENT_STORAGE_KEY]: JSON.stringify({
      version: 1,
      title: "Older",
      body: "Older body",
    }),
  });

  const result = loadNotesDocument(storage, migrationOptions);

  assert.equal(result.storageAvailable, false);
  assert.equal(result.canSave, false);
  assert.equal(storage.getItem(NOTES_DOCUMENT_STORAGE_KEY), "{malformed");
  assert.equal(result.document.notes[0].content, "");
});

test("saveNotesDocument rejects invalid collection relationships and dates", () => {
  const storage = new MemoryStorage();
  const invalidActiveNote = createNotesDocument(migrationOptions);
  invalidActiveNote.activeNoteId = "note_missing";
  const invalidDate = createNotesDocument(migrationOptions);
  invalidDate.notes[0].updatedAt = "yesterday";
  const duplicateId = createNotesDocument(migrationOptions);
  duplicateId.notes.push({ ...duplicateId.notes[0] });

  assert.throws(() => saveNotesDocument(storage, invalidActiveNote));
  assert.throws(() => saveNotesDocument(storage, invalidDate));
  assert.throws(() => saveNotesDocument(storage, duplicateId));
});

test("backup creation metadata round-trips and malformed metadata is ignored", () => {
  const storage = new MemoryStorage();
  const metadata = saveLastBackupMetadata(storage, MIGRATION_TIME);

  assert.deepEqual(metadata, { version: 1, createdAt: MIGRATION_TIME });
  assert.deepEqual(loadLastBackupMetadata(storage), metadata);

  storage.setItem(LAST_BACKUP_STORAGE_KEY, "{bad json");
  assert.equal(loadLastBackupMetadata(storage), null);
  assert.throws(() => saveLastBackupMetadata(storage, "yesterday"));
});

test("clearPlainJotData removes only PlainJot-owned storage keys", () => {
  const entries = Object.fromEntries(
    PLAINJOT_STORAGE_KEYS.map((key) => [key, "owned"]),
  );
  const storage = new MemoryStorage({ ...entries, unrelated: "keep me" });

  clearPlainJotData(storage);

  for (const key of PLAINJOT_STORAGE_KEYS) {
    assert.equal(storage.getItem(key), null);
  }
  assert.equal(storage.getItem("unrelated"), "keep me");
});
