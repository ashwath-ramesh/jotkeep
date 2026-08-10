import { createNoteId, displayNoteTitle } from "./notes.js";
import { isValidNotesDocument } from "./storage.js";

export const SNAPSHOT_HISTORY_FORMAT = "jotkeep-history";
export const SNAPSHOT_HISTORY_VERSION = 1;
export const SNAPSHOT_FORMAT_VERSION = 1;
export const MAX_HISTORY_BYTES = 25 * 1024 * 1024;

export const SNAPSHOT_KINDS = Object.freeze({
  AUTOMATIC: "automatic",
  PRE_RESTORE: "pre-restore",
  BEFORE_DELETE: "before-delete",
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_HOURS = 24;
const DAILY_DAYS = 30;
const WEEKLY_WEEKS = 12;
const VALID_KINDS = new Set(Object.values(SNAPSHOT_KINDS));
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

export class SnapshotValidationError extends Error {
  constructor(message, { code = null } = {}) {
    super(message);
    this.name = "SnapshotValidationError";
    this.code = code;
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

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function normalizedNote(note) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function normalizedDocument(document) {
  return {
    version: 2,
    activeNoteId: document.activeNoteId,
    notes: document.notes.map(normalizedNote),
    preferences: {
      sortBy: document.preferences.sortBy,
      listView: document.preferences.listView,
    },
  };
}

export function encodedJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export async function fingerprintJson(
  value,
  { cryptoObject = globalThis.crypto } = {},
) {
  if (typeof cryptoObject?.subtle?.digest !== "function") {
    throw new Error("Secure snapshot verification is unavailable in this browser.");
  }
  const digest = await cryptoObject.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createSnapshotId({
  cryptoObject = globalThis.crypto,
  now = Date.now,
  random = Math.random,
} = {}) {
  if (typeof cryptoObject?.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  return `snapshot_${Number(now()).toString(36)}_${Math.floor(random() * 1e15).toString(36)}`;
}

export function emptyHistoryArchive() {
  return {
    format: SNAPSHOT_HISTORY_FORMAT,
    version: SNAPSHOT_HISTORY_VERSION,
    snapshots: [],
    noteRevisions: [],
  };
}

export async function createSnapshot(
  document,
  {
    kind = SNAPSHOT_KINDS.AUTOMATIC,
    now = () => new Date(),
    idFactory = createSnapshotId,
    cryptoObject = globalThis.crypto,
  } = {},
) {
  if (!isValidNotesDocument(document)) {
    throw new TypeError("Cannot snapshot an invalid notebook.");
  }
  if (!VALID_KINDS.has(kind)) {
    throw new TypeError("Cannot create a snapshot with an unknown reason.");
  }

  const normalized = normalizedDocument(document);
  const noteRevisions = [];
  const noteRevisionIds = [];
  for (const note of normalized.notes) {
    const revisionId = await fingerprintJson(note, { cryptoObject });
    noteRevisionIds.push(revisionId);
    noteRevisions.push({
      revisionId,
      note,
      byteSize: encodedJsonBytes(note),
    });
  }

  const snapshot = {
    id: idFactory({ cryptoObject }),
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    createdAt: nowIso(now),
    kind,
    activeNoteId: normalized.activeNoteId,
    preferences: normalized.preferences,
    noteRevisionIds,
    documentChecksum: await fingerprintJson(normalized, { cryptoObject }),
  };
  snapshot.byteSize = encodedJsonBytes(snapshot);

  return { snapshot, noteRevisions };
}

export function validateNoteRevision(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !CHECKSUM_PATTERN.test(value.revisionId) ||
    value.note === null ||
    typeof value.note !== "object" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 0
  ) {
    throw new SnapshotValidationError("Snapshot history contains an invalid note revision.");
  }
  const probe = {
    version: 2,
    activeNoteId: value.note.id,
    notes: [value.note],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
  if (!isValidNotesDocument(probe)) {
    throw new SnapshotValidationError("Snapshot history contains an invalid note revision.");
  }
  return value;
}

export function validateSnapshotManifest(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.id !== "string" ||
    value.id === "" ||
    value.formatVersion !== SNAPSHOT_FORMAT_VERSION ||
    !isIsoTimestamp(value.createdAt) ||
    !VALID_KINDS.has(value.kind) ||
    typeof value.activeNoteId !== "string" ||
    value.activeNoteId === "" ||
    value.preferences === null ||
    typeof value.preferences !== "object" ||
    !Array.isArray(value.noteRevisionIds) ||
    value.noteRevisionIds.length === 0 ||
    value.noteRevisionIds.some((id) => !CHECKSUM_PATTERN.test(id)) ||
    !CHECKSUM_PATTERN.test(value.documentChecksum) ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 0
  ) {
    throw new SnapshotValidationError("Snapshot history contains an invalid checkpoint.");
  }
  return value;
}

export function validateHistoryArchive(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.format !== SNAPSHOT_HISTORY_FORMAT ||
    value.version !== SNAPSHOT_HISTORY_VERSION ||
    !Array.isArray(value.snapshots) ||
    !Array.isArray(value.noteRevisions)
  ) {
    throw new SnapshotValidationError("This file contains invalid snapshot history.");
  }

  const snapshotIds = new Set();
  for (const snapshot of value.snapshots) {
    validateSnapshotManifest(snapshot);
    if (snapshotIds.has(snapshot.id)) {
      throw new SnapshotValidationError("Snapshot history contains duplicate checkpoint IDs.");
    }
    snapshotIds.add(snapshot.id);
  }

  const revisionIds = new Set();
  for (const revision of value.noteRevisions) {
    validateNoteRevision(revision);
    if (revisionIds.has(revision.revisionId)) {
      throw new SnapshotValidationError("Snapshot history contains duplicate note revisions.");
    }
    revisionIds.add(revision.revisionId);
  }
  return value;
}

function revisionMap(revisions) {
  return revisions instanceof Map
    ? revisions
    : new Map(revisions.map((revision) => [revision.revisionId, revision]));
}

export async function reconstructSnapshot(
  snapshot,
  revisions,
  { cryptoObject = globalThis.crypto } = {},
) {
  validateSnapshotManifest(snapshot);
  const byId = revisionMap(revisions);
  const notes = [];
  const noteIds = new Set();

  for (const revisionId of snapshot.noteRevisionIds) {
    const revision = byId.get(revisionId);
    if (!revision) {
      throw new SnapshotValidationError(
        "Snapshot history is incomplete because a referenced note revision is missing.",
        { code: "missing-revision" },
      );
    }
    validateNoteRevision(revision);
    const note = normalizedNote(revision.note);
    if (revisionId !== (await fingerprintJson(note, { cryptoObject }))) {
      throw new SnapshotValidationError(
        "A snapshot note revision failed its checksum.",
        { code: "checksum-mismatch" },
      );
    }
    if (noteIds.has(note.id)) {
      throw new SnapshotValidationError("A snapshot contains duplicate note IDs.");
    }
    noteIds.add(note.id);
    notes.push(note);
  }

  const document = {
    version: 2,
    activeNoteId: snapshot.activeNoteId,
    notes,
    preferences: clone(snapshot.preferences),
  };
  if (!isValidNotesDocument(document)) {
    throw new SnapshotValidationError(
      "A snapshot does not reconstruct a complete JotKeep notebook.",
    );
  }
  if (snapshot.documentChecksum !== (await fingerprintJson(document, { cryptoObject }))) {
    throw new SnapshotValidationError(
      "A snapshot failed its notebook checksum.",
      { code: "checksum-mismatch" },
    );
  }
  return document;
}

export async function verifyHistoryArchive(
  archive,
  { cryptoObject = globalThis.crypto } = {},
) {
  validateHistoryArchive(archive);
  const byId = revisionMap(archive.noteRevisions);
  for (const snapshot of archive.snapshots) {
    await reconstructSnapshot(snapshot, byId, { cryptoObject });
  }
  return archive;
}

export function mergeHistoryArchives(...archives) {
  const snapshots = new Map();
  const revisions = new Map();
  for (const archive of archives.filter(Boolean)) {
    validateHistoryArchive(archive);
    for (const snapshot of archive.snapshots) {
      const existing = snapshots.get(snapshot.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot)) {
        throw new SnapshotValidationError("Snapshot histories contain a checkpoint ID collision.");
      }
      snapshots.set(snapshot.id, clone(snapshot));
    }
    for (const revision of archive.noteRevisions) {
      const existing = revisions.get(revision.revisionId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(revision)) {
        throw new SnapshotValidationError("Snapshot histories contain a note-revision collision.");
      }
      revisions.set(revision.revisionId, clone(revision));
    }
  }
  return {
    format: SNAPSHOT_HISTORY_FORMAT,
    version: SNAPSHOT_HISTORY_VERSION,
    snapshots: [...snapshots.values()],
    noteRevisions: [...revisions.values()],
  };
}

function isoWeekKey(date) {
  const value = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / DAY_MS) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function snapshotOrder(left, right) {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function archiveForSnapshots(archive, snapshots) {
  const referenced = new Set(snapshots.flatMap((snapshot) => snapshot.noteRevisionIds));
  const noteRevisions = archive.noteRevisions.filter((revision) =>
    referenced.has(revision.revisionId),
  );
  return {
    format: SNAPSHOT_HISTORY_FORMAT,
    version: SNAPSHOT_HISTORY_VERSION,
    snapshots: [...snapshots].sort(snapshotOrder),
    noteRevisions,
  };
}

export function pruneHistory(
  archive,
  {
    now = () => new Date(),
    maxBytes = MAX_HISTORY_BYTES,
    protectedSnapshotId = null,
  } = {},
) {
  validateHistoryArchive(archive);
  const currentTime = new Date(typeof now === "function" ? now() : now).getTime();
  const ordered = [...archive.snapshots].sort(snapshotOrder);
  const selected = new Map();
  const tiers = new Map();
  const buckets = {
    hourly: new Set(),
    daily: new Set(),
    weekly: new Set(),
  };

  function keep(snapshot, tier) {
    selected.set(snapshot.id, snapshot);
    tiers.set(snapshot.id, Math.max(tiers.get(snapshot.id) ?? -1, tier));
  }

  for (const snapshot of ordered) {
    const age = Math.max(0, currentTime - new Date(snapshot.createdAt).getTime());
    if (snapshot.id === protectedSnapshotId) {
      keep(snapshot, 4);
      continue;
    }
    if (
      [SNAPSHOT_KINDS.PRE_RESTORE, SNAPSHOT_KINDS.BEFORE_DELETE].includes(snapshot.kind) &&
      age < RECENT_HOURS * HOUR_MS
    ) {
      keep(snapshot, 3);
      continue;
    }
    const date = new Date(snapshot.createdAt);
    if (age < RECENT_HOURS * HOUR_MS) {
      const key = snapshot.createdAt.slice(0, 13);
      if (!buckets.hourly.has(key)) {
        buckets.hourly.add(key);
        keep(snapshot, 2);
      }
    } else if (age < (RECENT_HOURS * HOUR_MS) + (DAILY_DAYS * DAY_MS)) {
      const key = snapshot.createdAt.slice(0, 10);
      if (!buckets.daily.has(key)) {
        buckets.daily.add(key);
        keep(snapshot, 1);
      }
    } else if (
      age <
      (RECENT_HOURS * HOUR_MS) +
        (DAILY_DAYS * DAY_MS) +
        (WEEKLY_WEEKS * 7 * DAY_MS)
    ) {
      const key = isoWeekKey(date);
      if (!buckets.weekly.has(key)) {
        buckets.weekly.add(key);
        keep(snapshot, 0);
      }
    }
  }

  let retained = [...selected.values()];
  let result = archiveForSnapshots(archive, retained);
  while (encodedJsonBytes(result) > maxBytes) {
    const removable = retained
      .filter((snapshot) => snapshot.id !== protectedSnapshotId)
      .sort((left, right) =>
        (tiers.get(left.id) ?? 0) - (tiers.get(right.id) ?? 0) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
      );
    if (removable.length === 0) {
      break;
    }
    const removeId = removable[0].id;
    retained = retained.filter((snapshot) => snapshot.id !== removeId);
    result = archiveForSnapshots(archive, retained);
  }

  return {
    archive: result,
    fits: encodedJsonBytes(result) <= maxBytes,
    removedSnapshotIds: archive.snapshots
      .filter((snapshot) => !retained.some((item) => item.id === snapshot.id))
      .map((snapshot) => snapshot.id),
  };
}

export function hasAutomaticSnapshotInUtcHour(snapshots, date = new Date()) {
  const hour = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 13);
  return snapshots.some(
    (snapshot) =>
      snapshot.kind === SNAPSHOT_KINDS.AUTOMATIC &&
      snapshot.createdAt.slice(0, 13) === hour,
  );
}

export function restoreNoteFromSnapshot(
  currentDocument,
  snapshotDocument,
  noteId,
  {
    asCopy = false,
    now = () => new Date(),
    idFactory = createNoteId,
  } = {},
) {
  if (!isValidNotesDocument(currentDocument) || !isValidNotesDocument(snapshotDocument)) {
    throw new TypeError("Cannot restore a note from an invalid notebook.");
  }
  const historical = snapshotDocument.notes.find((note) => note.id === noteId);
  if (!historical) {
    throw new SnapshotValidationError("The selected note does not exist in this snapshot.");
  }

  const candidate = clone(currentDocument);
  if (asCopy) {
    const existingIds = new Set(candidate.notes.map((note) => note.id));
    const id = idFactory({ existingIds });
    if (existingIds.has(id)) {
      throw new Error("Unable to generate a unique note ID for the recovered copy.");
    }
    const timestamp = nowIso(now);
    candidate.notes.push({
      ...clone(historical),
      id,
      title: `${displayNoteTitle(historical)} (Recovered copy)`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    candidate.activeNoteId = id;
  } else {
    const index = candidate.notes.findIndex((note) => note.id === noteId);
    if (index === -1) {
      candidate.notes.push(clone(historical));
    } else {
      candidate.notes[index] = clone(historical);
    }
    candidate.activeNoteId = historical.id;
  }

  if (!isValidNotesDocument(candidate)) {
    throw new SnapshotValidationError("The selected note cannot form a valid notebook.");
  }
  return candidate;
}
