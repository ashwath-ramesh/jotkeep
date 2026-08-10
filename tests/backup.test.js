import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupValidationError,
  MAX_BACKUP_BYTES,
  MAX_FILENAME_BYTES,
  backupFilename,
  createBackup,
  decodeUtf8,
  mergeBackupDocument,
  parseBackup,
  sanitizeFilename,
  serializeBackup,
  titleFromTextFilename,
} from "../src/backup.js";

const CREATED_AT = "2026-08-09T12:00:00.000Z";

function documentFixture() {
  return {
    version: 2,
    activeNoteId: "note_a",
    notes: [
      {
        id: "note_a",
        title: "Café notes",
        content: "Tea\r\nCoffee ☕",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
}

test("sanitizeFilename creates portable text filenames without losing Unicode", () => {
  assert.equal(sanitizeFilename("  Café / plans:*?  "), "Café - plans-.txt");
  assert.equal(sanitizeFilename("..."), "Untitled Note.txt");
  assert.equal(sanitizeFilename("CON"), "_CON.txt");
  assert.equal(sanitizeFilename("con.notes"), "_con.notes.txt");
  assert.equal(sanitizeFilename("a".repeat(110)), `${"a".repeat(100)}.txt`);

  const multibyteFilename = sanitizeFilename("😀".repeat(100));
  assert.ok(
    new TextEncoder().encode(multibyteFilename).byteLength <= MAX_FILENAME_BYTES,
  );
  assert.match(multibyteFilename, /\.txt$/u);
});

test("text helpers preserve valid UTF-8 and reject malformed or oversized input", () => {
  const encoded = new TextEncoder().encode("First\r\nCrème ☕");
  assert.equal(decodeUtf8(encoded), "First\r\nCrème ☕");
  assert.throws(() => decodeUtf8(Uint8Array.from([0xc3, 0x28])), /valid UTF-8/u);
  assert.throws(() => decodeUtf8(new Uint8Array(3), { maxBytes: 2 }), /5 MiB/u);
  assert.equal(titleFromTextFilename("  notes.TXT"), "notes");
});

test("backup creation and serialization round-trip the versioned format", () => {
  const document = documentFixture();
  const backup = createBackup(document, { now: () => new Date(CREATED_AT) });
  const serialized = serializeBackup(backup);

  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.notStrictEqual(backup.document, document);
  assert.deepEqual(parseBackup(serialized), backup);
  assert.equal(
    backupFilename(CREATED_AT),
    "jotkeep-backup-2026-08-09T12-00-00Z.json",
  );
});

test("backup parsing reports JSON, format, version, document, and size failures", () => {
  assert.throws(() => parseBackup("{"), BackupValidationError);
  assert.throws(
    () => parseBackup(JSON.stringify({ format: "other", version: 1 })),
    /not a JotKeep/u,
  );

  const backup = createBackup(documentFixture(), {
    now: () => new Date(CREATED_AT),
  });
  assert.throws(
    () => parseBackup(JSON.stringify({ ...backup, version: 99 })),
    /not supported/u,
  );
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          ...backup,
          document: { ...backup.document, activeNoteId: "missing" },
        }),
      ),
    /invalid notes or preferences/u,
  );
  assert.throws(
    () => parseBackup("{}", { byteLength: MAX_BACKUP_BYTES + 1 }),
    /larger than 25 MiB/u,
  );
});

test("merge appends all notes, regenerates collisions, and keeps local context", () => {
  const current = documentFixture();
  current.preferences = { sortBy: "title", listView: "compact" };
  const imported = documentFixture();
  imported.notes.push({
    ...imported.notes[0],
    id: "note_b",
    title: "Second",
  });
  imported.activeNoteId = "note_b";
  imported.preferences = { sortBy: "createdAt", listView: "detailed" };

  const merged = mergeBackupDocument(current, imported, {
    idFactory: ({ existingIds }) => {
      assert.deepEqual([...existingIds], ["note_a"]);
      return "note_regenerated";
    },
  });

  assert.equal(merged.activeNoteId, "note_a");
  assert.deepEqual(merged.preferences, current.preferences);
  assert.deepEqual(
    merged.notes.map((note) => note.id),
    ["note_a", "note_regenerated", "note_b"],
  );
  assert.equal(merged.notes[1].createdAt, CREATED_AT);
  assert.equal(current.notes.length, 1);
});

test("parseBackup clamps impossible note timestamps instead of rejecting", () => {
  const document = documentFixture();
  document.notes[0].updatedAt = "2020-01-01T00:00:00.000Z";
  const backup = createBackup(documentFixture(), { now: () => new Date(CREATED_AT) });
  backup.document.notes[0].updatedAt = "2020-01-01T00:00:00.000Z";
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.document.notes[0].updatedAt, parsed.document.notes[0].createdAt);
});

test("backup checksums verify intact files and reject corrupted notes", async () => {
  const { webcrypto } = await import("node:crypto");
  const { notebookChecksum } = await import("../src/safety-file-format.js");
  const { verifyBackupChecksum } = await import("../src/backup.js");
  const cryptoObject = globalThis.crypto ?? webcrypto;

  const backup = createBackup(documentFixture(), { now: () => new Date(CREATED_AT) });
  backup.checksum = await notebookChecksum(backup.document, { cryptoObject });
  assert.doesNotThrow(() => parseBackup(serializeBackup(backup)));
  await verifyBackupChecksum(backup, { cryptoObject });

  const legacy = createBackup(documentFixture(), { now: () => new Date(CREATED_AT) });
  await verifyBackupChecksum(legacy, { cryptoObject }); // no checksum → passes

  backup.document.notes[0].content = "Silently flipped";
  await assert.rejects(
    () => verifyBackupChecksum(backup, { cryptoObject }),
    (error) => error instanceof BackupValidationError && /checksum/u.test(error.message),
  );

  assert.throws(
    () => parseBackup(JSON.stringify({ ...legacy, checksum: "not-hex" })),
    /invalid checksum/u,
  );
});
