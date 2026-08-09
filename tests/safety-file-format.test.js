import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  MAX_SAFETY_FILE_BYTES,
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
    /not a PlainJot/u,
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
    /larger than 25 MiB/u,
  );
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
    "plainjot-safety-2026-08-09T12-00-00Z.plainjot",
  );
});
