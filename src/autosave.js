export const SAVE_STATES = Object.freeze({
  SAVING: "Saving…",
  SAVED: "Saved",
  CLEARED: "Local data cleared",
  QUOTA: "Storage full",
  MIGRATION: "Migration failed",
  CONFLICT: "Changed in another tab",
  UNAVAILABLE: "Storage unavailable",
});

export function createAutosave({
  save,
  onStateChange,
  onSaved = () => {},
  onError = () => {},
  errorState = () => SAVE_STATES.UNAVAILABLE,
  delay = 500,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}) {
  let timer;
  let revision = 0;
  let savedRevision = 0;
  let flushPromise = null;
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

  async function flush() {
    cancelScheduledSave();

    if (revision === savedRevision) {
      return true;
    }

    if (flushPromise !== null) {
      return flushPromise;
    }

    flushPromise = (async () => {
      while (revision !== savedRevision) {
        const savingRevision = revision;
        try {
          await save();
          savedRevision = savingRevision;
        } catch (error) {
          onError(error);
          setState(errorState(error));
          return false;
        }
      }

      setState(SAVE_STATES.SAVED);
      onSaved();
      return true;
    })();

    try {
      return await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  function markDirty() {
    revision += 1;
    setState(SAVE_STATES.SAVING);
    cancelScheduledSave();
    timer = schedule(() => flush(), delay);
  }

  function reset(state = SAVE_STATES.SAVED) {
    cancelScheduledSave();
    revision = 0;
    savedRevision = 0;
    setState(state);
  }

  return {
    flush,
    markDirty,
    reset,
    setState,
    isDirty: () => revision !== savedRevision,
  };
}
