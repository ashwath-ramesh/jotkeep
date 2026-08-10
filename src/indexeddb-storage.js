import {
  DOCUMENT_STORAGE_KEY,
  LAST_BACKUP_STORAGE_KEY,
  LAST_BACKUP_VERSION,
  LEGACY_STORAGE_KEY,
  NOTES_DOCUMENT_STORAGE_KEY,
  JOTKEEP_STORAGE_KEYS,
  createNotesDocument,
  isValidDocument,
  isValidNotesDocument,
} from "./storage.js";
import {
  SNAPSHOT_KINDS,
  SnapshotValidationError,
  createSnapshot,
  emptyHistoryArchive,
  hasAutomaticSnapshotInUtcHour,
  mergeHistoryArchives,
  pruneHistory,
  reconstructSnapshot,
  validateHistoryArchive,
  verifyHistoryArchive,
} from "./snapshots.js";

export const DATABASE_NAME = "jotkeep";
export const DATABASE_VERSION = 2;
export const NOTES_STORE = "notes";
export const METADATA_STORE = "metadata";
export const SNAPSHOTS_STORE = "snapshots";
export const SNAPSHOT_NOTES_STORE = "snapshotNotes";

const NOTEBOOK_METADATA_KEY = "notebook";
const BACKUP_METADATA_KEY = "lastBackup";
const SAFETY_FILE_METADATA_KEY = "safetyFile";
const EXTERNAL_BACKUP_METADATA_KEY = "externalBackup";
const STORAGE_SCHEMA_VERSION = 1;
const SAFETY_FILE_CONNECTION_VERSION = 1;
const EXTERNAL_BACKUP_VERSION = 1;

export const STORAGE_FAILURES = Object.freeze({
  QUOTA: "quota",
  UNAVAILABLE: "unavailable",
  MIGRATION: "migration",
  CONFLICT: "conflict",
});

export const PERSISTENCE_STATES = Object.freeze({
  GRANTED: "granted",
  NOT_GRANTED: "not-granted",
  DENIED: "denied",
  UNSUPPORTED: "unsupported",
  UNAVAILABLE: "unavailable",
});

export class StorageFailure extends Error {
  constructor(kind, message, options = {}) {
    super(message, options);
    this.name = "StorageFailure";
    this.kind = kind;
  }
}

function classifiedFailure(error, fallbackKind = STORAGE_FAILURES.UNAVAILABLE) {
  if (error instanceof StorageFailure) {
    return error;
  }

  const quotaNames = new Set([
    "QuotaExceededError",
    "NS_ERROR_DOM_QUOTA_REACHED",
  ]);
  const kind = quotaNames.has(error?.name)
    ? STORAGE_FAILURES.QUOTA
    : fallbackKind;
  const message =
    kind === STORAGE_FAILURES.QUOTA
      ? "Browser storage is full."
      : "Browser storage is unavailable.";
  return new StorageFailure(kind, message, { cause: error });
}

function clone(value) {
  return value === null || value === undefined
    ? value
    : structuredClone(value);
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

function validBackupMetadata(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === LAST_BACKUP_VERSION &&
    isIsoTimestamp(value.createdAt)
  );
}

function notebookMetadata(document) {
  return {
    key: NOTEBOOK_METADATA_KEY,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeNoteId: document.activeNoteId,
    noteIds: document.notes.map((note) => note.id),
    preferences: clone(document.preferences),
  };
}

function backupMetadataRecord(metadata) {
  return metadata === null
    ? null
    : { key: BACKUP_METADATA_KEY, ...clone(metadata) };
}

function validSafetyFileConnection(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === SAFETY_FILE_CONNECTION_VERSION &&
    value.handle?.kind === "file" &&
    typeof value.fileName === "string" &&
    value.fileName !== "" &&
    typeof value.fileId === "string" &&
    value.fileId !== "" &&
    typeof value.revisionId === "string" &&
    value.revisionId !== "" &&
    typeof value.fileDigest === "string" &&
    value.fileDigest !== "" &&
    typeof value.notebookDigest === "string" &&
    value.notebookDigest !== "" &&
    isIsoTimestamp(value.fileCreatedAt) &&
    isIsoTimestamp(value.fileUpdatedAt) &&
    isIsoTimestamp(value.verifiedAt)
  );
}

function safetyFileConnectionRecord(connection) {
  return { key: SAFETY_FILE_METADATA_KEY, ...clone(connection) };
}

function validExternalBackup(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === EXTERNAL_BACKUP_VERSION &&
    ["safety-file", "json-backup"].includes(value.kind) &&
    typeof value.identity === "string" &&
    value.identity !== "" &&
    isIsoTimestamp(value.contentAt) &&
    isIsoTimestamp(value.verifiedAt)
  );
}

function externalBackupRecord(value) {
  return { key: EXTERNAL_BACKUP_METADATA_KEY, ...clone(value) };
}

