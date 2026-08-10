import { clampNoteTimestamps, isValidNotesDocument } from "./storage.js";

export const SAFETY_FILE_FORMAT = "jotkeep-safety-file";
export const SAFETY_FILE_VERSION = 1;
export const MAX_SAFETY_FILE_BYTES = 25 * 1024 * 1024;

export class SafetyFileValidationError extends Error {
  constructor(message, { code = null } = {}) {
    super(message);
    this.name = "SafetyFileValidationError";
    this.code = code;
  }
}

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

/* Detects accidental corruption (bit rot, truncation-with-valid-JSON, sync
   mangling) of a downloaded file — not malicious tampering, which could
   recompute the checksum. */
export async function notebookChecksum(
  document,
  { cryptoObject = globalThis.crypto } = {},
) {
  return fingerprintText(JSON.stringify(document), { cryptoObject });
}

export async function verifyEmbeddedChecksum(
  value,
  { cryptoObject = globalThis.crypto } = {},
) {
  if (typeof value?.checksum !== "string") {
    return; // Files from older versions carry no checksum.
  }
  if (value.checksum !== (await notebookChecksum(value.document, { cryptoObject }))) {
    throw new SafetyFileValidationError(
      "The file's embedded checksum does not match its notes. The file may be corrupted; restore from another copy.",
      { code: "checksum-mismatch" },
    );
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

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function createSafetyFileId({
  cryptoObject = globalThis.crypto,
  now = Date.now,
  random = Math.random,
} = {}) {
  if (typeof cryptoObject?.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }

  return `${Number(now()).toString(36)}-${Math.floor(random() * 1e15).toString(36)}`;
}

export function createSafetyFile(
  document,
  {
    previous = null,
    now = () => new Date(),
    idFactory = createSafetyFileId,
  } = {},
) {
  if (!isValidNotesDocument(document)) {
    throw new TypeError("Cannot create a Safety File from an invalid notebook.");
  }
  if (previous !== null) {
    validateSafetyFile(previous);
  }

  // Clamp against the previous revision so a clock rollback cannot produce a
  // file whose update time precedes its creation time and gets rejected.
  let updatedAt = timestamp(now);
  if (previous !== null && updatedAt < previous.updatedAt) {
    updatedAt = previous.updatedAt;
  }
  return {
    format: SAFETY_FILE_FORMAT,
    version: SAFETY_FILE_VERSION,
    fileId: previous?.fileId ?? idFactory(),
    revisionId: idFactory(),
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
    // Normalized on write as well as on parse so a round-trip through disk
    // reproduces the same bytes and write verification stays exact.
    document: clampNoteTimestamps(structuredClone(document)),
  };
}

export function validateSafetyFile(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SafetyFileValidationError("This is not a JotKeep Safety File.");
  }
  if (value.format !== SAFETY_FILE_FORMAT) {
    throw new SafetyFileValidationError(
      "This is not a JotKeep Safety File. Choose a file ending in .jotkeep.",
    );
  }
  if (value.version !== SAFETY_FILE_VERSION) {
    throw new SafetyFileValidationError(
      `Safety File version ${String(value.version)} is not supported. This version of JotKeep supports version ${SAFETY_FILE_VERSION}.`,
    );
  }
  if (
    typeof value.fileId !== "string" ||
    value.fileId === "" ||
    typeof value.revisionId !== "string" ||
    value.revisionId === ""
  ) {
    throw new SafetyFileValidationError("The Safety File has invalid identity metadata.");
  }
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) {
    throw new SafetyFileValidationError("The Safety File has invalid timestamps.");
  }
  if (value.checksum !== undefined && !CHECKSUM_PATTERN.test(value.checksum)) {
    throw new SafetyFileValidationError("The Safety File has an invalid checksum field.");
  }
  if (value.createdAt > value.updatedAt) {
    throw new SafetyFileValidationError(
      "The Safety File update time is earlier than its creation time.",
    );
  }
  if (!isValidNotesDocument(value.document)) {
    throw new SafetyFileValidationError(
      "The Safety File contains invalid notes or preferences and cannot be opened.",
    );
  }

  return value;
}

export function serializeSafetyFile(value) {
  validateSafetyFile(value);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (new TextEncoder().encode(text).byteLength > MAX_SAFETY_FILE_BYTES) {
    throw new SafetyFileValidationError(
      "This notebook is too large for a Safety File. Download important notes as text files.",
      { code: "too-large" },
    );
  }
  return text;
}

export function parseSafetyFile(text, { byteLength } = {}) {
  const size = byteLength ?? new TextEncoder().encode(text).byteLength;
  if (size > MAX_SAFETY_FILE_BYTES) {
    throw new SafetyFileValidationError("The selected Safety File is larger than 25 MiB.");
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SafetyFileValidationError(
      "The selected Safety File is not valid JSON or is incomplete.",
    );
  }
  validateSafetyFile(value);
  return { ...value, document: clampNoteTimestamps(value.document) };
}

export function decodeSafetyFile(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > MAX_SAFETY_FILE_BYTES) {
    throw new SafetyFileValidationError("The selected Safety File is larger than 25 MiB.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SafetyFileValidationError("The selected Safety File is not valid UTF-8.");
  }
}

export async function fingerprintText(
  text,
  { cryptoObject = globalThis.crypto } = {},
) {
  if (typeof cryptoObject?.subtle?.digest !== "function") {
    throw new Error("Secure file verification is unavailable in this browser.");
  }
  const digest = await cryptoObject.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function safetyFileFilename(createdAt) {
  if (!isIsoTimestamp(createdAt)) {
    throw new TypeError("A valid Safety File timestamp is required.");
  }
  const compactTimestamp = createdAt
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(":", "-");
  return `jotkeep-safety-${compactTimestamp}.jotkeep`;
}
