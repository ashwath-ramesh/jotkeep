import { test, expect } from "@playwright/test";

const STORAGE_KEY = "minimal-notepad.document.v2";
const VERSION_ONE_STORAGE_KEY = "minimal-notepad.document.v1";
const BODY_STORAGE_KEY = "minimal-notepad.note.v1";
const BACKUP_STORAGE_KEY = "minimal-notepad.last-backup.v1";
const CREATED_AT = "2026-08-09T12:00:00.000Z";
const browserErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

function documentFixture() {
  return {
    version: 2,
    activeNoteId: "note_second",
    notes: [
      {
        id: "note_first",
        title: "First",
        content: "One",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "note_second",
        title: "Second",
        content: "Two",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    preferences: { sortBy: "title", listView: "compact" },
  };
}

async function readStorage(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("jotkeep");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["notes", "metadata"], "readonly");
    const notesRequest = transaction.objectStore("notes").getAll();
    const metadataRequest = transaction.objectStore("metadata").get("notebook");
    const backupRequest = transaction.objectStore("metadata").get("lastBackup");
    const result = await Promise.all(
      [notesRequest, metadataRequest, backupRequest].map(
        (request) =>
          new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    database.close();
    return { notes: result[0], metadata: result[1], backup: result[2] };
  });
}

test("migrates the version-2 document into individual verified records", async ({
  page,
}) => {
  const source = documentFixture();
  const backupMetadata = { version: 1, createdAt: CREATED_AT };
  await page.addInitScript(
    ({ key, value, versionOneKey, bodyKey, backupKey, backup }) => {
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem(
        versionOneKey,
        JSON.stringify({ version: 1, title: "Stale", body: "Private stale copy" }),
      );
      localStorage.setItem(bodyKey, "Older private stale copy");
      localStorage.setItem(backupKey, JSON.stringify(backup));
    },
    {
      key: STORAGE_KEY,
      value: source,
      versionOneKey: VERSION_ONE_STORAGE_KEY,
      bodyKey: BODY_STORAGE_KEY,
      backupKey: BACKUP_STORAGE_KEY,
      backup: backupMetadata,
    },
  );

  await page.goto("/");

  await expect(page.locator("#note-title")).toHaveValue("Second");
  await expect(page.locator("#note-sort")).toHaveValue("title");
  await expect(page.locator("#note-list-view")).toHaveValue("compact");
  const stored = await readStorage(page);
  expect(stored.notes).toEqual(expect.arrayContaining(source.notes));
  expect(stored.notes).toHaveLength(2);
  expect(stored.metadata.activeNoteId).toBe("note_second");
  expect(stored.metadata.noteIds).toEqual(["note_first", "note_second"]);
  expect(stored.metadata.preferences).toEqual(source.preferences);
  expect(stored.backup).toEqual({ key: "lastBackup", ...backupMetadata });
  await expect(page.locator("#backup-status")).toContainText(
    "No recoverable external backup verified",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BACKUP_STORAGE_KEY),
  ).toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), VERSION_ONE_STORAGE_KEY),
  ).toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BODY_STORAGE_KEY),
  ).toBeNull();

  await page.reload();
  await expect(page.locator("#note-title")).toHaveValue("Second");
  await expect(page.locator("#notes-list > li")).toHaveCount(2);
});

test("editing one note puts only that individual note record", async ({ page }) => {
  await page.addInitScript(() => {
    window.__jotKeepPuts = [];
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, key) {
      window.__jotKeepPuts.push({ store: this.name, id: value?.id ?? key ?? value?.key });
      return originalPut.call(this, value, key);
    };
  });
  await page.goto("/");
  await page.locator("#note-title").fill("First");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  await page.getByRole("button", { name: "New note" }).click();
  await page.locator("#note-title").fill("Second");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  const activeId = (await readStorage(page)).metadata.activeNoteId;
  await page.evaluate(() => {
    window.__jotKeepPuts = [];
  });
  await page.locator("#note").fill("Only this record changes");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  const puts = await page.evaluate(() => window.__jotKeepPuts);
  expect(puts).toEqual([{ store: "notes", id: activeId }]);
});

test("creating a note changes notes and notebook metadata in one transaction", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__jotKeepTransactions = [];
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function transaction(stores, mode, options) {
      window.__jotKeepTransactions.push({ stores: [...stores], mode });
      return originalTransaction.call(this, stores, mode, options);
    };
  });
  await page.goto("/");
  await page.evaluate(() => {
    window.__jotKeepTransactions = [];
  });

  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  const writes = (await page.evaluate(() => window.__jotKeepTransactions)).filter(
    (transaction) => transaction.mode === "readwrite",
  );
  expect(writes).toEqual([{ stores: ["notes", "metadata"], mode: "readwrite" }]);
});

test("rejects a stale cross-tab save without corrupting note metadata", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.locator("#note-title").fill("Original");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  const stalePage = await context.newPage();
  await stalePage.goto("/");
  await expect(stalePage.locator("#note-title")).toHaveValue("Original");

  await page.getByRole("button", { name: "New note" }).click();
  await page.locator("#note-title").fill("Added elsewhere");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  await stalePage.locator("#note-list-view").selectOption("compact");
  await expect(stalePage.locator("#save-state")).toHaveText(
    "Local: Changed in another tab",
  );
  await expect(stalePage.locator("#storage-status")).toContainText(
    "changed in another tab",
  );

  await page.reload();
  await expect(page.locator("#notes-list > li")).toHaveCount(2);
  await expect(page.locator("#note-title")).toHaveValue("Added elsewhere");
  await stalePage.close();
});

