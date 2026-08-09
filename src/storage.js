export const DOCUMENT_STORAGE_KEY = "minimal-notepad.document.v1";
export const LEGACY_STORAGE_KEY = "minimal-notepad.note.v1";
export const DOCUMENT_VERSION = 1;

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

  const migratedDocument = {
    ...emptyDocument,
    body: legacyBody,
  };

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