function documentFromRecords(notes, metadata) {
  if (
    metadata === undefined ||
    metadata === null ||
    metadata.schemaVersion !== STORAGE_SCHEMA_VERSION ||
    !Array.isArray(metadata.noteIds)
  ) {
    return null;
  }

  const notesById = new Map(notes.map((note) => [note.id, note]));
  const orderedNotes = metadata.noteIds.map((noteId) => notesById.get(noteId));
  if (
    orderedNotes.some((note) => note === undefined) ||
    notesById.size !== metadata.noteIds.length
  ) {
    throw new StorageFailure(
      STORAGE_FAILURES.MIGRATION,
      "Stored IndexedDB note ordering does not match its note records.",
    );
  }

  const document = {
    version: 2,
    activeNoteId: metadata.activeNoteId,
    notes: orderedNotes,
    preferences: metadata.preferences,
  };

  if (!isValidNotesDocument(document)) {
    throw new StorageFailure(
      STORAGE_FAILURES.MIGRATION,
      "Stored IndexedDB notes have an unsupported or incomplete format.",
    );
  }

  return document;
}

function documentsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readDocumentFromTransaction(transaction) {
  const notesRequest = transaction.objectStore(NOTES_STORE).getAll();
  const notebookRequest = transaction
    .objectStore(METADATA_STORE)
    .get(NOTEBOOK_METADATA_KEY);
  const [notes, notebook] = await Promise.all([
    requestResult(notesRequest),
    requestResult(notebookRequest),
  ]);
  const document = documentFromRecords(notes, notebook);

  if (document === null && notes.length !== 0) {
    throw new StorageFailure(
      STORAGE_FAILURES.MIGRATION,
      "IndexedDB contains notes without notebook metadata.",
    );
  }

  return document;
}

function historyFromRecords(snapshots, noteRevisions) {
  const archive = {
    format: "jotkeep-history",
    version: 1,
    snapshots,
    noteRevisions,
  };
  validateHistoryArchive(archive);
  return archive;
}

async function readHistoryFromTransaction(transaction) {
  const snapshotsRequest = transaction.objectStore(SNAPSHOTS_STORE).getAll();
  const revisionsRequest = transaction.objectStore(SNAPSHOT_NOTES_STORE).getAll();
  const [snapshots, noteRevisions] = await Promise.all([
    requestResult(snapshotsRequest),
    requestResult(revisionsRequest),
  ]);
  return historyFromRecords(snapshots, noteRevisions);
}

function writeHistoryToTransaction(transaction, archive) {
  validateHistoryArchive(archive);
  const snapshots = transaction.objectStore(SNAPSHOTS_STORE);
  const revisions = transaction.objectStore(SNAPSHOT_NOTES_STORE);
  snapshots.clear();
  revisions.clear();
  for (const snapshot of archive.snapshots) {
    snapshots.put(clone(snapshot));
  }
  for (const revision of archive.noteRevisions) {
    revisions.put(clone(revision));
  }
}

function assertCurrentDocument(current, expectedDocuments) {
  if (expectedDocuments.some((expected) => documentsEqual(current, expected))) {
    return;
  }

  throw new StorageFailure(
    STORAGE_FAILURES.CONFLICT,
    "The notebook changed in another tab. Reload before saving more changes.",
  );
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true },
    );
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true },
    );
  });
}

async function runTransaction(database, stores, mode, operation) {
  let transaction;
  let completion;
  try {
    transaction = database.transaction(stores, mode);
    completion = transactionComplete(transaction);
    const result = await operation(transaction);
    await completion;
    return result;
  } catch (error) {
    try {
      transaction?.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    await completion?.catch(() => {});
    throw classifiedFailure(error);
  }
}

function openDatabase(indexedDBObject) {
  if (!indexedDBObject) {
    return Promise.reject(
      new StorageFailure(
        STORAGE_FAILURES.UNAVAILABLE,
        "IndexedDB is not available in this browser.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let request;
    let settled = false;

    try {
      request = indexedDBObject.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(classifiedFailure(error));
      return;
    }

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        database.createObjectStore(NOTES_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        database.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_NOTES_STORE)) {
        database.createObjectStore(SNAPSHOT_NOTES_STORE, { keyPath: "revisionId" });
      }
    });
    request.addEventListener("success", () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        reject(classifiedFailure(request.error));
      }
    });
    request.addEventListener("blocked", () => {
      if (!settled) {
        settled = true;
        reject(
          new StorageFailure(
            STORAGE_FAILURES.UNAVAILABLE,
            "IndexedDB is blocked by another open JotKeep tab.",
          ),
        );
      }
    });
  });
}

