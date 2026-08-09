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

function memoryHandle(initialText = "") {
  let text = initialText;
  let permission = "granted";
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
      const bytes = new TextEncoder().encode(text);
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
      return {
        async write(value) {
          pending = String(value);
        },
        async close() {
          text = pending;
        },
        async abort() {},
      };
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
