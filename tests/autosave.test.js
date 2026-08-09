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
    runAll() {
      const pending = [...tasks.values()];
      tasks.clear();
      pending.forEach((callback) => callback());
    },
    size() {
      return tasks.size;
    },
  };
}

test("autosave coalesces edits and saves after the debounce", () => {
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

  scheduler.runAll();

  assert.equal(saves, 1);
  assert.equal(autosave.isDirty(), false);
  assert.deepEqual(states, [SAVE_STATES.SAVING, SAVE_STATES.SAVED]);
});

test("autosave stays dirty after failure and retries after another edit", () => {
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
  scheduler.runAll();

  assert.equal(autosave.isDirty(), true);
  assert.equal(states.at(-1), SAVE_STATES.UNAVAILABLE);

  shouldFail = false;
  autosave.markDirty();
  scheduler.runAll();

  assert.equal(autosave.isDirty(), false);
  assert.equal(states.at(-1), SAVE_STATES.SAVED);
});

test("flush cancels a pending timer and saves synchronously", () => {
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

  assert.equal(autosave.flush(), true);
  assert.equal(scheduler.size(), 0);
  assert.equal(saves, 1);

  scheduler.runAll();
  assert.equal(saves, 1);
});
