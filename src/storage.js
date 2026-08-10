import {
  LIST_VIEWS,
  SORT_OPTIONS,
  createNote,
} from "./notes.js";

export const NOTES_DOCUMENT_STORAGE_KEY = "minimal-notepad.document.v2";
export const DOCUMENT_STORAGE_KEY = "minimal-notepad.document.v1";
export const LEGACY_STORAGE_KEY = "minimal-notepad.note.v1";
export const LAST_BACKUP_STORAGE_KEY = "minimal-notepad.last-backup.v1";
export const LAST_BACKUP_VERSION = 1;
export const JOTKEEP_STORAGE_KEYS = Object.freeze([
  NOTES_DOCUMENT_STORAGE_KEY,
  DOCUMENT_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  LAST_BACKUP_STORAGE_KEY,
]);

const NOTES_DOCUMENT_VERSION = 2;
const DOCUMENT_VERSION = 1;

const VALID_SORT_OPTIONS = new Set(Object.values(SORT_OPTIONS));
const VALID_LIST_VIEWS = new Set(Object.values(LIST_VIEWS));

export function isValidDocument(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === DOCUMENT_VERSION &&
    typeof value.title === "string" &&
    typeof value.body === "string"
  );
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isValidNote(note) {
  return (
    note !== null &&
    typeof note === "object" &&
    typeof note.id === "string" &&
    note.id !== "" &&
    typeof note.title === "string" &&
    typeof note.content === "string" &&
    isIsoTimestamp(note.createdAt) &&
    isIsoTimestamp(note.updatedAt)
  );
}

export function isValidNotesDocument(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== NOTES_DOCUMENT_VERSION ||
    typeof value.activeNoteId !== "string" ||
    !Array.isArray(value.notes) ||
    value.notes.length === 0 ||
    value.preferences === null ||
    typeof value.preferences !== "object" ||
    !VALID_SORT_OPTIONS.has(value.preferences.sortBy) ||
    !VALID_LIST_VIEWS.has(value.preferences.listView)
  ) {
    return false;
  }

  const ids = new Set();

  for (const note of value.notes) {
    if (!isValidNote(note) || ids.has(note.id)) {
      return false;
    }
    ids.add(note.id);
  }

  return ids.has(value.activeNoteId);
}

/* Migration policy for impossible note timestamps (updatedAt earlier than
   createdAt): imported documents are normalized by clamping updatedAt up to
   createdAt instead of rejecting the whole file, so old or hand-edited
   backups stay restorable. */
export function clampNoteTimestamps(document) {
  if (!document?.notes?.some((note) => note.updatedAt < note.createdAt)) {
    return document;
  }

  return {
    ...document,
    notes: document.notes.map((note) =>
      note.updatedAt < note.createdAt
        ? { ...note, updatedAt: note.createdAt }
        : note,
    ),
  };
}

export function createNotesDocument(options = {}) {
  const note = createNote([], options);

  return {
    version: NOTES_DOCUMENT_VERSION,
    activeNoteId: note.id,
    notes: [note],
    preferences: {
      sortBy: SORT_OPTIONS.UPDATED_AT,
      listView: LIST_VIEWS.DETAILED,
    },
  };
}
