import { test, expect } from "@playwright/test";

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

test("manual fallback downloads and restores a complete Safety File", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", { value: undefined });
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined });
  });
  await page.goto("/");
  await expect(page.locator("#safety-file-status")).toContainText(
    "Automatic updates unavailable",
  );

  await page.locator("#note-title").fill("Portable");
  await page.locator("#note").fill("Unicode ☕\nSecond line");
  await page.locator("#note-list-view").selectOption("compact");

  const downloadPromise = page.waitForEvent("download");
  await (await openFileAction(page, "Download Safety File…")).click();
  const download = await downloadPromise;
  const bytes = await downloadBytes(download);
  const value = JSON.parse(bytes.toString("utf8"));
  expect(value.format).toBe("jotkeep-safety-file");
  expect(value.version).toBe(1);
  expect(value.document.notes[0].content).toBe("Unicode ☕\nSecond line");
  expect(value.document.preferences.listView).toBe("compact");

  await (await openFileAction(page, "Clear all local data…")).click();
  await page.getByRole("button", { name: "Clear all data" }).click();
  await page.locator("#safety-file-input").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Replace local notebook" }).click();

  await expect(page.locator("#note-title")).toHaveValue("Portable");
  await expect(page.locator("#note")).toHaveValue("Unicode ☕\nSecond line");
  await expect(page.locator("#note-list-view")).toHaveValue("compact");
  await expect(page.locator("#safety-file-status")).toContainText(
    "Automatic updates unavailable",
  );
});

test("connected files update after local autosave and pause on external changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__safetyText = "";
    window.__safetyPermission = "granted";
    const handle = {
      kind: "file",
      name: "Connected.jotkeep",
      queryPermission: async () => window.__safetyPermission,
      requestPermission: async () => window.__safetyPermission,
      getFile: async () => {
        const bytes = new TextEncoder().encode(window.__safetyText);
        return {
          name: "Connected.jotkeep",
          size: bytes.byteLength,
          lastModified: Date.now(),
          arrayBuffer: async () => bytes.buffer,
        };
      },
      createWritable: async () => {
        let pending = window.__safetyText;
        return {
          write: async (value) => {
            pending = String(value);
          },
          close: async () => {
            window.__safetyText = pending;
          },
          abort: async () => {},
        };
      },
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  });
  await page.goto("/");

  await (await openFileAction(page, "Create Safety File…")).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  await page.locator("#note").fill("Saved outside the browser");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  expect(
    await page.evaluate(() => JSON.parse(window.__safetyText).document.notes[0].content),
  ).toBe("Saved outside the browser");

  await page.evaluate(() => {
    window.__safetyText += "\n";
  });
  await page.locator("#note").fill("Local change after conflict");
  await expect(page.locator("#safety-file-status")).toContainText(
    "Changed outside JotKeep",
  );
  await (await openFileAction(page, "Resolve Safety File conflict…")).click();
  await page.getByRole("button", { name: "Overwrite with local" }).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  expect(
    await page.evaluate(() => JSON.parse(window.__safetyText).document.notes[0].content),
  ).toBe("Local change after conflict");

  await page.evaluate(() => {
    const value = JSON.parse(window.__safetyText);
    value.document.notes[0].content = "External copy wins";
    // An external writer that does not produce checksums; a stale embedded
    // checksum would (correctly) be rejected as possible corruption.
    delete value.checksum;
    window.__safetyText = `${JSON.stringify(value, null, 2)}\n`;
  });
  await page.locator("#note").fill("Local copy loses after confirmation");
  await expect(page.locator("#safety-file-status")).toContainText(
    "Changed outside JotKeep",
  );
  await (await openFileAction(page, "Resolve Safety File conflict…")).click();
  await page.getByRole("button", { name: "Use Safety File" }).click();
  await expect(page.locator("#note")).toHaveValue("External copy wins");
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
});

test("a torn Safety File write fails honestly and recovers without touching local notes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__safetyText = "";
    window.__safetyTornWrites = 0;
    const handle = {
      kind: "file",
      name: "Torn.jotkeep",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFile: async () => {
        const bytes = new TextEncoder().encode(window.__safetyText);
        return {
          name: "Torn.jotkeep",
          size: bytes.byteLength,
          lastModified: Date.now(),
          arrayBuffer: async () => bytes.buffer,
        };
      },
      createWritable: async () => {
        let pending = window.__safetyText;
        return {
          write: async (value) => {
            pending = String(value);
          },
          close: async () => {
            if (window.__safetyTornWrites > 0) {
              window.__safetyTornWrites -= 1;
              window.__safetyText = pending.slice(0, 40);
              return;
            }
            window.__safetyText = pending;
          },
          abort: async () => {},
        };
      },
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  });
  await page.goto("/");

  await (await openFileAction(page, "Create Safety File…")).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");

  await page.evaluate(() => {
    window.__safetyTornWrites = 1;
  });
  await page.locator("#note").fill("Local copy survives the torn write");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  await expect(page.locator("#safety-file-status")).toContainText(
    "Backup failed; local copy is safe",
  );
  await expect(page.locator("#safety-file-status")).not.toContainText(
    "Changed outside JotKeep",
  );
  await expect(page.locator("#note")).toHaveValue(
    "Local copy survives the torn write",
  );

  await page.locator("#note").fill("Recovered after the torn write");
  await expect(page.locator("#safety-file-status")).toContainText(
    "Changed outside JotKeep",
  );
  await (await openFileAction(page, "Resolve Safety File conflict…")).click();
  await page.getByRole("button", { name: "Overwrite with local" }).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  expect(
    await page.evaluate(() => JSON.parse(window.__safetyText).document.notes[0].content),
  ).toBe("Recovered after the torn write");
});