test("reports failed legacy cleanup and retries it on the next load", async ({
  page,
}) => {
  const source = documentFixture();
  await page.addInitScript(
    ({ key, value, versionOneKey, bodyKey }) => {
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem(versionOneKey, "stale version one");
      localStorage.setItem(bodyKey, "stale body");
      if (sessionStorage.getItem("allowLegacyCleanup") !== "yes") {
        Storage.prototype.removeItem = function removeItem() {
          throw new DOMException("Blocked", "SecurityError");
        };
      }
    },
    {
      key: STORAGE_KEY,
      value: source,
      versionOneKey: VERSION_ONE_STORAGE_KEY,
      bodyKey: BODY_STORAGE_KEY,
    },
  );

  await page.goto("/");
  await expect(page.locator("#save-state")).toHaveText("Local: Migration failed");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).not.toBeNull();

  await page.evaluate(() => sessionStorage.setItem("allowLegacyCleanup", "yes"));
  await page.reload();

  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  const remaining = await page.evaluate((keys) =>
    keys.map((key) => localStorage.getItem(key)), [
      STORAGE_KEY,
      VERSION_ONE_STORAGE_KEY,
      BODY_STORAGE_KEY,
      BACKUP_STORAGE_KEY,
    ]);
  expect(remaining).toEqual([null, null, null, null]);
});

test("preserves backup status when the blank notebook has never been saved", async ({
  page,
}) => {
  await page.goto("/");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export JSON backup…" }).click();
  await downloadPromise;
  await expect(page.locator("#backup-status")).toContainText(
    "No recoverable external backup verified",
  );

  const stored = await readStorage(page);
  expect(stored.metadata).toBeUndefined();
  expect(stored.backup?.createdAt).toBeTruthy();

  await page.reload();
  await expect(page.locator("#backup-status")).toContainText(
    "No recoverable external backup verified",
  );
});

test("a failed migration keeps the source and does not block editing", async ({
  page,
}) => {
  const source = documentFixture();
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      window.__jotKeepOriginalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function put() {
        throw new DOMException("Storage full", "QuotaExceededError");
      };
    },
    { key: STORAGE_KEY, value: source },
  );

  await page.goto("/");

  await expect(page.locator("#note-title")).toHaveValue("Second");
  await expect(page.locator("#save-state")).toHaveText("Local: Migration failed");
  await expect(page.locator("#storage-status")).toContainText("original local data was kept");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).not.toBeNull();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__jotKeepOriginalPut;
  });
  await page.locator("#note").fill("Editing remains available");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  await expect(page.locator("#note")).toHaveValue("Editing remains available");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await page.reload();
  await expect(page.locator("#note")).toHaveValue("Editing remains available");
});

test("reports quota failures without disabling the editor", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function put() {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
  });

  await page.locator("#note").fill("Unsaved but still editable");

  await expect(page.locator("#save-state")).toHaveText("Local: Storage full");
  await expect(page.locator("#storage-status")).toContainText("storage is full");
  await expect(page.locator("#note")).toBeEditable();
  await expect(page.locator("#note")).toHaveValue("Unsaved but still editable");
});

test("reports unavailable IndexedDB without blocking editing", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open() {
          throw new DOMException("Blocked", "SecurityError");
        },
      },
    });
  });
  await page.goto("/");

  await expect(page.locator("#save-state")).toHaveText("Local: Storage unavailable");
  await expect(page.locator("#storage-status")).toContainText("storage is unavailable");
  await page.locator("#note").fill("Session-only editing");
  await expect(page.locator("#note")).toHaveValue("Session-only editing");
  await expect(page.locator("#note")).toBeEditable();
});

test("reports a denied persistent-storage request without affecting saves", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, "persisted", {
      configurable: true,
      value: async () => false,
    });
    Object.defineProperty(StorageManager.prototype, "persist", {
      configurable: true,
      value: async () => false,
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Keep data on this device" }).click();

  await expect(page.locator("#storage-status")).toContainText("not granted");
  await page.locator("#note").fill("Still saved");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
});

test("divergent legacy localStorage data is preserved, not deleted", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Note body" }).fill("IndexedDB copy");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  // An older still-open tab could write a different localStorage notebook
  // after this browser migrated to IndexedDB. It must never be erased just
  // because an IndexedDB notebook exists.
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, JSON.stringify(value)),
    [STORAGE_KEY, documentFixture()],
  );

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue(
    "IndexedDB copy",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).not.toBeNull();
});

test("matching legacy localStorage data is still cleaned up after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Note body" }).fill("Synced copy");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  const stored = await readStorage(page);
  expect(stored.notes.length).toBeGreaterThan(0);

  // Seed legacy data that matches IndexedDB exactly: cleanup should proceed.
  await page.evaluate(
    ([key, notes, metadata]) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          activeNoteId: metadata.activeNoteId,
          notes,
          preferences: metadata.preferences,
        }),
      );
    },
    [STORAGE_KEY, stored.notes, stored.metadata],
  );

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note body" })).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBeNull();
});
