import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  SAFETY_FILE_FAILURES,
  SAFETY_FILE_STATES,
  createSafetyFileCoordinator,
  readSafetyFileHandle,
  writeSafetyFile,
} from "../src/safety-file.js";
import {
  LEGACY_SAFETY_FILE_VERSION,
  SAFETY_FILE_FORMAT,
} from "../src/safety-file-format.js";
import {
  createSnapshot,
  emptyHistoryArchive,
} from "../src/snapshots.js";

const CREATED_AT = "2026-08-09T12:00:00.000Z";
const cryptoObject = globalThis.crypto ?? webcrypto;

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
    }],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
}

async function historyFixture(document = documentFixture()) {
  const created = await createSnapshot(document, {
    now: () => new Date(CREATED_AT),
    idFactory: () => "snapshot_one",
    cryptoObject,
  });
  return {
    ...emptyHistoryArchive(),
    snapshots: [created.snapshot],
    noteRevisions: created.noteRevisions,
  };
}

function memoryHandle(initialText = "", options = {}) {
  let text = initialText;
  let permission = "granted";
  let failClose = options.failClose ?? false;
  let truncateTo = options.truncateTo ?? null;
  let staleReads = options.staleReads ?? 0;
  const omitAbort = options.omitAbort ?? false;
  let staleText = null;
  let abortCalls = 0;
  return {
    kind: "file",
    name: "Notebook.jotkeep",
    async queryPermission() {
      return permission;
    },
    async requestPermission() {
      return permission;
    },
    async getFile() {
      let served = text;
      if (staleReads > 0 && staleText !== null) {
        staleReads -= 1;
        served = staleText;
      }
      const bytes = new TextEncoder().encode(served);
      return {
        name: this.name,
        size: bytes.byteLength,
        lastModified: 1,
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
    async createWritable() {
      let pending = text;
      const writable = {
        async write(value) {
          pending = String(value);
        },
        async close() {
          if (failClose) {
            throw new Error("disk full");
          }
          staleText = text;
          text = truncateTo === null ? pending : pending.slice(0, truncateTo);
        },
      };
      if (!omitAbort) {
        writable.abort = async () => {
          abortCalls += 1;
        };
      }
      return writable;
    },
    setText(value) {
      text = value;
    },
    getText() {
      return text;
    },
    setPermission(value) {
      permission = value;
    },
    setFailClose(value) {
      failClose = value;
    },
    setTruncateTo(value) {
      truncateTo = value;
    },
    setStaleReads(value) {
      staleReads = value;
    },
    getAbortCalls() {
      return abortCalls;
    },
  };
}

test("verified writes round-trip through a writable file handle", async () => {
  const handle = memoryHandle();
  const read = await writeSafetyFile(handle, documentFixture(), {
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });

  assert.equal(read.value.document.notes[0].content, "One");
  assert.deepEqual((await readSafetyFileHandle(handle, { cryptoObject })).value, read.value);
});

test("a changed baseline blocks an automatic overwrite", async () => {
  const handle = memoryHandle();
  const first = await writeSafetyFile(handle, documentFixture(), {
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  handle.setText(`${handle.getText()} `);

  await assert.rejects(
    () => writeSafetyFile(handle, documentFixture("Two"), {
      expectedDigest: first.digest,
      cryptoObject,
    }),
    (error) => error.kind === SAFETY_FILE_FAILURES.EXTERNAL_CHANGE,
  );
});

test("corrupt local history is rejected before a valid Safety File is opened for writing", async () => {
  const handle = memoryHandle();
  const first = await writeSafetyFile(handle, documentFixture(), {
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  const before = handle.getText();
  const corruptHistory = await historyFixture();
  corruptHistory.noteRevisions[0].note.content = "Changed without a new hash";

  await assert.rejects(
    () => writeSafetyFile(handle, documentFixture("Two"), {
      history: corruptHistory,
      expectedDigest: first.digest,
      cryptoObject,
    }),
    (error) =>
      error.kind === SAFETY_FILE_FAILURES.VERIFY &&
      /was not changed/u.test(error.message),
  );
  assert.equal(handle.getText(), before);
  assert.equal(
    (await readSafetyFileHandle(handle, { cryptoObject })).value.document.notes[0].content,
    "One",
  );
});

test("coordinator waits for local-save settlement and verifies every backup", async () => {
  const states = [];
  const savedConnections = [];
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection(value) {
        savedConnections.push(value);
      },
      async disconnectSafetyFile() {},
    },
    directSupported: true,
    onStateChange: (state) => states.push(state.kind),
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  const handle = memoryHandle();
  await coordinator.initialize(documentFixture());
  await coordinator.create(handle, documentFixture());

  coordinator.markDirty();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.PENDING);
  assert.equal(JSON.parse(handle.getText()).document.notes[0].content, "One");

  coordinator.localSaveSettled(documentFixture("Two"));
  await coordinator.waitForIdle();
  assert.equal(JSON.parse(handle.getText()).document.notes[0].content, "Two");
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
  assert.ok(savedConnections.length >= 2);
  assert.ok(states.includes(SAFETY_FILE_STATES.WRITING));
});

test("reload verification synchronizes history even when the notebook already matches", async () => {
  let persistedConnection = null;
  let localHistory = emptyHistoryArchive();
  const storageService = {
    async saveSafetyFileConnection(value) {
      persistedConnection = value;
    },
    async disconnectSafetyFile() {},
  };
  const handle = memoryHandle();
  const original = createSafetyFileCoordinator({
    storageService,
    directSupported: true,
    historyProvider: () => localHistory,
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  await original.create(handle, documentFixture());
  assert.equal(JSON.parse(handle.getText()).history.snapshots.length, 0);

  localHistory = await historyFixture();
  const reloaded = createSafetyFileCoordinator({
    storageService,
    initialConnection: persistedConnection,
    directSupported: true,
    historyProvider: () => localHistory,
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  await reloaded.initialize(documentFixture());
  await reloaded.waitForIdle();

  assert.equal(reloaded.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
  assert.equal(JSON.parse(handle.getText()).history.snapshots.length, 1);
});

test("permission loss and external edits pause automatic updates without changing local data", async () => {
  const storageService = {
    async saveSafetyFileConnection() {},
    async disconnectSafetyFile() {},
  };
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService,
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture());

  handle.setPermission("prompt");
  coordinator.markDirty();
  coordinator.localSaveSettled(documentFixture("Local remains safe"));
  await coordinator.waitForIdle();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.NEEDS_PERMISSION);
  assert.equal(JSON.parse(handle.getText()).document.notes[0].content, "One");

  handle.setPermission("granted");
  handle.setText(`${handle.getText()}\n`);
  await coordinator.grant(documentFixture("Local remains safe"));
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.EXTERNAL_CHANGE);
  assert.equal(JSON.parse(handle.getText()).document.notes[0].content, "One");
});

test("disconnect forgets the handle without modifying its bytes", async () => {
  let disconnected = 0;
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection() {},
      async disconnectSafetyFile() {
        disconnected += 1;
      },
    },
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture());
  const before = handle.getText();
  await coordinator.disconnect();

  assert.equal(handle.getText(), before);
  assert.equal(disconnected, 1);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.DISCONNECTED);
});

test("a failed replacement save cannot leave the previous persisted handle active", async () => {
  let persistedConnection = null;
  let failSaves = false;
  const storageService = {
    async saveSafetyFileConnection(value) {
      if (failSaves) {
        throw new Error("metadata unavailable");
      }
      persistedConnection = value;
    },
    async disconnectSafetyFile() {
      persistedConnection = null;
    },
  };
  const oldHandle = memoryHandle();
  const newHandle = memoryHandle();
  newHandle.name = "New.jotkeep";
  const coordinator = createSafetyFileCoordinator({
    storageService,
    directSupported: true,
    cryptoObject,
  });

  await coordinator.create(oldHandle, documentFixture("Old file"));
  assert.equal(persistedConnection.handle, oldHandle);

  failSaves = true;
  await coordinator.create(newHandle, documentFixture("New file"));
  assert.equal(persistedConnection, null);
  assert.equal(coordinator.getConnection().handle, newHandle);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
  assert.equal(coordinator.getState().connectionRemembered, false);

  const reloaded = createSafetyFileCoordinator({
    storageService,
    initialConnection: persistedConnection,
    directSupported: true,
    cryptoObject,
  });
  await reloaded.initialize(documentFixture("New file"));
  assert.equal(reloaded.getConnection(), null);
  assert.equal(reloaded.getState().kind, SAFETY_FILE_STATES.DISCONNECTED);
});

test("failed persisted disconnect retains and suspends the connection until retry", async () => {
  let failDisconnect = true;
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection() {},
      async disconnectSafetyFile() {
        if (failDisconnect) {
          throw new Error("metadata unavailable");
        }
      },
    },
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture("Original"));
  const before = handle.getText();

  assert.equal(await coordinator.disconnect(), false);
  assert.equal(coordinator.getConnection().handle, handle);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.FAILED);

  coordinator.markDirty();
  coordinator.localSaveSettled(documentFixture("Must stay local"));
  await coordinator.waitForIdle();
  assert.equal(handle.getText(), before);

  failDisconnect = false;
  assert.equal(await coordinator.disconnect(), true);
  assert.equal(coordinator.getConnection(), null);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.DISCONNECTED);
});