async function readDatabase(database) {
  return runTransaction(
    database,
    [NOTES_STORE, METADATA_STORE, SNAPSHOTS_STORE, SNAPSHOT_NOTES_STORE],
    "readonly",
    async (transaction) => {
      const notesRequest = transaction.objectStore(NOTES_STORE).getAll();
      const notebookRequest = transaction
        .objectStore(METADATA_STORE)
        .get(NOTEBOOK_METADATA_KEY);
      const backupRequest = transaction
        .objectStore(METADATA_STORE)
        .get(BACKUP_METADATA_KEY);
      const safetyFileRequest = transaction
        .objectStore(METADATA_STORE)
        .get(SAFETY_FILE_METADATA_KEY);
      const externalBackupRequest = transaction
        .objectStore(METADATA_STORE)
        .get(EXTERNAL_BACKUP_METADATA_KEY);
      const snapshotsRequest = transaction.objectStore(SNAPSHOTS_STORE).getAll();
      const revisionsRequest = transaction.objectStore(SNAPSHOT_NOTES_STORE).getAll();
      const [
        notes,
        notebook,
        backupRecord,
        safetyFileRecord,
        externalBackupRecordValue,
        snapshots,
        noteRevisions,
      ] = await Promise.all([
        requestResult(notesRequest),
        requestResult(notebookRequest),
        requestResult(backupRequest),
        requestResult(safetyFileRequest),
        requestResult(externalBackupRequest),
        requestResult(snapshotsRequest),
        requestResult(revisionsRequest),
      ]);
      const document = documentFromRecords(notes, notebook);
      let backup = backupRecord
        ? { version: backupRecord.version, createdAt: backupRecord.createdAt }
        : null;

      if (backup !== null && !validBackupMetadata(backup)) {
        backup = null;
      }

      if (document === null && notes.length !== 0) {
        throw new StorageFailure(
          STORAGE_FAILURES.MIGRATION,
          "IndexedDB contains notes without notebook metadata.",
        );
      }

      const safetyFileConnection = safetyFileRecord
        ? {
            version: safetyFileRecord.version,
            handle: safetyFileRecord.handle,
            fileName: safetyFileRecord.fileName,
            fileId: safetyFileRecord.fileId,
            revisionId: safetyFileRecord.revisionId,
            fileDigest: safetyFileRecord.fileDigest,
            notebookDigest: safetyFileRecord.notebookDigest,
            fileCreatedAt: safetyFileRecord.fileCreatedAt,
            fileUpdatedAt: safetyFileRecord.fileUpdatedAt,
            verifiedAt: safetyFileRecord.verifiedAt,
          }
        : null;
      const externalBackup = externalBackupRecordValue
        ? {
            version: externalBackupRecordValue.version,
            kind: externalBackupRecordValue.kind,
            identity: externalBackupRecordValue.identity,
            contentAt: externalBackupRecordValue.contentAt,
            verifiedAt: externalBackupRecordValue.verifiedAt,
          }
        : null;

      let history = emptyHistoryArchive();
      let historyError = null;
      try {
        history = historyFromRecords(snapshots, noteRevisions);
      } catch (error) {
        historyError = error instanceof SnapshotValidationError
          ? error
          : new SnapshotValidationError("Stored snapshot history is unavailable.");
      }

      return {
        document,
        backup,
        history,
        historyError,
        externalBackup: validExternalBackup(externalBackup) ? externalBackup : null,
        safetyFileConnection: validSafetyFileConnection(safetyFileConnection)
          ? safetyFileConnection
          : null,
      };
    },
  );
}

function noteMap(document) {
  return new Map((document?.notes ?? []).map((note) => [note.id, note]));
}

function changedNotes(previous, next) {
  const previousNotes = noteMap(previous);
  return next.notes.filter(
    (note) =>
      !previousNotes.has(note.id) ||
      JSON.stringify(previousNotes.get(note.id)) !== JSON.stringify(note),
  );
}

function deletedNoteIds(previous, next) {
  const nextIds = new Set(next.notes.map((note) => note.id));
  return (previous?.notes ?? [])
    .filter((note) => !nextIds.has(note.id))
    .map((note) => note.id);
}

function metadataChanged(previous, next) {
  return (
    previous === null ||
    previous.activeNoteId !== next.activeNoteId ||
    JSON.stringify(previous.notes.map((note) => note.id)) !==
      JSON.stringify(next.notes.map((note) => note.id)) ||
    JSON.stringify(previous.preferences) !== JSON.stringify(next.preferences)
  );
}

async function writeDocument(
  database,
  previous,
  next,
  { replace = false, force = false, historyArchive = null } = {},
) {
  const stores = [NOTES_STORE, METADATA_STORE];
  if (historyArchive !== null) {
    stores.push(SNAPSHOTS_STORE, SNAPSHOT_NOTES_STORE);
  }
  await runTransaction(
    database,
    stores,
    "readwrite",
    async (transaction) => {
      const notes = transaction.objectStore(NOTES_STORE);
      const metadata = transaction.objectStore(METADATA_STORE);
      const current = force
        ? null
        : await readDocumentFromTransaction(transaction);

      if (!force) {
        assertCurrentDocument(current, [previous]);
      }

      const puts = replace ? next.notes : changedNotes(current, next);
      const deletions = replace ? [] : deletedNoteIds(current, next);
      const writeMetadata = replace || metadataChanged(current, next);

      if (replace) {
        notes.clear();
      }
      for (const note of puts) {
        notes.put(clone(note));
      }
      for (const noteId of deletions) {
        notes.delete(noteId);
      }
      if (writeMetadata) {
        metadata.put(notebookMetadata(next));
      }
      if (historyArchive !== null) {
        writeHistoryToTransaction(transaction, historyArchive);
      }
    },
  );
}

