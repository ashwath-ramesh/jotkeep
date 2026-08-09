import {
  LIST_VIEWS,
  SORT_OPTIONS,
  createNote,
} from "./notes.js";

export const NOTES_DOCUMENT_STORAGE_KEY = "minimal-notepad.document.v2";
export const DOCUMENT_STORAGE_KEY = "minimal-notepad.document.v1";
export const LEGACY_STORAGE_KEY = "minimal-notepad.note.v1";
export const LAST_BACKUP_STORAGE_KEY = "minimal-notepad.last-backup.v1";
export const NOTES_DOCUMENT_VERSION = 2;
export const DOCUMENT_VERSION = 1;
export const LAST_BACKUP_VERSION = 1;
export const JOTKEEP_STORAGE_KEYS = Object.freeze([
  NOTES_DOCUMENT_STORAGE_KEY,
  DOCUMENT_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  LAST_BACKUP_STORAGE_KEY,
]);

const VALID_SORT_OPTIONS = new Set(Object.values(SORT_OPTIONS));
const VALID_LIST_VIEWS = new Set(Object.values(LIST_VIEWS));

export function createEmptyDocument() {
  return {
    version: DOCUMENT_VERSION,
    title: "",
    body: "",
  };
}

export function isValidDocument(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === DOCUMENT_VERSION &&
    typeof value.title === "string" &&
    typeof value.body === "string"
  );
}

export function saveDocument(storage, document) {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  if (!isValidDocument(document)) {
    throw new TypeError("Cannot save an invalid note document.");
  }

  storage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify(document));
}

export function loadDocument(storage) {
  const emptyDocument = createEmptyDocument();

  if (!storage) {
    return {
      document: emptyDocument,
      storageAvailable: false,
      migrated: false,
    };
  }

  let storedDocument;

  try {
    storedDocument = storage.getItem(DOCUMENT_STORAGE_KEY);
  } catch {
    return {
      document: emptyDocument,
      storageAvailable: false,
      migrated: false,
    };
  }

  if (storedDocument !== null) {
    try {
      const parsedDocument = JSON.parse(storedDocument);
      if (!isValidDocument(parsedDocument)) {
        throw new TypeError("Stored note has an unsupported format.");
      }
      return {
        document: parsedDocument,
        storageAvailable: true,
        migrated: false,
      };
    } catch {
      return {
        document: emptyDocument,
        storageAvailable: false,
        migrated: false,
      };
    }
  }

  let legacyBody;
  try {
    legacyBody = storage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return {
      document: emptyDocument,
      storageAvailable: false,
      migrated: false,
    };
  }

  if (legacyBody === null) {
    return {
      document: emptyDocument,
      storageAvailable: true,
      migrated: false,
    };
  }

  const migratedDocument = { ...emptyDocument, body: legacyBody };
  try {
    saveDocument(storage, migratedDocument);
    return {
      document: migratedDocument,
      storageAvailable: true,
      migrated: true,
    };
  } catch {
    return {
      document: migratedDocument,
      storageAvailable: false,
      migrated: false,
    };
  }
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

export function loadLastBackupMetadata(storage) {
  if (!storage) {
    return null;
  }

  try {
    const stored = storage.getItem(LAST_BACKUP_STORAGE_KEY);
    if (stored === null) {
      return null;
    }

    const parsed = JSON.parse(stored);
    return parsed !== null &&
      typeof parsed === "object" &&
      parsed.version === LAST_BACKUP_VERSION &&
      isIsoTimestamp(parsed.createdAt)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveLastBackupMetadata(storage, createdAt) {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  if (!isIsoTimestamp(createdAt)) {
    throw new TypeError("Cannot save invalid backup metadata.");
  }

  const metadata = { version: LAST_BACKUP_VERSION, createdAt };
  storage.setItem(LAST_BACKUP_STORAGE_KEY, JSON.stringify(metadata));
  return metadata;
}

export function clearJotKeepData(storage) {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  for (const key of JOTKEEP_STORAGE_KEYS) {
    storage.removeItem(key);
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

export function saveNotesDocument(storage, document) {
  if (!storage) {
    throw new Error("Browser storage is unavailable.");
  }

  if (!isValidNotesDocument(document)) {
    throw new TypeError("Cannot save an invalid notes document.");
  }

  storage.setItem(NOTES_DOCUMENT_STORAGE_KEY, JSON.stringify(document));
}

function result(document, { storageAvailable, migrated = false, canSave = true }) {
  return { document, storageAvailable, migrated, canSave };
}

function migrateContent(storage, title, content, options) {
  const document = createNotesDocument({ ...options, title, content });

  try {
    saveNotesDocument(storage, document);
    return result(document, { storageAvailable: true, migrated: true });
  } catch {
    return result(document, { storageAvailable: false, canSave: true });
  }
}

export function loadNotesDocument(storage, options = {}) {
  const emptyDocument = createNotesDocument(options);

  if (!storage) {
    return result(emptyDocument, { storageAvailable: false, canSave: false });
  }

  let storedCollection;

  try {
    storedCollection = storage.getItem(NOTES_DOCUMENT_STORAGE_KEY);
  } catch {
    return result(emptyDocument, { storageAvailable: false, canSave: false });
  }

  if (storedCollection !== null) {
    try {
      const parsedCollection = JSON.parse(storedCollection);

      if (!isValidNotesDocument(parsedCollection)) {
        throw new TypeError("Stored notes have an unsupported format.");
      }

      return result(parsedCollection, { storageAvailable: true });
    } catch {
      return result(emptyDocument, { storageAvailable: false, canSave: false });
    }
  }

  let storedDocument;
  let legacyBody;

  try {
    storedDocument = storage.getItem(DOCUMENT_STORAGE_KEY);
    legacyBody = storage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return result(emptyDocument, { storageAvailable: false, canSave: false });
  }

  if (storedDocument !== null) {
    try {
      const parsedDocument = JSON.parse(storedDocument);

      if (!isValidDocument(parsedDocument)) {
        throw new TypeError("Stored note has an unsupported format.");
      }

      return migrateContent(
        storage,
        parsedDocument.title,
        parsedDocument.body,
        options,
      );
    } catch {
      if (legacyBody === null) {
        return result(emptyDocument, {
          storageAvailable: false,
          canSave: false,
        });
      }
    }
  }

  if (legacyBody !== null) {
    return migrateContent(storage, "", legacyBody, options);
  }

  return result(emptyDocument, { storageAvailable: true });
}
