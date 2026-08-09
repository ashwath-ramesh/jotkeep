import test from "node:test";
import assert from "node:assert/strict";

import { createAutosave, SAVE_STATES } from "../src/autosave.js";

function createScheduler() {
  let nextId = 1;
  const tasks = new Map();

  return {
    schedule(callback) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, callback);
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    async runAll() {
      const pending = [...tasks.values()];
      tasks.clear();
      await Promise.all(pending.map((callback) => callback()));
    },
    size() {
      return tasks.size;
    },
  };
}

test("autosave coalesces edits and saves after the debounce", async () => {
  const scheduler = createScheduler();
  const states = [];
  let saves = 0;
  const autosave = createAutosave({
    save: () => {
      saves += 1;
    },
    onStateChange: (state) => states.push(state),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  autosave.markDirty();
  autosave.markDirty();

  assert.equal(scheduler.size(), 1);
  assert.equal(saves, 0);
  assert.deepEqual(states, [SAVE_STATES.SAVING]);

  await scheduler.runAll();

  assert.equal(saves, 1);
  assert.equal(autosave.isDirty(), false);
  assert.deepEqual(states, [SAVE_STATES.SAVING, SAVE_STATES.SAVED]);
});

test("autosave announces one settled snapshot after coalesced local saves", async () => {
  const scheduler = createScheduler();
  let settled = 0;
  const autosave = createAutosave({
    save: () => {},
    onStateChange: () => {},
    onSaved: () => {
      settled += 1;
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  autosave.markDirty();
  autosave.markDirty();
  await scheduler.runAll();
  assert.equal(settled, 1);

  autosave.markDirty();
  await scheduler.runAll();
  assert.equal(settled, 2);
});

test("autosave stays dirty after failure and retries after another edit", async () => {
  const scheduler = createScheduler();
  const states = [];
  let shouldFail = true;
  const autosave = createAutosave({
    save: () => {
      if (shouldFail) {
        throw new Error("storage full");
      }
    },
    onStateChange: (state) => states.push(state),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  autosave.markDirty();
  await scheduler.runAll();

  assert.equal(autosave.isDirty(), true);
  assert.equal(states.at(-1), SAVE_STATES.UNAVAILABLE);

  shouldFail = false;
  autosave.markDirty();
  await scheduler.runAll();

  assert.equal(autosave.isDirty(), false);
  assert.equal(states.at(-1), SAVE_STATES.SAVED);
});

test("flush cancels a pending timer and awaits the save", async () => {
  const scheduler = createScheduler();
  let saves = 0;
  const autosave = createAutosave({
    save: () => {
      saves += 1;
    },
    onStateChange: () => {},
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  autosave.markDirty();

  assert.equal(await autosave.flush(), true);
  assert.equal(scheduler.size(), 0);
  assert.equal(saves, 1);

  await scheduler.runAll();
  assert.equal(saves, 1);
});

test("reset cancels pending work, clears dirty state, and sets the requested state", async () => {
  const scheduler = createScheduler();
  const states = [];
  let saves = 0;
  const autosave = createAutosave({
    save: () => {
      saves += 1;
    },
    onStateChange: (state) => states.push(state),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  autosave.markDirty();
  autosave.reset(SAVE_STATES.CLEARED);
  await scheduler.runAll();

  assert.equal(saves, 0);
  assert.equal(autosave.isDirty(), false);
  assert.deepEqual(states, [SAVE_STATES.SAVING, SAVE_STATES.CLEARED]);
});

test("an edit during an in-flight save is included in a serialized follow-up", async () => {
  let releaseFirst;
  const firstSave = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const states = [];
  let saves = 0;
  const autosave = createAutosave({
    save: async () => {
      saves += 1;
      if (saves === 1) {
        await firstSave;
      }
    },
    onStateChange: (state) => states.push(state),
  });

  autosave.markDirty();
  const flushing = autosave.flush();
  autosave.markDirty();
  releaseFirst();

  assert.equal(await flushing, true);
  assert.equal(saves, 2);
  assert.equal(autosave.isDirty(), false);
  assert.equal(states.at(-1), SAVE_STATES.SAVED);
});

test("async failures retain dirty state and use the classified error state", async () => {
  const errors = [];
  const states = [];
  let settled = 0;
  const failure = { kind: "quota" };
  const autosave = createAutosave({
    save: async () => {
      throw failure;
    },
    onStateChange: (state) => states.push(state),
    onError: (error) => errors.push(error),
    onSaved: () => {
      settled += 1;
    },
    errorState: () => SAVE_STATES.QUOTA,
  });

  autosave.markDirty();

  assert.equal(await autosave.flush(), false);
  assert.equal(autosave.isDirty(), true);
  assert.deepEqual(errors, [failure]);
  assert.equal(settled, 0);
  assert.equal(states.at(-1), SAVE_STATES.QUOTA);
});