async function writeMigratedState(
  database,
  document,
  backup,
  expectedDocuments = [null],
) {
  await runTransaction(
    database,
    [NOTES_STORE, METADATA_STORE],
    "readwrite",
    async (transaction) => {
      const notes = transaction.objectStore(NOTES_STORE);
      const metadata = transaction.objectStore(METADATA_STORE);
      const current = await readDocumentFromTransaction(transaction);
      assertCurrentDocument(current, expectedDocuments);
      notes.clear();
      metadata.clear();
      for (const note of document.notes) {
        notes.put(clone(note));
      }
      metadata.put(notebookMetadata(document));
      if (backup !== null) {
        metadata.put(backupMetadataRecord(backup));
      }
    },
  );
}

function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseLegacyDocument(storage, options) {
  if (!storage) {
    return {
      document: null,
      backup: null,
      sourceKeys: [],
      error: null,
    };
  }

  let versionTwo;
  let versionOne;
  let bodyOnly;
  let backupValue;

  try {
    versionTwo = storage.getItem(NOTES_DOCUMENT_STORAGE_KEY);
    versionOne = storage.getItem(DOCUMENT_STORAGE_KEY);
    bodyOnly = storage.getItem(LEGACY_STORAGE_KEY);
    backupValue = storage.getItem(LAST_BACKUP_STORAGE_KEY);
  } catch (error) {
    return {
      document: null,
      backup: null,
      sourceKeys: [],
      error: classifiedFailure(error),
    };
  }

  let document = null;
  const sourceKeys = [];

  if (versionTwo !== null) {
    try {
      const parsed = JSON.parse(versionTwo);
      if (!isValidNotesDocument(parsed)) {
        throw new TypeError("Version 2 notes are invalid.");
      }
      document = parsed;
      sourceKeys.push(NOTES_DOCUMENT_STORAGE_KEY);
    } catch (error) {
      return {
        document: null,
        backup: null,
        sourceKeys: [],
        error: new StorageFailure(
          STORAGE_FAILURES.MIGRATION,
          "JotKeep could not validate the existing localStorage notebook.",
          { cause: error },
        ),
      };
    }
  } else if (versionOne !== null) {
    try {
      const parsed = JSON.parse(versionOne);
      if (!isValidDocument(parsed)) {
        throw new TypeError("Version 1 note is invalid.");
      }
      document = createNotesDocument({
        ...options,
        title: parsed.title,
        content: parsed.body,
      });
      sourceKeys.push(DOCUMENT_STORAGE_KEY);
    } catch (error) {
      if (bodyOnly === null) {
        return {
          document: null,
          backup: null,
          sourceKeys: [],
          error: new StorageFailure(
            STORAGE_FAILURES.MIGRATION,
            "JotKeep could not validate the existing localStorage notebook.",
            { cause: error },
          ),
        };
      }
      document = createNotesDocument({ ...options, content: bodyOnly });
      sourceKeys.push(LEGACY_STORAGE_KEY);
    }
  } else if (bodyOnly !== null) {
    document = createNotesDocument({ ...options, content: bodyOnly });
    sourceKeys.push(LEGACY_STORAGE_KEY);
  }

  let backup = null;
  if (backupValue !== null) {
    try {
      const parsed = JSON.parse(backupValue);
      if (validBackupMetadata(parsed)) {
        backup = parsed;
        sourceKeys.push(LAST_BACKUP_STORAGE_KEY);
      }
    } catch {
      // Invalid backup status must not prevent note migration.
    }
  }

  return { document, backup, sourceKeys, error: null };
}