test("a connection switch is aborted when the previous capability cannot be retired", async () => {
  let persistedConnection = null;
  let failDisconnect = false;
  const storageService = {
    async saveSafetyFileConnection(value) {
      persistedConnection = value;
    },
    async disconnectSafetyFile() {
      if (failDisconnect) {
        throw new Error("metadata unavailable");
      }
      persistedConnection = null;
    },
  };
  const oldHandle = memoryHandle();
  const newHandle = memoryHandle();
  newHandle.name = "Rejected.jotkeep";
  const coordinator = createSafetyFileCoordinator({
    storageService,
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(oldHandle, documentFixture("Original"));

  failDisconnect = true;
  await assert.rejects(
    () => coordinator.create(newHandle, documentFixture("Different")),
    /could not retire the previous Safety File connection/u,
  );
  assert.equal(persistedConnection.handle, oldHandle);
  assert.equal(coordinator.getConnection().handle, oldHandle);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.FAILED);
});

test("a failed close aborts the writable and reports a write failure", async () => {
  const handle = memoryHandle("seed", { failClose: true });

  await assert.rejects(
    () => writeSafetyFile(handle, documentFixture(), { cryptoObject }),
    (error) => error.kind === SAFETY_FILE_FAILURES.WRITE,
  );
  assert.equal(handle.getText(), "seed");
  assert.equal(handle.getAbortCalls(), 1);
});

test("a failed close without an abort method still reports a write failure", async () => {
  const handle = memoryHandle("seed", { failClose: true, omitAbort: true });

  await assert.rejects(
    () => writeSafetyFile(handle, documentFixture(), { cryptoObject }),
    (error) => error.kind === SAFETY_FILE_FAILURES.WRITE,
  );
  assert.equal(handle.getText(), "seed");
});

test("a torn commit is reported as a verification failure", async () => {
  const handle = memoryHandle("", { truncateTo: 20 });

  await assert.rejects(
    () => writeSafetyFile(handle, documentFixture(), { cryptoObject }),
    (error) =>
      error.kind === SAFETY_FILE_FAILURES.VERIFY &&
      /could not verify/u.test(error.message),
  );
  assert.equal(handle.getText().length, 20);
});

test("a stale read-back is reported as a verification failure", async () => {
  const handle = memoryHandle();
  await writeSafetyFile(handle, documentFixture(), {
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });

  handle.setStaleReads(1);
  await assert.rejects(
    () => writeSafetyFile(handle, documentFixture("Two"), { cryptoObject }),
    (error) => error.kind === SAFETY_FILE_FAILURES.VERIFY,
  );
});

test("a torn backup write fails honestly and recovers through explicit overwrite", async () => {
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection() {},
      async disconnectSafetyFile() {},
    },
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture());

  handle.setTruncateTo(20);
  coordinator.markDirty();
  coordinator.localSaveSettled(documentFixture("Two"));
  await coordinator.waitForIdle();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.FAILED);
  assert.equal(coordinator.getState().error.kind, SAFETY_FILE_FAILURES.VERIFY);
  assert.equal(handle.getText().length, 20);

  handle.setTruncateTo(null);
  coordinator.localSaveSettled(documentFixture("Two"));
  await coordinator.waitForIdle();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.EXTERNAL_CHANGE);
  assert.equal(handle.getText().length, 20);

  assert.equal(await coordinator.overwrite(documentFixture("Two")), true);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
  assert.equal(JSON.parse(handle.getText()).document.notes[0].content, "Two");
});

