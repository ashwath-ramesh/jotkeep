import {
  MAX_SAFETY_FILE_BYTES,
  SafetyFileValidationError,
  createSafetyFile,
  decodeSafetyFile,
  fingerprintText,
  parseSafetyFile,
  serializeSafetyFile,
} from "./safety-file-format.js";

export const SAFETY_FILE_STATES = Object.freeze({
  DISCONNECTED: "disconnected",
  MANUAL_ONLY: "manual-only",
  PENDING: "pending",
  WRITING: "writing",
  BACKED_UP: "backed-up",
  NEEDS_PERMISSION: "needs-permission",
  UNAVAILABLE: "unavailable",
  EXTERNAL_CHANGE: "external-change",
  FAILED: "failed",
});

export const SAFETY_FILE_FAILURES = Object.freeze({
  PERMISSION: "permission",
  UNAVAILABLE: "unavailable",
  EXTERNAL_CHANGE: "external-change",
  INVALID: "invalid",
  WRITE: "write",
  VERIFY: "verify",
});

export class SafetyFileFailure extends Error {
  constructor(kind, message, options = {}) {
    super(message, options);
    this.name = "SafetyFileFailure";
    this.kind = kind;
  }
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function classifyFileError(error, fallback = SAFETY_FILE_FAILURES.UNAVAILABLE) {
  if (error instanceof SafetyFileFailure) {
    return error;
  }
  if (error instanceof SafetyFileValidationError) {
    return new SafetyFileFailure(SAFETY_FILE_FAILURES.INVALID, error.message, {
      cause: error,
    });
  }
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return new SafetyFileFailure(
      SAFETY_FILE_FAILURES.PERMISSION,
      "PlainJot no longer has permission to access this Safety File.",
      { cause: error },
    );
  }
  if (error?.name === "NotFoundError") {
    return new SafetyFileFailure(
      SAFETY_FILE_FAILURES.UNAVAILABLE,
      "The connected Safety File was moved, renamed, or deleted.",
      { cause: error },
    );
  }
  return new SafetyFileFailure(fallback, "The Safety File is unavailable.", {
    cause: error,
  });
}

export function supportsDirectSafetyFiles(windowObject = globalThis.window) {
  return Boolean(
    windowObject?.isSecureContext &&
    typeof windowObject.showOpenFilePicker === "function" &&
    typeof windowObject.showSaveFilePicker === "function" &&
    typeof windowObject.FileSystemFileHandle?.prototype?.createWritable === "function",
  );
}

export async function readSafetyFile(file, { cryptoObject = globalThis.crypto } = {}) {
  if (file.size > MAX_SAFETY_FILE_BYTES) {
    throw new SafetyFileValidationError("The selected Safety File is larger than 25 MiB.");
  }
  const bytes = await file.arrayBuffer();
  const text = decodeSafetyFile(bytes);
  const value = parseSafetyFile(text, { byteLength: file.size });
  return {
    value,
    text,
    digest: await fingerprintText(text, { cryptoObject }),
    lastModified: file.lastModified,
  };
}

export async function readSafetyFileHandle(
  handle,
  { cryptoObject = globalThis.crypto } = {},
) {
  try {
    const file = await handle.getFile();
    return { ...(await readSafetyFile(file, { cryptoObject })), fileName: file.name };
  } catch (error) {
    throw classifyFileError(error);
  }
}

async function notebookDigest(document, cryptoObject) {
  return fingerprintText(JSON.stringify(document), { cryptoObject });
}

function connectionFromRead(handle, read, documentHash, verifiedAt) {
  return {
    version: 1,
    handle,
    fileName: read.fileName ?? handle.name,
    fileId: read.value.fileId,
    revisionId: read.value.revisionId,
    fileDigest: read.digest,
    notebookDigest: documentHash,
    fileCreatedAt: read.value.createdAt,
    fileUpdatedAt: read.value.updatedAt,
    verifiedAt,
  };
}

export async function writeSafetyFile(
  handle,
  document,
  {
    previous = null,
    expectedDigest = null,
    force = false,
    now = () => new Date(),
    idFactory,
    cryptoObject = globalThis.crypto,
  } = {},
) {
  try {
    if (!force && expectedDigest !== null) {
      const current = await readSafetyFileHandle(handle, { cryptoObject });
      if (current.digest !== expectedDigest) {
        throw new SafetyFileFailure(
          SAFETY_FILE_FAILURES.EXTERNAL_CHANGE,
          "The Safety File changed outside PlainJot. Automatic updates were paused.",
        );
      }
      previous = current.value;
    }

    const value = createSafetyFile(document, { previous, now, idFactory });
    const text = serializeSafetyFile(value);
    const expectedWrittenDigest = await fingerprintText(text, { cryptoObject });
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort?.();
      } catch {
        // The stream may already be closed or aborted.
      }
      throw error;
    }

    const verified = await readSafetyFileHandle(handle, { cryptoObject });
    if (
      verified.digest !== expectedWrittenDigest ||
      JSON.stringify(verified.value) !== JSON.stringify(value)
    ) {
      throw new SafetyFileFailure(
        SAFETY_FILE_FAILURES.VERIFY,
        "PlainJot wrote the Safety File, but could not verify the saved contents.",
      );
    }
    return verified;
  } catch (error) {
    throw classifyFileError(error, SAFETY_FILE_FAILURES.WRITE);
  }
}