test("disconnect and clearing local data never modify external Safety File bytes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) =>
      nativeSetTimeout(callback, delay === 500 ? 5_000 : delay, ...args);
    window.__safetyText = "";
    const handle = {
      kind: "file",
      name: "Kept.jotkeep",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFile: async () => {
        const bytes = new TextEncoder().encode(window.__safetyText);
        return {
          name: "Kept.jotkeep",
          size: bytes.byteLength,
          lastModified: 1,
          arrayBuffer: async () => bytes.buffer,
        };
      },
      createWritable: async () => {
        let pending = window.__safetyText;
        return {
          write: async (value) => { pending = String(value); },
          close: async () => { window.__safetyText = pending; },
          abort: async () => {},
        };
      },
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  });
  await page.goto("/");
  await (await openFileAction(page, "Create Safety File…")).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  const beforeDisconnect = await page.evaluate(() => window.__safetyText);
  await (await openFileAction(page, "Disconnect Safety File")).click();
  expect(await page.evaluate(() => window.__safetyText)).toBe(beforeDisconnect);

  await (await openFileAction(page, "Create Safety File…")).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  const beforeClear = await page.evaluate(() => window.__safetyText);
  await page.locator("#note").fill("Dirty content that must not reach the file");
  await expect(page.locator("#save-state")).toHaveText("Local: Saving…");
  await (await openFileAction(page, "Clear all local data…")).click();
  await page.getByRole("button", { name: "Clear all data" }).click();
  expect(await page.evaluate(() => window.__safetyText)).toBe(beforeClear);
  await expect(page.locator("#safety-file-status")).toHaveText(
    "Safety File: Not connected",
  );
});

test("a structured-cloneable file handle reconnects from IndexedDB after reload", async ({
  page,
}) => {
  await page.addInitScript(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("Remembered.jotkeep", { create: true });
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  });
  await page.goto("/");
  await page.locator("#note-title").fill("Remember this connection");
  await (await openFileAction(page, "Create Safety File…")).click();
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  await expect(page.locator("#safety-file-status")).not.toContainText(
    "connection not remembered",
  );

  await page.reload();
  await expect(page.locator("#safety-file-status")).toContainText(
    "Remembered.jotkeep",
  );
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  await page.locator("#note").fill("Updated after reload");
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");

  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("Remembered.jotkeep");
    return JSON.parse(await (await handle.getFile()).text()).document.notes[0].content;
  })).toBe("Updated after reload");
});

test("opening with merge preserves local context and verifies the combined file", async ({
  page,
}) => {
  await page.addInitScript(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("Merge.jotkeep", { create: true });
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  });
  await page.goto("/");
  await page.locator("#note-title").fill("External note");
  await page.locator("#note").fill("From the Safety File");
  await (await openFileAction(page, "Create Safety File…")).click();
  await (await openFileAction(page, "Disconnect Safety File")).click();

  await (await openFileAction(page, "Clear all local data…")).click();
  await page.getByRole("button", { name: "Clear all data" }).click();
  await expect(page.locator("#note-title")).toHaveValue("");
  await expect(page.locator("#safety-file-status")).toHaveText(
    "Safety File: Not connected",
  );
  await page.locator("#note-title").fill("Local note");
  await page.locator("#note").fill("Keep this too");
  await page.locator("#note-list-view").selectOption("compact");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  await (await openFileAction(page, "Open Safety File…")).click();
  await page.getByRole("radio", { name: /^Merge/u }).check();
  await page.getByRole("button", { name: "Merge and update Safety File" }).click();

  await expect(page.locator("#notes-list > li")).toHaveCount(2);
  await expect(page.locator("#note-title")).toHaveValue("Local note");
  await expect(page.locator("#note-list-view")).toHaveValue("compact");
  await expect(page.locator("#safety-file-status")).toContainText("Backed up");
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("Merge.jotkeep");
    const value = JSON.parse(await (await handle.getFile()).text());
    return value.document.notes.map((note) => note.title).sort();
  })).toEqual(["External note", "Local note"]);
});
