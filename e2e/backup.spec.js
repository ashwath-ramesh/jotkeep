import { test, expect } from "@playwright/test";

const browserErrors = new WeakMap();

async function openFileAction(page, name) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  return page.getByRole("menuitem", { name });
}

async function downloadBytes(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function delayFileRead(page, filename) {
  await page.evaluate((delayedFilename) => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    window.releaseDelayedFileRead = release;
    File.prototype.arrayBuffer = async function arrayBuffer() {
      if (this.name === delayedFilename) {
        await gate;
      }
      return originalArrayBuffer.call(this);
    };
  }, filename);
}

async function releaseFileRead(page) {
  await page.evaluate(() => window.releaseDelayedFileRead());
}

async function readIndexedDbDocument(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("jotkeep", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["notes", "metadata"], "readonly");
    const notesRequest = transaction.objectStore("notes").getAll();
    const metadataRequest = transaction.objectStore("metadata").get("notebook");
    const [notes, metadata] = await Promise.all(
      [notesRequest, metadataRequest].map(
        (request) =>
          new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    database.close();
    const notesById = new Map(notes.map((note) => [note.id, note]));
    return {
      version: 2,
      activeNoteId: metadata.activeNoteId,
      notes: metadata.noteIds.map((id) => notesById.get(id)),
      preferences: metadata.preferences,
    };
  });
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test("imports UTF-8 text and downloads the active body with a safe filename", async ({
  page,
}) => {
  const chooserPromise = page.waitForEvent("filechooser");
  await (await openFileAction(page, "Open text file…")).click();
  const chooser = await chooserPromise;
  await chooser.setFiles([]);
  await expect(page.locator("#note-title")).toHaveValue("");
  await expect(page.locator("#notes-list > li")).toHaveCount(1);

  const content = "First line\r\nCrème brûlée ☕";
  await page.locator("#text-file-input").setInputFiles({
    name: "Café notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content, "utf8"),
  });

  await expect(page.locator("#note-title")).toHaveValue("Café notes");
  await expect(page.locator("#note")).toHaveValue(content.replace("\r\n", "\n"));
  await page.locator("#note-title").fill("CON");

  const downloadPromise = page.waitForEvent("download");
  await (await openFileAction(page, "Download note")).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("_CON.txt");
  expect((await downloadBytes(download)).toString("utf8")).toBe(content);
});

test("exports, cancels clear, clears all local data, and restores by replacement", async ({
  page,
}) => {
  await page.locator("#note-title").fill("First");
  await page.locator("#note").fill("One ☕");
  await page.getByRole("button", { name: "New note" }).click();
  await page.locator("#note-title").fill("Second");
  await page.locator("#note").fill("Two\nlines");
  await page.locator("#note-sort").selectOption("title");
  await page.locator("#note-list-view").selectOption("compact");

  const downloadPromise = page.waitForEvent("download");
  await (await openFileAction(page, "Export JSON backup…")).click();
  const download = await downloadPromise;
  const backupBytes = await downloadBytes(download);
  const backup = JSON.parse(backupBytes.toString("utf8"));

  expect(backup.format).toBe("jotkeep-backup");
  expect(backup.version).toBe(1);
  expect(backup.document.notes).toHaveLength(2);
  expect(backup.document.preferences).toEqual({
    sortBy: "title",
    listView: "compact",
  });
  await expect(page.locator("#backup-status")).toContainText(
    "Last JSON backup created",
  );

  await (await openFileAction(page, "Clear all local data…")).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#note-title")).toHaveValue("Second");

  await (await openFileAction(page, "Clear all local data…")).click();
  await page.getByRole("button", { name: "Clear all data" }).click();
  await expect(page.locator("#note-title")).toHaveValue("");
  await expect(page.locator("#note")).toHaveValue("");
  await expect(page.locator("#backup-status")).toHaveText(
    "No JSON backup created in this browser",
  );

  await page.locator("#backup-file-input").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: backupBytes,
  });
  await page.getByRole("radio", { name: /^Replace/u }).check();
  await page.getByRole("button", { name: "Replace all local notes" }).click();

  await expect(page.locator("#note-title")).toHaveValue("Second");
  await expect(page.locator("#note")).toHaveValue("Two\nlines");
  await expect(page.locator("#note-sort")).toHaveValue("title");
  await expect(page.locator("#note-list-view")).toHaveValue("compact");
  await expect(page.locator("#notes-list > li")).toHaveCount(2);
});

test("invalid restore changes nothing and merge preserves local context", async ({
  page,
}) => {
  await page.locator("#note-title").fill("Local");
  await page.locator("#note").fill("Keep me");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  await page.locator("#backup-file-input").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"jotkeep-backup","version":99}'),
  });
  await expect(page.locator("#restore-error")).toContainText("not supported");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#note-title")).toHaveValue("Local");
  await expect(page.locator("#notes-list > li")).toHaveCount(1);

  const currentDocument = await readIndexedDbDocument(page);
  const importedDocument = structuredClone(currentDocument);
  importedDocument.notes[0].title = "Imported collision";
  importedDocument.notes[0].content = "Imported body";
  importedDocument.preferences = { sortBy: "title", listView: "compact" };
  const backup = {
    format: "jotkeep-backup",
    version: 1,
    createdAt: "2026-08-09T12:00:00.000Z",
    document: importedDocument,
  };

  await page.locator("#backup-file-input").setInputFiles({
    name: "merge.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole("radio", { name: /^Merge/u })).toBeChecked();
  await page.getByRole("button", { name: "Merge backup" }).click();

  await expect(page.locator("#note-title")).toHaveValue("Local");
  await expect(page.locator("#notes-list > li")).toHaveCount(2);
  await expect(page.locator("#note-sort")).toHaveValue("updatedAt");
  await expect(page.locator("#note-list-view")).toHaveValue("detailed");
});

test("a pending text import cannot repopulate successfully cleared data", async ({
  page,
}) => {
  await delayFileRead(page, "slow.txt");
  await page.locator("#text-file-input").setInputFiles({
    name: "slow.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Must stay cleared"),
  });

  await (await openFileAction(page, "Clear all local data…")).click();
  await page.getByRole("button", { name: "Clear all data" }).click();
  await releaseFileRead(page);

  await expect(page.locator("#note-title")).toHaveValue("");
  await expect(page.locator("#note")).toHaveValue("");
  await expect(page.locator("#notes-list > li")).toHaveCount(1);
});

test("selecting another backup disables restore until validation finishes", async ({
  page,
}) => {
  await page.locator("#note-title").fill("Local");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  const document = await readIndexedDbDocument(page);
  const backup = {
    format: "jotkeep-backup",
    version: 1,
    createdAt: "2026-08-09T12:00:00.000Z",
    document,
  };
  const bytes = Buffer.from(JSON.stringify(backup));

  await page.locator("#backup-file-input").setInputFiles({
    name: "first.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(page.getByRole("button", { name: "Merge backup" })).toBeEnabled();

  await delayFileRead(page, "slow.json");
  await page.locator("#backup-file-input").setInputFiles({
    name: "slow.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(
    page.getByRole("button", { name: "Validating backup…" }),
  ).toBeDisabled();

  await releaseFileRead(page);
  await expect(page.getByRole("button", { name: "Merge backup" })).toBeEnabled();
});