export function createSafetyFileCoordinator({
  storageService,
  initialConnection = null,
  directSupported = supportsDirectSafetyFiles(),
  onStateChange = () => {},
  now = () => new Date(),
  cryptoObject = globalThis.crypto,
} = {}) {
  let connection = initialConnection;
  let currentState;
  let changeRevision = 0;
  let backedRevision = 0;
  let pending = null;
  let syncPromise = null;
  let generation = 0;
  let suspended = false;
  let suspendedDocument = null;

  function setState(kind, details = {}) {
    currentState = {
      kind,
      fileName: connection?.fileName ?? null,
      ...details,
    };
    onStateChange(currentState);
  }

  async function permission({ request = false } = {}) {
    if (!connection) {
      return "denied";
    }
    const method = request ? "requestPermission" : "queryPermission";
    if (typeof connection.handle?.[method] !== "function") {
      return "granted";
    }
    try {
      return await connection.handle[method]({ mode: "readwrite" });
    } catch (error) {
      throw classifyFileError(error);
    }
  }

  function persistenceFailure(message, error) {
    return new SafetyFileFailure(SAFETY_FILE_FAILURES.WRITE, message, {
      cause: error,
    });
  }

  async function suspend() {
    suspended = true;
    suspendedDocument = null;
    generation += 1;
    pending = null;
    if (syncPromise) {
      await syncPromise;
    }
  }

  function resume(document = suspendedDocument) {
    suspended = false;
    suspendedDocument = null;
    if (!connection || !document) {
      return;
    }
    pending = {
      revision: changeRevision,
      document: structuredClone(document),
    };
    setState(SAFETY_FILE_STATES.PENDING);
    void synchronizePending();
  }

  async function prepareConnectionSwitch(nextFileId) {
    if (!connection || connection.fileId === nextFileId) {
      return true;
    }

    await suspend();
    try {
      await storageService.disconnectSafetyFile();
    } catch (error) {
      const failure = persistenceFailure(
        "PlainJot could not retire the previous Safety File connection. No new file was connected.",
        error,
      );
      setState(SAFETY_FILE_STATES.FAILED, { error: failure });
      throw failure;
    }

    connection = null;
    suspended = false;
    setState(
      directSupported
        ? SAFETY_FILE_STATES.DISCONNECTED
        : SAFETY_FILE_STATES.MANUAL_ONLY,
    );
    return true;
  }

  async function remember(nextConnection) {
    await prepareConnectionSwitch(nextConnection.fileId);
    try {
      await storageService.saveSafetyFileConnection(nextConnection);
      connection = nextConnection;
      return true;
    } catch {
      // A different previous handle was removed by prepareConnectionSwitch.
      // Keeping the verified new handle only in memory is safe for this tab.
      connection = nextConnection;
      return false;
    }
  }

  function errorState(error) {
    switch (error.kind) {
      case SAFETY_FILE_FAILURES.PERMISSION:
        return SAFETY_FILE_STATES.NEEDS_PERMISSION;
      case SAFETY_FILE_FAILURES.EXTERNAL_CHANGE:
      case SAFETY_FILE_FAILURES.INVALID:
        return SAFETY_FILE_STATES.EXTERNAL_CHANGE;
      case SAFETY_FILE_FAILURES.UNAVAILABLE:
        return SAFETY_FILE_STATES.UNAVAILABLE;
      default:
        return SAFETY_FILE_STATES.FAILED;
    }
  }

  async function verify(document, { synchronize = false } = {}) {
    if (!connection) {
      setState(
        directSupported
          ? SAFETY_FILE_STATES.DISCONNECTED
          : SAFETY_FILE_STATES.MANUAL_ONLY,
      );
      return null;
    }
    try {
      if ((await permission()) !== "granted") {
        setState(SAFETY_FILE_STATES.NEEDS_PERMISSION);
        return null;
      }
      const read = await readSafetyFileHandle(connection.handle, { cryptoObject });
      if (read.digest !== connection.fileDigest) {
        throw new SafetyFileFailure(
          SAFETY_FILE_FAILURES.EXTERNAL_CHANGE,
          "The Safety File changed outside PlainJot. Automatic updates were paused.",
        );
      }
      const documentHash = await notebookDigest(document, cryptoObject);
      const remembered = await remember(
        connectionFromRead(connection.handle, read, await notebookDigest(read.value.document, cryptoObject), nowIso(now)),
      );
      if (documentHash === connection.notebookDigest) {
        backedRevision = changeRevision;
        setState(SAFETY_FILE_STATES.BACKED_UP, {
          verifiedAt: connection.verifiedAt,
          connectionRemembered: remembered,
        });
      } else {
        if (changeRevision === backedRevision) {
          changeRevision += 1;
        }
        pending = { revision: changeRevision, document: structuredClone(document) };
        setState(SAFETY_FILE_STATES.PENDING);
        if (synchronize) {
          void synchronizePending();
        }
      }
      return read;
    } catch (rawError) {
      const error = classifyFileError(rawError);
      setState(errorState(error), { error });
      return null;
    }
  }

  async function initialize(document) {
    if (!directSupported) {
      connection = null;
      setState(SAFETY_FILE_STATES.MANUAL_ONLY);
      return;
    }
    if (!connection) {
      setState(SAFETY_FILE_STATES.DISCONNECTED);
      return;
    }
    await verify(document, { synchronize: true });
  }

  function markDirty() {
    changeRevision += 1;
    if (connection && !suspended) {
      setState(SAFETY_FILE_STATES.PENDING);
    }
  }

  async function synchronizePending() {
    if (!connection || !pending || syncPromise || suspended) {
      return syncPromise;
    }
    const startedGeneration = generation;
    syncPromise = (async () => {
      while (connection && pending && startedGeneration === generation) {
        const target = pending;
        pending = null;
        setState(SAFETY_FILE_STATES.WRITING);
        try {
          if ((await permission()) !== "granted") {
            pending = target;
            setState(SAFETY_FILE_STATES.NEEDS_PERMISSION);
            return false;
          }
          const read = await writeSafetyFile(connection.handle, target.document, {
            expectedDigest: connection.fileDigest,
            now,
            cryptoObject,
          });
          const hash = await notebookDigest(target.document, cryptoObject);
          const remembered = await remember(
            connectionFromRead(connection.handle, read, hash, nowIso(now)),
          );
          backedRevision = target.revision;
          if (pending === null && changeRevision === backedRevision) {
            setState(SAFETY_FILE_STATES.BACKED_UP, {
              verifiedAt: connection.verifiedAt,
              connectionRemembered: remembered,
            });
          } else {
            setState(SAFETY_FILE_STATES.PENDING);
          }
        } catch (rawError) {
          const error = classifyFileError(rawError);
          pending = target;
          setState(errorState(error), { error });
          return false;
        }
      }
      return true;
    })();
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  function localSaveSettled(document) {
    if (!connection) {
      return;
    }
    if (suspended) {
      suspendedDocument = structuredClone(document);
      return;
    }
    pending = { revision: changeRevision, document: structuredClone(document) };
    void synchronizePending();
  }

  async function connectVerified(handle, read, document) {
    if (syncPromise) {
      await syncPromise;
    }
    generation += 1;
    pending = null;
    suspended = false;
    suspendedDocument = null;
    const hash = await notebookDigest(document, cryptoObject);
    const remembered = await remember(
      connectionFromRead(handle, read, hash, nowIso(now)),
    );
    backedRevision = changeRevision;
    setState(SAFETY_FILE_STATES.BACKED_UP, {
      verifiedAt: connection.verifiedAt,
      connectionRemembered: remembered,
    });
  }

  async function create(handle, document) {
    const read = await writeSafetyFile(handle, document, { now, cryptoObject });
    await connectVerified(handle, read, document);
    return read;
  }

  async function grant(document) {
    try {
      if ((await permission({ request: true })) !== "granted") {
        setState(SAFETY_FILE_STATES.NEEDS_PERMISSION);
        return false;
      }
      await verify(document, { synchronize: true });
      return currentState.kind !== SAFETY_FILE_STATES.NEEDS_PERMISSION;
    } catch (rawError) {
      const error = classifyFileError(rawError);
      setState(errorState(error), { error });
      return false;
    }
  }

  async function overwrite(document) {
    if (!connection) {
      return false;
    }
    try {
      let previous = null;
      try {
        previous = (await readSafetyFileHandle(connection.handle, { cryptoObject })).value;
      } catch {
        // Explicit conflict resolution may replace an invalid external file.
      }
      const read = await writeSafetyFile(connection.handle, document, {
        previous,
        force: true,
        now,
        cryptoObject,
      });
      await connectVerified(connection.handle, read, document);
      return true;
    } catch (rawError) {
      const error = classifyFileError(rawError);
      setState(errorState(error), { error });
      return false;
    }
  }

  async function disconnect({ persist = true } = {}) {
    await suspend();
    if (persist) {
      try {
        await storageService.disconnectSafetyFile();
      } catch (error) {
        const failure = persistenceFailure(
          "PlainJot could not forget the Safety File connection. Automatic updates remain paused; try disconnecting again.",
          error,
        );
        setState(SAFETY_FILE_STATES.FAILED, { error: failure });
        return false;
      }
    }
    connection = null;
    suspended = false;
    suspendedDocument = null;
    setState(
      directSupported
        ? SAFETY_FILE_STATES.DISCONNECTED
        : SAFETY_FILE_STATES.MANUAL_ONLY,
    );
    return true;
  }

  return {
    initialize,
    markDirty,
    localSaveSettled,
    verify,
    grant,
    create,
    connectVerified,
    overwrite,
    prepareConnectionSwitch,
    suspend,
    resume,
    disconnect,
    waitForIdle: async () => syncPromise,
    getConnection: () => connection,
    getState: () => currentState,
    isDirectSupported: () => directSupported,
  };
}