function removeLegacyKeys(storage, keys) {
  if (keys.length === 0) {
    return true;
  }
  if (!storage) {
    return false;
  }

  try {
    for (const key of keys) {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

function hasLegacyValues(storage) {
  if (!storage) {
    return false;
  }

  try {
    return JOTKEEP_STORAGE_KEYS.some((key) => storage.getItem(key) !== null);
  } catch {
    return false;
  }
}

export function createBrowserStorageService({
  indexedDBObject = globalThis.indexedDB,
  localStorageObject = getLocalStorage(),
  navigatorStorage = globalThis.navigator?.storage,
  migrationOptions = {},
  now = () => new Date(),
  cryptoObject = globalThis.crypto,
} = {}) {
  let database = null;
  let persistedDocument = null;
  let persistedHistory = emptyHistoryArchive();
  let historyIssue = null;
  let lastBackupMetadata = null;
  let externalBackupMetadata = null;
  let initializationError = null;
  let writeProtected = false;
  let pendingLegacyCleanupKeys = [];
  let migrationSourceDocument = null;
  let persistenceState = PERSISTENCE_STATES.UNSUPPORTED;

  async function persistenceStatus() {
    if (typeof navigatorStorage?.persisted !== "function") {
      persistenceState = PERSISTENCE_STATES.UNSUPPORTED;
      return persistenceState;
    }

    try {
      persistenceState = (await navigatorStorage.persisted())
        ? PERSISTENCE_STATES.GRANTED
        : PERSISTENCE_STATES.NOT_GRANTED;
    } catch {
      persistenceState = PERSISTENCE_STATES.UNAVAILABLE;
    }
    return persistenceState;
  }

  async function verifyLegacyMigration(document, backup) {
    const stored = await readDatabase(database);
    if (
      !documentsEqual(stored.document, document) ||
      JSON.stringify(stored.backup) !== JSON.stringify(backup)
    ) {
      throw new StorageFailure(
        STORAGE_FAILURES.MIGRATION,
        "IndexedDB migration verification did not match the original notebook.",
      );
    }
  }

  function finishLegacyCleanup() {
    if (!removeLegacyKeys(localStorageObject, JOTKEEP_STORAGE_KEYS)) {
      throw new StorageFailure(
        STORAGE_FAILURES.MIGRATION,
        "IndexedDB was verified, but legacy localStorage cleanup failed.",
      );
    }

    pendingLegacyCleanupKeys = [];
    migrationSourceDocument = null;
  }

  async function initialize() {
    const fallbackDocument = createNotesDocument(migrationOptions);
    const legacy = parseLegacyDocument(localStorageObject, migrationOptions);
    const legacyValuesPresent = hasLegacyValues(localStorageObject);
    writeProtected = legacy.error?.kind === STORAGE_FAILURES.MIGRATION;

    try {
      database = await openDatabase(indexedDBObject);
      database.addEventListener("versionchange", () => {
        database.close();
        database = null;
        initializationError = new StorageFailure(
          STORAGE_FAILURES.UNAVAILABLE,
          "Browser storage changed in another tab.",
        );
      });

      const existing = await readDatabase(database);
      if (existing.document !== null) {
        persistedDocument = clone(existing.document);
        persistedHistory = clone(existing.history);
        historyIssue = existing.historyError;
        lastBackupMetadata = clone(existing.backup);
        externalBackupMetadata = clone(existing.externalBackup);
        writeProtected = false;
        initializationError = null;
        // Legacy localStorage data is only deleted when it matches the
        // notebook IndexedDB already holds. Divergent legacy data (for
        // example an older still-open tab that kept writing localStorage
        // after this browser migrated) is preserved rather than erased.
        const legacyMatchesStored =
          legacy.error === null &&
          (legacy.document === null ||
            documentsEqual(legacy.document, existing.document));
        if (legacyValuesPresent && legacyMatchesStored) {
          pendingLegacyCleanupKeys = [...JOTKEEP_STORAGE_KEYS];
          try {
            finishLegacyCleanup();
          } catch (error) {
            initializationError = classifiedFailure(
              error,
              STORAGE_FAILURES.MIGRATION,
            );
          }
        }
        await persistenceStatus();
        return {
          document: clone(existing.document),
          documentGenerated: false,
          lastBackupMetadata: clone(existing.backup),
          safetyFileConnection: clone(existing.safetyFileConnection),
          history: clone(persistedHistory),
          historyError: historyIssue,
          externalBackupMetadata: clone(externalBackupMetadata),
          storageAvailable: initializationError === null,
          canSafelySave: true,
          migrated: false,
          error: initializationError,
          persistenceState,
        };
      }

      if (legacy.error?.kind === STORAGE_FAILURES.MIGRATION) {
        initializationError = legacy.error;
        await persistenceStatus();
        return {
          document: fallbackDocument,
          documentGenerated: true,
          lastBackupMetadata: null,
          safetyFileConnection: null,
          history: clone(persistedHistory),
          historyError: historyIssue,
          externalBackupMetadata: clone(externalBackupMetadata),
          storageAvailable: true,
          canSafelySave: false,
          migrated: false,
          error: legacy.error,
          persistenceState,
        };
      }

      if (legacy.document !== null) {
        pendingLegacyCleanupKeys = [...JOTKEEP_STORAGE_KEYS];
        migrationSourceDocument = clone(legacy.document);
        try {
          await writeMigratedState(
            database,
            legacy.document,
            legacy.backup,
            [null, legacy.document],
          );
          await verifyLegacyMigration(legacy.document, legacy.backup);
          persistedDocument = clone(legacy.document);
          lastBackupMetadata = clone(legacy.backup);
          finishLegacyCleanup();
          initializationError = null;
          await persistenceStatus();
          return {
            document: clone(legacy.document),
            documentGenerated: false,
            lastBackupMetadata: clone(legacy.backup),
            safetyFileConnection: null,
            history: clone(persistedHistory),
            historyError: historyIssue,
            externalBackupMetadata: clone(externalBackupMetadata),
            storageAvailable: true,
            canSafelySave: true,
            migrated: true,
            error: null,
            persistenceState,
          };
        } catch (error) {
          lastBackupMetadata = clone(legacy.backup);
          initializationError = new StorageFailure(
            STORAGE_FAILURES.MIGRATION,
            "JotKeep could not finish migrating localStorage data to IndexedDB.",
            { cause: classifiedFailure(error) },
          );
          await persistenceStatus();
          return {
            document: clone(legacy.document),
            documentGenerated: false,
            lastBackupMetadata: clone(legacy.backup),
            safetyFileConnection: null,
            history: clone(persistedHistory),
            historyError: historyIssue,
            externalBackupMetadata: clone(externalBackupMetadata),
            storageAvailable: false,
            canSafelySave: true,
            migrated: false,
            error: initializationError,
            persistenceState,
          };
        }
      }

      persistedDocument = null;
      const backupMetadata = existing.backup ?? legacy.backup;
      lastBackupMetadata = clone(backupMetadata);
      externalBackupMetadata = clone(existing.externalBackup);
      if (existing.backup === null && legacy.backup !== null) {
        await runTransaction(database, METADATA_STORE, "readwrite", (transaction) => {
          transaction
            .objectStore(METADATA_STORE)
            .put(backupMetadataRecord(legacy.backup));
        });
        const stored = await readDatabase(database);
        if (JSON.stringify(stored.backup) === JSON.stringify(legacy.backup)) {
          if (legacy.sourceKeys.length !== 0) {
            pendingLegacyCleanupKeys = [...JOTKEEP_STORAGE_KEYS];
            finishLegacyCleanup();
          }
        }
      } else if (existing.backup !== null && legacy.sourceKeys.length !== 0) {
        pendingLegacyCleanupKeys = [...JOTKEEP_STORAGE_KEYS];
        finishLegacyCleanup();
      }
      initializationError = null;
      await persistenceStatus();
      return {
        document: fallbackDocument,
        documentGenerated: true,
        lastBackupMetadata: clone(backupMetadata),
        safetyFileConnection: clone(existing.safetyFileConnection),
        history: clone(persistedHistory),
        historyError: historyIssue,
        externalBackupMetadata: clone(externalBackupMetadata),
        storageAvailable: true,
        canSafelySave: true,
        migrated: false,
        error: null,
        persistenceState,
      };
    } catch (error) {
      initializationError = classifiedFailure(error);
      if (initializationError.kind === STORAGE_FAILURES.MIGRATION) {
        writeProtected = true;
      }
      await persistenceStatus();
      return {
        document: clone(legacy.document ?? fallbackDocument),
        documentGenerated: legacy.document === null,
        lastBackupMetadata: clone(legacy.backup),
        safetyFileConnection: null,
        history: clone(persistedHistory),
        historyError: historyIssue,
        externalBackupMetadata: clone(externalBackupMetadata),
        storageAvailable: false,
        canSafelySave:
          initializationError.kind !== STORAGE_FAILURES.MIGRATION &&
          legacy.error?.kind !== STORAGE_FAILURES.MIGRATION,
        migrated: false,
        error: legacy.error ?? initializationError,
        persistenceState,
      };
    }
  }

  function requireDatabase() {
    if (!database) {
      throw initializationError ?? new StorageFailure(
        STORAGE_FAILURES.UNAVAILABLE,
        "IndexedDB is unavailable.",
      );
    }
    if (writeProtected) {
      throw initializationError ?? new StorageFailure(
        STORAGE_FAILURES.MIGRATION,
        "Existing browser data could not be migrated safely.",
      );
    }
  }

  async function automaticHistoryFor(nextDocument) {
    if (
      historyIssue ||
      persistedDocument === null ||
      documentsEqual(persistedDocument, nextDocument)
    ) {
      return { archive: null, error: historyIssue };
    }
    const date = typeof now === "function" ? now() : now;
    if (hasAutomaticSnapshotInUtcHour(persistedHistory.snapshots, date)) {
      return { archive: null, error: null };
    }
    try {
      const created = await createSnapshot(persistedDocument, {
        kind: SNAPSHOT_KINDS.AUTOMATIC,
        now: date,
        cryptoObject,
      });
      const merged = mergeHistoryArchives(persistedHistory, {
        ...emptyHistoryArchive(),
        snapshots: [created.snapshot],
        noteRevisions: created.noteRevisions,
      });
      const pruned = pruneHistory(merged, { now: date });
      if (!pruned.fits) {
        return {
          archive: null,
          error: new StorageFailure(
            STORAGE_FAILURES.QUOTA,
            "The notebook was saved, but its automatic history checkpoint is too large.",
          ),
        };
      }
      return { archive: pruned.archive, error: null };
    } catch (error) {
      return { archive: null, error };
    }
  }

  async function saveNotebook(document) {
    if (!isValidNotesDocument(document)) {
      throw new TypeError("Cannot save an invalid notes document.");
    }
    requireDatabase();

    const automaticHistory = await automaticHistoryFor(document);
    let snapshotError = automaticHistory.error;
    try {
      if (
        persistedDocument === null &&
        pendingLegacyCleanupKeys.length !== 0
      ) {
        await writeMigratedState(
          database,
          document,
          lastBackupMetadata,
          [null, migrationSourceDocument],
        );
        await verifyLegacyMigration(document, lastBackupMetadata);
      } else {
        try {
          await writeDocument(database, persistedDocument, document, {
            historyArchive: automaticHistory.archive,
          });
          if (automaticHistory.archive !== null) {
            persistedHistory = clone(automaticHistory.archive);
          }
        } catch (error) {
          const classified = classifiedFailure(error);
          if (
            automaticHistory.archive === null ||
            classified.kind !== STORAGE_FAILURES.QUOTA
          ) {
            throw classified;
          }
          // History is best-effort during normal editing. A quota failure must
          // not prevent the current notebook from being saved.
          await writeDocument(database, persistedDocument, document);
          snapshotError = new StorageFailure(
            STORAGE_FAILURES.QUOTA,
            "The notebook was saved, but browser storage could not keep its automatic history checkpoint.",
            { cause: classified },
          );
        }
      }
      persistedDocument = clone(document);
      if (pendingLegacyCleanupKeys.length !== 0) {
        await verifyLegacyMigration(document, lastBackupMetadata);
        finishLegacyCleanup();
      }
      initializationError = null;
      return { snapshotSaved: snapshotError === null, snapshotError };
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function replaceNotebook(document) {
    if (!isValidNotesDocument(document)) {
      throw new TypeError("Cannot save an invalid notes document.");
    }
    if (!database) {
      requireDatabase();
    }

    try {
      await writeDocument(database, persistedDocument, document, {
        replace: true,
        force: writeProtected,
      });
      const stored = await readDatabase(database);
      if (!documentsEqual(stored.document, document)) {
        throw new StorageFailure(
          STORAGE_FAILURES.MIGRATION,
          "The replacement notebook could not be verified.",
        );
      }
      removeLegacyKeys(localStorageObject, JOTKEEP_STORAGE_KEYS);
      pendingLegacyCleanupKeys = [];
      persistedDocument = clone(document);
      writeProtected = false;
      initializationError = null;
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function restoreNotebook(
    document,
    {
      currentDocument = persistedDocument,
      importedHistory = null,
      checkpointKind = SNAPSHOT_KINDS.PRE_RESTORE,
    } = {},
  ) {
    if (!isValidNotesDocument(document) || !isValidNotesDocument(currentDocument)) {
      throw new TypeError("Cannot restore an invalid notes document.");
    }
    if (!database) {
      requireDatabase();
    }
    if (historyIssue) {
      throw new StorageFailure(
        STORAGE_FAILURES.MIGRATION,
        "Stored history is damaged, so JotKeep cannot create a safe pre-restore checkpoint.",
        { cause: historyIssue },
      );
    }

    try {
      if (importedHistory !== null) {
        await verifyHistoryArchive(importedHistory, { cryptoObject });
      }
      const date = typeof now === "function" ? now() : now;
      const created = await createSnapshot(currentDocument, {
        kind: checkpointKind,
        now: date,
        cryptoObject,
      });
      const checkpointArchive = {
        ...emptyHistoryArchive(),
        snapshots: [created.snapshot],
        noteRevisions: created.noteRevisions,
      };
      const combined = mergeHistoryArchives(
        persistedHistory,
        importedHistory,
        checkpointArchive,
      );
      const pruned = pruneHistory(combined, {
        now: date,
        protectedSnapshotId: created.snapshot.id,
      });
      if (!pruned.fits) {
        throw new StorageFailure(
          STORAGE_FAILURES.QUOTA,
          "The current notebook is too large to keep the required pre-restore checkpoint. No notes were changed.",
        );
      }

      await writeDocument(database, persistedDocument, document, {
        replace: true,
        force: writeProtected,
        historyArchive: pruned.archive,
      });
      const stored = await readDatabase(database);
      if (!documentsEqual(stored.document, document) || stored.historyError) {
        throw new StorageFailure(
          STORAGE_FAILURES.MIGRATION,
          "The restored notebook and its recovery checkpoint could not be verified.",
        );
      }
      const storedCheckpoint = stored.history.snapshots.find(
        (snapshot) => snapshot.id === created.snapshot.id,
      );
      if (!storedCheckpoint) {
        throw new StorageFailure(
          STORAGE_FAILURES.MIGRATION,
          "The required pre-restore checkpoint was not retained.",
        );
      }
      await reconstructSnapshot(storedCheckpoint, stored.history.noteRevisions, {
        cryptoObject,
      });

      removeLegacyKeys(localStorageObject, JOTKEEP_STORAGE_KEYS);
      pendingLegacyCleanupKeys = [];
      persistedDocument = clone(document);
      persistedHistory = clone(stored.history);
      historyIssue = null;
      writeProtected = false;
      initializationError = null;
      return {
        checkpointId: created.snapshot.id,
        history: clone(persistedHistory),
      };
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function loadSnapshot(snapshotId) {
    if (historyIssue) {
      throw historyIssue;
    }
    const snapshot = persistedHistory.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      throw new SnapshotValidationError("The selected history checkpoint no longer exists.");
    }
    return reconstructSnapshot(snapshot, persistedHistory.noteRevisions, {
      cryptoObject,
    });
  }

  function listSnapshots() {
    if (historyIssue) {
      throw historyIssue;
    }
    return clone(
      [...persistedHistory.snapshots].sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      ),
    );
  }

  function exportHistory() {
    if (historyIssue) {
      throw historyIssue;
    }
    return clone(persistedHistory);
  }

  async function saveLastBackup(createdAt) {
    const metadata = { version: LAST_BACKUP_VERSION, createdAt };
    if (!validBackupMetadata(metadata)) {
      throw new TypeError("Cannot save invalid backup metadata.");
    }
    requireDatabase();

    try {
      await runTransaction(database, METADATA_STORE, "readwrite", (transaction) => {
        transaction
          .objectStore(METADATA_STORE)
          .put(backupMetadataRecord(metadata));
      });
      lastBackupMetadata = metadata;
      return clone(metadata);
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function saveSafetyFileConnection(connection) {
    if (!validSafetyFileConnection(connection)) {
      throw new TypeError("Cannot save invalid Safety File connection metadata.");
    }
    requireDatabase();
    const verification = {
      version: EXTERNAL_BACKUP_VERSION,
      kind: "safety-file",
      identity: connection.fileId,
      contentAt: connection.fileUpdatedAt,
      verifiedAt: connection.verifiedAt,
    };

    try {
      await runTransaction(database, METADATA_STORE, "readwrite", (transaction) => {
        const metadata = transaction.objectStore(METADATA_STORE);
        metadata.put(safetyFileConnectionRecord(connection));
        metadata.put(externalBackupRecord(verification));
      });
      externalBackupMetadata = verification;
      return clone(connection);
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function saveExternalBackupVerification(value) {
    const metadata = { version: EXTERNAL_BACKUP_VERSION, ...clone(value) };
    if (!validExternalBackup(metadata)) {
      throw new TypeError("Cannot save invalid external-backup verification metadata.");
    }
    requireDatabase();
    try {
      await runTransaction(database, METADATA_STORE, "readwrite", (transaction) => {
        transaction
          .objectStore(METADATA_STORE)
          .put(externalBackupRecord(metadata));
      });
      externalBackupMetadata = metadata;
      return clone(metadata);
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function disconnectSafetyFile() {
    requireDatabase();
    try {
      await runTransaction(database, METADATA_STORE, "readwrite", (transaction) => {
        transaction.objectStore(METADATA_STORE).delete(SAFETY_FILE_METADATA_KEY);
      });
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function clear() {
    if (!database) {
      requireDatabase();
    }
    if (!removeLegacyKeys(localStorageObject, JOTKEEP_STORAGE_KEYS)) {
      throw new StorageFailure(
        STORAGE_FAILURES.UNAVAILABLE,
        "JotKeep could not remove its legacy localStorage data.",
      );
    }

    try {
      await runTransaction(
        database,
        [NOTES_STORE, METADATA_STORE, SNAPSHOTS_STORE, SNAPSHOT_NOTES_STORE],
        "readwrite",
        (transaction) => {
          transaction.objectStore(NOTES_STORE).clear();
          transaction.objectStore(METADATA_STORE).clear();
          transaction.objectStore(SNAPSHOTS_STORE).clear();
          transaction.objectStore(SNAPSHOT_NOTES_STORE).clear();
        },
      );
      persistedDocument = null;
      persistedHistory = emptyHistoryArchive();
      historyIssue = null;
      lastBackupMetadata = null;
      externalBackupMetadata = null;
      pendingLegacyCleanupKeys = [];
      writeProtected = false;
      initializationError = null;
    } catch (error) {
      throw classifiedFailure(error);
    }
  }

  async function requestPersistence() {
    if (typeof navigatorStorage?.persist !== "function") {
      persistenceState = PERSISTENCE_STATES.UNSUPPORTED;
      return persistenceState;
    }

    try {
      if (typeof navigatorStorage.persisted === "function" &&
          (await navigatorStorage.persisted())) {
        persistenceState = PERSISTENCE_STATES.GRANTED;
      } else {
        persistenceState = (await navigatorStorage.persist())
          ? PERSISTENCE_STATES.GRANTED
          : PERSISTENCE_STATES.DENIED;
      }
    } catch {
      persistenceState = PERSISTENCE_STATES.UNAVAILABLE;
    }
    return persistenceState;
  }

  return {
    initialize,
    saveNotebook,
    replaceNotebook,
    restoreNotebook,
    listSnapshots,
    loadSnapshot,
    exportHistory,
    saveLastBackup,
    saveExternalBackupVerification,
    saveSafetyFileConnection,
    disconnectSafetyFile,
    clear,
    persistenceStatus,
    requestPersistence,
    getPersistenceState: () => persistenceState,
  };
}
