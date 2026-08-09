import { createNoteId } from "./notes.js";
import { isValidNotesDocument } from "./storage.js";

export const BACKUP_FORMAT = "jotkeep-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILENAME_BYTES = 255;

const TEXT_FILE_EXTENSION = ".txt";
const MAX_TEXT_BASENAME_BYTES =
  MAX_FILENAME_BYTES - new TextEncoder().encode(TEXT_FILE_EXTENSION).byteLength;

const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export class BackupValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupValidationError";
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

function truncateUtf8(value, maxBytes) {
  let byteLength = 0;
  let truncated = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const characterBytes =
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;

    if (byteLength + characterBytes > maxBytes) {
      break;
    }

    truncated += character;
    byteLength += characterBytes;
  }

  return truncated;
}

export function sanitizeFilename(title) {
  let basename = String(title ?? "")
    .normalize("NFC")
    .trim()
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/-+/gu, "-")
    .replace(/^[. ]+|[. ]+$/gu, "");

  basename = truncateUtf8(
    Array.from(basename).slice(0, 100).join(""),
    MAX_TEXT_BASENAME_BYTES,
  ).replace(/[. ]+$/gu, "");

  if (basename === "") {
    basename = "Untitled Note";
  } else if (WINDOWS_RESERVED_NAME.test(basename)) {
    basename = `_${basename}`;
  }

  return `${basename}${TEXT_FILE_EXTENSION}`;
}

export function backupFilename(createdAt) {
  if (!isIsoTimestamp(createdAt)) {
    throw new TypeError("A valid backup timestamp is required.");
  }

  const compactTimestamp = createdAt
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(":", "-");
  return `jotkeep-backup-${compactTimestamp}.json`;
}

export function createBackup(document, { now = () => new Date() } = {}) {
  if (!isValidNotesDocument(document)) {
    throw new TypeError("Cannot back up an invalid notes document.");
  }

  const value = typeof now === "function" ? now() : now;
  const createdAt = (value instanceof Date ? value : new Date(value)).toISOString();

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    document: structuredClone(document),
  };
}

export function serializeBackup(backup) {
  validateBackup(backup);
  const text = `${JSON.stringify(backup, null, 2)}\n`;

  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new BackupValidationError(
      "This notebook is too large for a restorable JSON backup. Download important notes as text files.",
    );
  }

  return text;
}

export function validateBackup(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BackupValidationError("This file is not a JotKeep JSON backup.");
  }

  if (value.format !== BACKUP_FORMAT) {
    throw new BackupValidationError(
      "This file is not a JotKeep JSON backup. Choose a backup exported by JotKeep.",
    );
  }

  if (value.version !== BACKUP_VERSION) {
    throw new BackupValidationError(
      `Backup version ${String(value.version)} is not supported. This version of JotKeep supports backup version ${BACKUP_VERSION}.`,
    );
  }

  if (!isIsoTimestamp(value.createdAt)) {
    throw new BackupValidationError("The backup has an invalid creation date.");
  }

  if (!isValidNotesDocument(value.document)) {
    throw new BackupValidationError(
      "The backup contains invalid notes or preferences and cannot be restored.",
    );
  }

  return value;
}

export function parseBackup(text, { byteLength } = {}) {
  const size = byteLength ?? new TextEncoder().encode(text).byteLength;

  if (size > MAX_BACKUP_BYTES) {
    throw new BackupValidationError("The selected backup is larger than 25 MiB.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError(
      "The selected file is not valid JSON. Choose an unmodified JotKeep backup.",
    );
  }

  validateBackup(parsed);
  return parsed;
}

export function decodeUtf8(buffer, { maxBytes = MAX_TEXT_FILE_BYTES } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (bytes.byteLength > maxBytes) {
    throw new TypeError("The selected text file is larger than 5 MiB.");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("The selected text file is not valid UTF-8.");
  }
}

export function titleFromTextFilename(filename) {
  return filename.replace(/\.txt$/iu, "").trim();
}

export function mergeBackupDocument(
  currentDocument,
  backupDocument,
  { idFactory = createNoteId } = {},
) {
  if (!isValidNotesDocument(currentDocument) || !isValidNotesDocument(backupDocument)) {
    throw new TypeError("Cannot merge invalid notes documents.");
  }

  const existingIds = new Set(currentDocument.notes.map((note) => note.id));
  const importedNotes = backupDocument.notes.map((note) => {
    let id = note.id;

    if (existingIds.has(id)) {
      id = idFactory({ existingIds });
      if (existingIds.has(id)) {
        throw new Error("Unable to generate a unique note ID while merging.");
      }
    }

    existingIds.add(id);
    return { ...note, id };
  });

  return {
    ...currentDocument,
    notes: [...currentDocument.notes, ...importedNotes],
  };
}
