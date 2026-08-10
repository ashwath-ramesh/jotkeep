import test from "node:test";
import assert from "node:assert/strict";

import {
  LIST_VIEWS,
  SORT_OPTIONS,
  addNote,
  chooseNeighborNoteId,
  deleteNote,
  displayNoteTitle,
  filterNotes,
  notePreview,
  sortNotes,
  updateNote,
  updatePreferences,
} from "../src/notes.js";

const EARLY = "2026-08-09T09:00:00.000Z";
const MIDDLE = "2026-08-09T10:00:00.000Z";
const LATE = "2026-08-09T11:00:00.000Z";

function savedNote(id, title, content, createdAt, updatedAt = createdAt) {
  return { id, title, content, createdAt, updatedAt };
}

function notesDocument() {
  return {
    version: 2,
    activeNoteId: "note_a",
    notes: [
      savedNote("note_a", "Zebra", "First body", EARLY, MIDDLE),
      savedNote("note_b", "alpha", "Needle in this body", MIDDLE, LATE),
      savedNote("note_c", "", "", LATE, LATE),
    ],
    preferences: {
      sortBy: SORT_OPTIONS.UPDATED_AT,
      listView: LIST_VIEWS.DETAILED,
    },
  };
}

test("addNote creates a unique active note without changing existing notes", () => {
  const original = notesDocument();
  const result = addNote(original, {
    idFactory: ({ existingIds }) => {
      assert.deepEqual([...existingIds], ["note_a", "note_b", "note_c"]);
      return "note_d";
    },
    now: () => new Date(LATE),
  });

  assert.equal(result.activeNoteId, "note_d");
  assert.equal(result.notes.length, 4);
  assert.deepEqual(result.notes.slice(0, 3), original.notes);
  assert.deepEqual(result.notes.at(-1), savedNote("note_d", "", "", LATE));
});

test("addNote rejects an ID collision instead of overwriting a note", () => {
  assert.throws(() =>
    addNote(notesDocument(), {
      idFactory: () => "note_a",
      now: () => new Date(LATE),
    }),
  );
});

test("updateNote changes only the target and its modification timestamp", () => {
  const original = notesDocument();
  const result = updateNote(
    original,
    "note_a",
    { title: "Renamed", content: "Edited" },
    { now: () => new Date(LATE) },
  );

  assert.deepEqual(result.notes[0], {
    ...original.notes[0],
    title: "Renamed",
    content: "Edited",
    updatedAt: LATE,
  });
  assert.strictEqual(result.notes[1], original.notes[1]);
  assert.equal(result.notes[0].createdAt, EARLY);
});

test("search matches titles and bodies case-insensitively", () => {
  const notes = notesDocument().notes;

  assert.deepEqual(filterNotes(notes, "  ALPHA  ").map((note) => note.id), [
    "note_b",
  ]);
  assert.deepEqual(filterNotes(notes, "needle").map((note) => note.id), [
    "note_b",
  ]);
  assert.deepEqual(filterNotes(notes, ""), notes);
});

test("display helpers provide safe fallback text and a one-line preview", () => {
  assert.equal(displayNoteTitle({ title: "   " }), "Untitled Note");
  assert.equal(notePreview({ content: "  First\n\nsecond\tline " }), "First second line");
  assert.equal(notePreview({ content: "\n" }), "No content");
});

test("sorting uses the requested presentation order without mutating notes", () => {
  const notes = notesDocument().notes;
  const before = structuredClone(notes);

  assert.deepEqual(sortNotes(notes, SORT_OPTIONS.TITLE).map((note) => note.id), [
    "note_b",
    "note_c",
    "note_a",
  ]);
  assert.deepEqual(
    sortNotes(notes, SORT_OPTIONS.CREATED_AT).map((note) => note.id),
    ["note_c", "note_b", "note_a"],
  );
  assert.deepEqual(
    sortNotes(notes, SORT_OPTIONS.UPDATED_AT).map((note) => note.id),
    ["note_c", "note_b", "note_a"],
  );
  assert.deepEqual(notes, before);
});

test("neighbor selection prefers the next visible note, then the previous", () => {
  assert.equal(chooseNeighborNoteId("note_b", ["note_a", "note_b", "note_c"]), "note_c");
  assert.equal(chooseNeighborNoteId("note_c", ["note_a", "note_b", "note_c"]), "note_b");
  assert.equal(chooseNeighborNoteId("note_a", ["note_a"]), null);
});

test("deleting the active note selects the supplied neighbor", () => {
  const result = deleteNote(notesDocument(), "note_a", {
    nextActiveNoteId: "note_b",
  });

  assert.equal(result.activeNoteId, "note_b");
  assert.deepEqual(result.notes.map((note) => note.id), ["note_b", "note_c"]);
});

test("deleting the only note creates a blank replacement", () => {
  const original = {
    ...notesDocument(),
    notes: [savedNote("note_a", "Only", "Body", EARLY)],
  };
  const result = deleteNote(original, "note_a", {
    idFactory: () => "note_replacement",
    now: () => new Date(LATE),
  });

  assert.equal(result.activeNoteId, "note_replacement");
  assert.deepEqual(result.notes, [
    savedNote("note_replacement", "", "", LATE),
  ]);
});

test("preference changes do not mutate note timestamps", () => {
  const original = notesDocument();
  const result = updatePreferences(original, {
    sortBy: SORT_OPTIONS.TITLE,
    listView: LIST_VIEWS.COMPACT,
  });

  assert.deepEqual(result.preferences, {
    sortBy: SORT_OPTIONS.TITLE,
    listView: LIST_VIEWS.COMPACT,
  });
  assert.strictEqual(result.notes, original.notes);
});

test("updateNote never moves updatedAt backwards when the clock rolls back", () => {
  const document = notesDocument();
  const before = document.notes.find((note) => note.id === "note_a").updatedAt;

  const updated = updateNote(document, "note_a", { content: "Rollback edit" }, {
    now: () => new Date("2001-01-01T00:00:00.000Z"),
  });
  const note = updated.notes.find((item) => item.id === "note_a");
  assert.equal(note.content, "Rollback edit");
  assert.equal(note.updatedAt, before);

  const forward = updateNote(updated, "note_a", { content: "Later edit" }, {
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
  assert.equal(
    forward.notes.find((item) => item.id === "note_a").updatedAt,
    "2030-01-01T00:00:00.000Z",
  );
});

test("notePreview stays bounded for very large notes", () => {
  const huge = `${"word ".repeat(500_000)}end`;
  const preview = notePreview({ content: huge });
  assert.ok(preview.length <= 161);
  assert.ok(preview.startsWith("word word"));
});
