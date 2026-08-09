export const SAVE_STATES = Object.freeze({
  SAVING: "Saving…",
  SAVED: "Saved",
  UNAVAILABLE: "Storage unavailable",
});

export function createAutosave({
  save,
  onStateChange,
  delay = 500,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}) {
  let timer;
  let dirty = false;
  let currentState;

  function setState(nextState) {
    if (nextState === currentState) {
      return;
    }

    currentState = nextState;
    onStateChange(nextState);
  }

  function cancelScheduledSave() {
    if (timer === undefined) {
      return;
    }

    cancel(timer);
    timer = undefined;
  }

  function flush() {
    cancelScheduledSave();

    if (!dirty) {
      return true;
    }

    try {
      save();
      dirty = false;
      setState(SAVE_STATES.SAVED);
      return true;
    } catch {
      setState(SAVE_STATES.UNAVAILABLE);
      return false;
    }
  }

  function markDirty() {
    dirty = true;
    setState(SAVE_STATES.SAVING);
    cancelScheduledSave();
    timer = schedule(flush, delay);
  }

  return {
    flush,
    markDirty,
    setState,
    isDirty: () => dirty,
  };
}
