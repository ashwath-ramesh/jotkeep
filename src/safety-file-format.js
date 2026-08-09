import { isValidNotesDocument } from "./storage.js";

export const SAFETY_FILE_FORMAT = "plainjot-safety-file";
export const SAFETY_FILE_VERSION = 1;
export const MAX_SAFETY_FILE_BYTES = 25 * 1024 * 1024;

export class SafetyFileValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SafetyFileValidationError";
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

  const updatedAt = timestamp(now);
  return {
    format: SAFETY_FILE_FORMAT,
    version: SAFETY_FILE_VERSION,
    fileId: previous?.fileId ?? idFactory(),
    revisionId: idFactory(),
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
    document: structuredClone(document),
  };
}

export function validateSafetyFile(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SafetyFileValidationError("This is not a PlainJot Safety File.");
  }
  if (value.format !== SAFETY_FILE_FORMAT) {
    throw new SafetyFileValidationError(
      "This is not a PlainJot Safety File. Choose a file ending in .plainjot.",
    );
  }
  if (value.version !== SAFETY_FILE_VERSION) {
    throw new SafetyFileValidationError(
      `Safety File version ${String(value.version)} is not supported. This version of PlainJot supports version ${SAFETY_FILE_VERSION}.`,
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
  return validateSafetyFile(value);
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
  return `plainjot-safety-${compactTimestamp}.plainjot`;
}