test("a close failure leaves pending work that retries once the file recovers", async () => {
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection() {},
      async disconnectSafetyFile() {},
    },
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture());
  const before = handle.getText();

  handle.setFailClose(true);
  coordinator.markDirty();
  coordinator.localSaveSettled(documentFixture("Two"));
  await coordinator.waitForIdle();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.FAILED);
  assert.equal(coordinator.getState().error.kind, SAFETY_FILE_FAILURES.WRITE);
  assert.equal(handle.getText(), before);

  handle.setFailClose(false);
  coordinator.localSaveSettled(documentFixture("Two"));
  await coordinator.waitForIdle();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
  assert.equal(JSON.parse(handle.getText()).document.notes[0].content, "Two");
});

test("a generated fallback notebook never overwrites a connected Safety File", async () => {
  let persistedConnection = null;
  const storageService = {
    async saveSafetyFileConnection(value) {
      persistedConnection = value;
    },
    async disconnectSafetyFile() {
      persistedConnection = null;
    },
  };
  const handle = memoryHandle();
  const original = createSafetyFileCoordinator({
    storageService,
    directSupported: true,
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  await original.create(handle, documentFixture("Precious notes"));
  const before = handle.getText();

  // Simulate a reload where the notebook records were lost (for example a
  // cross-tab clear raced the connection write) and storage handed the app a
  // freshly generated blank document alongside the remembered connection.
  const generatedDocument = {
    version: 2,
    activeNoteId: "note_fresh",
    notes: [{
      id: "note_fresh",
      title: "",
      content: "",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
  const reloaded = createSafetyFileCoordinator({
    storageService,
    initialConnection: persistedConnection,
    directSupported: true,
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  await reloaded.initialize(generatedDocument, { documentGenerated: true });

  assert.equal(reloaded.getState().kind, SAFETY_FILE_STATES.EXTERNAL_CHANGE);
  assert.equal(handle.getText(), before);

  // Later local saves must stay paused until the user resolves the conflict.
  reloaded.markDirty();
  reloaded.localSaveSettled(generatedDocument);
  await reloaded.waitForIdle();
  assert.equal(reloaded.getState().kind, SAFETY_FILE_STATES.EXTERNAL_CHANGE);
  assert.equal(handle.getText(), before);

  // "Use Safety File" recovery: adopting the file's notebook resumes backups.
  const read = await readSafetyFileHandle(handle, { cryptoObject });
  await reloaded.connectVerified(handle, read, read.value.document);
  assert.equal(reloaded.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
  assert.equal(handle.getText(), before);
  assert.equal(
    JSON.parse(handle.getText()).document.notes[0].content,
    "Precious notes",
  );
});

test("initialize with a generated document that matches the connection stays on the normal path", async () => {
  let persistedConnection = null;
  const storageService = {
    async saveSafetyFileConnection(value) {
      persistedConnection = value;
    },
    async disconnectSafetyFile() {},
  };
  const handle = memoryHandle();
  const original = createSafetyFileCoordinator({
    storageService,
    directSupported: true,
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  await original.create(handle, documentFixture());

  const reloaded = createSafetyFileCoordinator({
    storageService,
    initialConnection: persistedConnection,
    directSupported: true,
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  await reloaded.initialize(documentFixture(), { documentGenerated: true });
  assert.equal(reloaded.getState().kind, SAFETY_FILE_STATES.BACKED_UP);
});

test("an oversized notebook reports a distinct failure, not an external change", async () => {
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection() {},
      async disconnectSafetyFile() {},
    },
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture());
  const before = handle.getText();

  coordinator.markDirty();
  coordinator.localSaveSettled(documentFixture("x".repeat(26 * 1024 * 1024)));
  await coordinator.waitForIdle();

  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.FAILED);
  assert.equal(coordinator.getState().error.kind, SAFETY_FILE_FAILURES.TOO_LARGE);
  assert.equal(handle.getText(), before);
});

test("grant does not claim success when verification finds an external change", async () => {
  const handle = memoryHandle();
  const coordinator = createSafetyFileCoordinator({
    storageService: {
      async saveSafetyFileConnection() {},
      async disconnectSafetyFile() {},
    },
    directSupported: true,
    cryptoObject,
  });
  await coordinator.create(handle, documentFixture());

  handle.setPermission("prompt");
  coordinator.markDirty();
  coordinator.localSaveSettled(documentFixture("Two"));
  await coordinator.waitForIdle();
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.NEEDS_PERMISSION);

  handle.setPermission("granted");
  handle.setText(`${handle.getText()}\n`);
  assert.equal(await coordinator.grant(documentFixture("Two")), false);
  assert.equal(coordinator.getState().kind, SAFETY_FILE_STATES.EXTERNAL_CHANGE);
});

test("written Safety Files embed a checksum and corrupted notes are rejected", async () => {
  const handle = memoryHandle();
  const read = await writeSafetyFile(handle, documentFixture(), {
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  assert.match(JSON.parse(handle.getText()).checksum, /^[0-9a-f]{64}$/u);
  assert.equal(read.value.document.notes[0].content, "One");

  const corrupted = JSON.parse(handle.getText());
  corrupted.document.notes[0].content = "Silently flipped";
  handle.setText(`${JSON.stringify(corrupted, null, 2)}\n`);

  await assert.rejects(
    () => readSafetyFileHandle(handle, { cryptoObject }),
    (error) => /checksum/u.test(error.message),
  );
});

test("version 2 requires a checksum while checksum-less version 1 remains readable", async () => {
  const handle = memoryHandle();
  await writeSafetyFile(handle, documentFixture(), {
    now: () => new Date(CREATED_AT),
    cryptoObject,
  });
  const versionTwo = JSON.parse(handle.getText());
  delete versionTwo.checksum;
  handle.setText(`${JSON.stringify(versionTwo, null, 2)}\n`);
  await assert.rejects(
    () => readSafetyFileHandle(handle, { cryptoObject }),
    (error) => /missing its required checksum/u.test(error.message),
  );

  handle.setText(`${JSON.stringify({
    format: SAFETY_FILE_FORMAT,
    version: LEGACY_SAFETY_FILE_VERSION,
    fileId: "legacy-file",
    revisionId: "legacy-revision",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    document: documentFixture(),
  }, null, 2)}\n`);
  const legacy = await readSafetyFileHandle(handle, { cryptoObject });
  assert.equal(legacy.value.version, LEGACY_SAFETY_FILE_VERSION);
  assert.equal(legacy.value.document.notes[0].content, "One");
});
