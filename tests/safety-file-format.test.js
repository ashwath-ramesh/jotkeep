import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  MAX_CURRENT_DOCUMENT_BYTES,
  MAX_SAFETY_FILE_BYTES,
  LEGACY_SAFETY_FILE_VERSION,
  SAFETY_FILE_FORMAT,
  SAFETY_FILE_VERSION,
  SafetyFileValidationError,
  createSafetyFile,
  decodeSafetyFile,
  fingerprintText,
  parseSafetyFile,
  safetyFileFilename,
  serializeSafetyFile,
} from "../src/safety-file-format.js";
import { MAX_HISTORY_BYTES } from "../src/snapshots.js";

const CREATED_AT = "2026-08-09T12:00:00.000Z";

function documentFixture() {
  return {
    version: 2,
    activeNoteId: "note_a",
    notes: [{
      id: "note_a",
      title: "Café",
      content: "Tea\nCoffee ☕",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
}

test("Safety Files round-trip notes, preferences, timestamps, and format metadata", () => {
  let nextId = 0;
  const value = createSafetyFile(documentFixture(), {
    now: () => new Date(CREATED_AT),
    idFactory: () => `id_${++nextId}`,
  });
  const serialized = serializeSafetyFile(value);

  assert.equal(value.format, SAFETY_FILE_FORMAT);
  assert.equal(value.version, SAFETY_FILE_VERSION);
  assert.equal(value.fileId, "id_1");
  assert.equal(value.revisionId, "id_2");
  assert.equal(value.createdAt, CREATED_AT);
  assert.deepEqual(parseSafetyFile(serialized), value);
  assert.notStrictEqual(value.document, documentFixture());
});

test("updating a Safety File preserves its identity and creation time", () => {
  let nextId = 0;
  const first = createSafetyFile(documentFixture(), {
    now: () => new Date(CREATED_AT),
    idFactory: () => `id_${++nextId}`,
  });
  const document = documentFixture();
  document.notes[0].content = "Updated";
  const second = createSafetyFile(document, {
    previous: first,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    idFactory: () => `id_${++nextId}`,
  });

  assert.equal(second.fileId, first.fileId);
  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.revisionId, first.revisionId);
  assert.equal(second.updatedAt, "2026-08-10T12:00:00.000Z");
});

test("Safety File parsing rejects malformed, incompatible, invalid, and oversized data", () => {
  assert.throws(() => parseSafetyFile("{"), SafetyFileValidationError);
  assert.throws(
    () => parseSafetyFile(JSON.stringify({ format: "other", version: 1 })),
    /not a JotKeep/u,
  );
  const value = createSafetyFile(documentFixture(), {
    now: () => new Date(CREATED_AT),
    idFactory: () => "id",
  });
  assert.throws(
    () => parseSafetyFile(JSON.stringify({ ...value, version: 99 })),
    /not supported/u,
  );
  assert.throws(
    () => parseSafetyFile(JSON.stringify({ ...value, document: {} })),
    /invalid notes/u,
  );
  assert.throws(
    () => parseSafetyFile("{}", { byteLength: MAX_SAFETY_FILE_BYTES + 1 }),
    /larger than 50 MiB/u,
  );
});

test("Safety Files enforce separate 25 MiB notebook and history limits", () => {
  const oversizedText = "x".repeat(MAX_CURRENT_DOCUMENT_BYTES);
  const oversizedDocument = createSafetyFile(documentFixture(), {
    now: () => new Date(CREATED_AT),
    idFactory: () => "id",
  });
  oversizedDocument.document.notes[0].content = oversizedText;
  assert.throws(
    () => parseSafetyFile(JSON.stringify(oversizedDocument)),
    /current notebook is larger than 25 MiB/u,
  );

  assert.equal(MAX_HISTORY_BYTES, MAX_CURRENT_DOCUMENT_BYTES);
  const oversizedHistory = {
    format: "jotkeep-history",
    version: 1,
    snapshots: [{
      id: "snapshot",
      formatVersion: 1,
      createdAt: CREATED_AT,
      kind: "automatic",
      activeNoteId: "note_a",
      preferences: { sortBy: "updatedAt", listView: "detailed" },
      noteRevisionIds: ["a".repeat(64)],
      documentChecksum: "b".repeat(64),
      byteSize: 0,
    }],
    noteRevisions: [{
      revisionId: "a".repeat(64),
      note: { ...documentFixture().notes[0], content: oversizedText },
      byteSize: 0,
    }],
  };
  const oversizedHistoryFile = createSafetyFile(documentFixture(), {
    now: () => new Date(CREATED_AT),
    idFactory: () => "id",
  });
  oversizedHistoryFile.history = oversizedHistory;
  assert.throws(
    () => parseSafetyFile(JSON.stringify(oversizedHistoryFile)),
    /snapshot history is larger than 25 MiB/u,
  );
});

test("version 1 Safety Files remain readable with empty history", () => {
  const legacy = {
    format: SAFETY_FILE_FORMAT,
    version: LEGACY_SAFETY_FILE_VERSION,
    fileId: "legacy-file",
    revisionId: "legacy-revision",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    document: documentFixture(),
  };
  const parsed = parseSafetyFile(JSON.stringify(legacy));
  assert.equal(parsed.version, LEGACY_SAFETY_FILE_VERSION);
  assert.deepEqual(parsed.history.snapshots, []);
  assert.deepEqual(parsed.history.noteRevisions, []);
});

test("Safety File byte helpers preserve UTF-8 and produce stable fingerprints", async () => {
  const text = "Café ☕";
  assert.equal(decodeSafetyFile(new TextEncoder().encode(text)), text);
  assert.throws(() => decodeSafetyFile(Uint8Array.from([0xc3, 0x28])), /UTF-8/u);
  const options = { cryptoObject: globalThis.crypto ?? webcrypto };
  assert.equal(
    await fingerprintText(text, options),
    await fingerprintText(text, options),
  );
  assert.notEqual(
    await fingerprintText(text, options),
    await fingerprintText(`${text}!`, options),
  );
  assert.equal(
    safetyFileFilename(CREATED_AT),
    "jotkeep-safety-2026-08-09T12-00-00Z.jotkeep",
  );
});

test("a clock rollback cannot move a Safety File revision backwards in time", () => {
  const LATER = "2026-08-10T12:00:00.000Z";
  const EARLIER = "2026-08-08T12:00:00.000Z";
  const first = createSafetyFile(documentFixture(), { now: () => new Date(LATER) });

  const next = createSafetyFile(documentFixture(), {
    previous: first,
    now: () => new Date(EARLIER),
  });
  assert.equal(next.createdAt, first.createdAt);
  assert.equal(next.updatedAt, first.updatedAt);
  assert.doesNotThrow(() => serializeSafetyFile(next));
});

test("parsing clamps impossible note timestamps instead of rejecting the file", () => {
  const value = createSafetyFile(documentFixture(), { now: () => new Date(CREATED_AT) });
  value.document.notes[0].updatedAt = "2020-01-01T00:00:00.000Z";
  const parsed = parseSafetyFile(JSON.stringify(value));
  assert.equal(parsed.document.notes[0].updatedAt, parsed.document.notes[0].createdAt);
});

test("createSafetyFile normalizes impossible note timestamps on write", () => {
  const document = documentFixture();
  document.notes[0].updatedAt = "2020-01-01T00:00:00.000Z";
  const value = createSafetyFile(document, { now: () => new Date(CREATED_AT) });
  assert.equal(value.document.notes[0].updatedAt, value.document.notes[0].createdAt);
});
