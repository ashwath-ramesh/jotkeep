import test from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_STORAGE_KEY,
  JOTKEEP_STORAGE_KEYS,
  LAST_BACKUP_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  NOTES_DOCUMENT_STORAGE_KEY,
  createNotesDocument,
  isValidDocument,
  isValidNotesDocument,
} from "../src/storage.js";

const CREATED_AT = "2026-08-09T12:00:00.000Z";

function noteFixture(overrides = {}) {
  return {
    id: "note_a",
    title: "First",
    content: "One",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function notesDocumentFixture(overrides = {}) {
  return {
    version: 2,
    activeNoteId: "note_a",
    notes: [noteFixture()],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
    ...overrides,
  };
}

test("isValidNotesDocument accepts a well-formed version 2 document", () => {
  assert.equal(isValidNotesDocument(notesDocumentFixture()), true);
});

test("isValidNotesDocument rejects wrong or missing versions", () => {
  assert.equal(isValidNotesDocument(notesDocumentFixture({ version: 1 })), false);
  assert.equal(isValidNotesDocument(notesDocumentFixture({ version: "2" })), false);
  assert.equal(isValidNotesDocument(notesDocumentFixture({ version: undefined })), false);
  assert.equal(isValidNotesDocument(null), false);
  assert.equal(isValidNotesDocument("not a document"), false);
});

test("isValidNotesDocument rejects missing, empty, or non-array notes", () => {
  assert.equal(isValidNotesDocument(notesDocumentFixture({ notes: [] })), false);
  assert.equal(isValidNotesDocument(notesDocumentFixture({ notes: null })), false);
  assert.equal(isValidNotesDocument(notesDocumentFixture({ notes: {} })), false);
});

test("isValidNotesDocument rejects an activeNoteId that matches no note", () => {
  assert.equal(
    isValidNotesDocument(notesDocumentFixture({ activeNoteId: "note_missing" })),
    false,
  );
  assert.equal(isValidNotesDocument(notesDocumentFixture({ activeNoteId: 7 })), false);
});

test("isValidNotesDocument rejects duplicate note ids", () => {
  const document = notesDocumentFixture({
    notes: [noteFixture(), noteFixture({ title: "Copy" })],
  });

  assert.equal(isValidNotesDocument(document), false);
});

test("isValidNotesDocument rejects notes with invalid fields", () => {
  const invalidNotes = [
    noteFixture({ id: "" }),
    noteFixture({ title: null }),
    noteFixture({ content: 42 }),
    noteFixture({ createdAt: "2026-08-09" }),
    noteFixture({ updatedAt: "not a timestamp" }),
    null,
  ];

  for (const note of invalidNotes) {
    assert.equal(
      isValidNotesDocument(notesDocumentFixture({ notes: [note] })),
      false,
    );
  }
});

test("isValidNotesDocument rejects invalid preferences", () => {
  const invalidPreferences = [
    null,
    { sortBy: "unknown", listView: "detailed" },
    { sortBy: "updatedAt", listView: "unknown" },
    { sortBy: "updatedAt" },
    { listView: "detailed" },
  ];

  for (const preferences of invalidPreferences) {
    assert.equal(
      isValidNotesDocument(notesDocumentFixture({ preferences })),
      false,
    );
  }
});

test("isValidDocument accepts version 1 title-and-body documents and rejects others", () => {
  assert.equal(isValidDocument({ version: 1, title: "", body: "" }), true);
  assert.equal(isValidDocument({ version: 1, title: "Note", body: "Text" }), true);

  assert.equal(isValidDocument(null), false);
  assert.equal(isValidDocument({ version: 2, title: "", body: "" }), false);
  assert.equal(isValidDocument({ version: 1, title: "", body: 5 }), false);
  assert.equal(isValidDocument({ version: 1, body: "" }), false);
});

test("createNotesDocument produces a valid document with one active note", () => {
  const document = createNotesDocument();

  assert.equal(isValidNotesDocument(document), true);
  assert.equal(document.notes.length, 1);
  assert.equal(document.activeNoteId, document.notes[0].id);
});

test("createNotesDocument honors a provided title and content", () => {
  const document = createNotesDocument({ title: "Imported", content: "Body" });

  assert.equal(isValidNotesDocument(document), true);
  assert.equal(document.notes[0].title, "Imported");
  assert.equal(document.notes[0].content, "Body");
});

test("JOTKEEP_STORAGE_KEYS enumerates every JotKeep key and is frozen", () => {
  assert.deepEqual(JOTKEEP_STORAGE_KEYS, [
    NOTES_DOCUMENT_STORAGE_KEY,
    DOCUMENT_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    LAST_BACKUP_STORAGE_KEY,
  ]);
  assert.equal(Object.isFrozen(JOTKEEP_STORAGE_KEYS), true);
});
