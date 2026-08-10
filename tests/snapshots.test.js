import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  SNAPSHOT_KINDS,
  SnapshotValidationError,
  createSnapshot,
  emptyHistoryArchive,
  hasAutomaticSnapshotInUtcHour,
  mergeHistoryArchives,
  pruneHistory,
  reconstructSnapshot,
  restoreNoteFromSnapshot,
  verifyHistoryArchive,
} from "../src/snapshots.js";

const cryptoObject = globalThis.crypto ?? webcrypto;
const CREATED_AT = "2026-08-09T12:00:00.000Z";

function documentFixture(content = "One") {
  return {
    version: 2,
    activeNoteId: "note_a",
    notes: [{
      id: "note_a",
      title: "First",
      content,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }, {
      id: "note_b",
      title: "Unchanged",
      content: "Shared",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
}

function archiveFrom(created) {
  return {
    ...emptyHistoryArchive(),
    snapshots: [created.snapshot],
    noteRevisions: created.noteRevisions,
  };
}

test("snapshot archives share unchanged note revisions and reconstruct documents", async () => {
  const first = await createSnapshot(documentFixture(), {
    now: new Date("2026-08-10T10:00:00.000Z"),
    idFactory: () => "snapshot_a",
    cryptoObject,
  });
  const second = await createSnapshot(documentFixture("Two"), {
    now: new Date("2026-08-10T11:00:00.000Z"),
    idFactory: () => "snapshot_b",
    cryptoObject,
  });
  const archive = mergeHistoryArchives(archiveFrom(first), archiveFrom(second));

  assert.equal(archive.snapshots.length, 2);
  assert.equal(archive.noteRevisions.length, 3);
  assert.deepEqual(
    await reconstructSnapshot(second.snapshot, archive.noteRevisions, { cryptoObject }),
    documentFixture("Two"),
  );
  await assert.doesNotReject(() => verifyHistoryArchive(archive, { cryptoObject }));
});

test("missing and changed note revisions reject a snapshot before restore", async () => {
  const created = await createSnapshot(documentFixture(), {
    idFactory: () => "snapshot_a",
    cryptoObject,
  });
  await assert.rejects(
    () => reconstructSnapshot(created.snapshot, created.noteRevisions.slice(1), { cryptoObject }),
    (error) => error instanceof SnapshotValidationError && error.code === "missing-revision",
  );

  const changed = structuredClone(created.noteRevisions);
  changed[0].note.content = "Corrupt";
  await assert.rejects(
    () => reconstructSnapshot(created.snapshot, changed, { cryptoObject }),
    (error) => error instanceof SnapshotValidationError && error.code === "checksum-mismatch",
  );
});

test("retention selects hourly, daily, and weekly buckets deterministically", async () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  let archive = emptyHistoryArchive();
  let sequence = 0;
  const offsets = [
    ...Array.from({ length: 30 }, (_, index) => index * 60 * 60 * 1000),
    ...Array.from({ length: 40 }, (_, index) => (2 + index) * 24 * 60 * 60 * 1000),
    ...Array.from({ length: 20 }, (_, index) => (35 + index * 7) * 24 * 60 * 60 * 1000),
  ];
  for (const offset of offsets) {
    const created = await createSnapshot(documentFixture(), {
      now: new Date(now.getTime() - offset),
      idFactory: () => `snapshot_${String(sequence++).padStart(3, "0")}`,
      cryptoObject,
    });
    archive = mergeHistoryArchives(archive, archiveFrom(created));
  }

  const first = pruneHistory(archive, { now });
  const second = pruneHistory(structuredClone(archive), { now });
  assert.deepEqual(first.archive, second.archive);
  assert.ok(first.archive.snapshots.length <= 24 + 30 + 12);
  assert.ok(first.archive.snapshots.length > 50);
});

test("the newest pre-restore point is protected and reports when it cannot fit", async () => {
  const created = await createSnapshot(documentFixture("Large enough"), {
    kind: SNAPSHOT_KINDS.PRE_RESTORE,
    idFactory: () => "protected",
    cryptoObject,
  });
  const result = pruneHistory(archiveFrom(created), {
    protectedSnapshotId: "protected",
    maxBytes: 1,
  });
  assert.equal(result.fits, false);
  assert.equal(result.archive.snapshots[0].id, "protected");
});

test("single-note restore preserves unrelated notes and copy restore gets a new identity", () => {
  const current = documentFixture("Current");
  const earlier = documentFixture("Earlier");
  const restored = restoreNoteFromSnapshot(current, earlier, "note_a");
  assert.equal(restored.notes[0].content, "Earlier");
  assert.deepEqual(restored.notes[1], current.notes[1]);

  const copied = restoreNoteFromSnapshot(current, earlier, "note_a", {
    asCopy: true,
    now: new Date("2026-08-10T12:00:00.000Z"),
    idFactory: () => "note_copy",
  });
  assert.equal(copied.activeNoteId, "note_copy");
  assert.equal(copied.notes.at(-1).title, "First (Recovered copy)");
  assert.equal(copied.notes.at(-1).content, "Earlier");
});

test("automatic snapshot hour detection uses UTC hour buckets", async () => {
  const created = await createSnapshot(documentFixture(), {
    now: new Date("2026-08-10T12:59:00.000Z"),
    cryptoObject,
  });
  assert.equal(
    hasAutomaticSnapshotInUtcHour([created.snapshot], new Date("2026-08-10T12:00:00.000Z")),
    true,
  );
  assert.equal(
    hasAutomaticSnapshotInUtcHour([created.snapshot], new Date("2026-08-10T13:00:00.000Z")),
    false,
  );
});
