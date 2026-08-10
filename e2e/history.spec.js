import { test, expect } from "@playwright/test";

const CREATED_AT = "2026-08-10T10:00:00.000Z";
const CLOCK_AT = "2026-08-10T12:00:00.000Z";

async function openFileAction(page, name) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  return page.getByRole("menuitem", { name });
}

async function waitForSave(page) {
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
}

function documentFixture(content = "From backup") {
  return {
    version: 2,
    activeNoteId: "backup_note",
    notes: [{
      id: "backup_note",
      title: "Backup note",
      content,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    preferences: { sortBy: "updatedAt", listView: "detailed" },
  };
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(CLOCK_AT) });
  await page.goto("/");
  await expect(page.locator("#note")).toBeEnabled();
});

test("refreshes backup age and warning state while the app remains open", async ({
  page,
}) => {
  const backup = {
    format: "jotkeep-backup",
    version: 1,
    createdAt: CREATED_AT,
    document: documentFixture(),
  };
  await page.locator("#backup-test-file-input").setInputFiles({
    name: "recent.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator("#backup-status")).toContainText(
    "External backup: 2 hours old",
  );

  await page.clock.fastForward(7 * 24 * 60 * 60 * 1000);
  await expect(page.locator("#backup-status")).toContainText(
    "old — test or update it",
  );
});

test("previews an overwritten note and restores it as a copy", async ({ page }) => {
  await page.locator("#note-title").fill("Earlier title");
  await page.locator("#note").fill("Original body");
  await waitForSave(page);

  await page.locator("#note").fill("Overwritten body");
  await waitForSave(page);

  await (await openFileAction(page, "Browse history…")).click();
  await expect(page.locator("#history-dialog")).toBeVisible();
  await expect(page.locator("#history-preview-body")).toHaveValue("Original body");
  await page.getByRole("button", { name: "Restore a copy" }).click();

  await expect(page.locator("#note-title")).toHaveValue(
    "Earlier title (Recovered copy)",
  );
  await expect(page.locator("#note")).toHaveValue("Original body");
  await expect(page.locator("#notes-list")).toContainText("Earlier title");
  await expect(page.locator("#notes-list")).toContainText(
    "Earlier title (Recovered copy)",
  );
});

test("recovers a deleted note without changing another current note", async ({ page }) => {
  await page.locator("#note-title").fill("Keep me");
  await page.locator("#note").fill("Unrelated current body");
  await waitForSave(page);

  await page.locator("#new-note").click();
  await page.locator("#note-title").fill("Deleted note");
  await page.locator("#note").fill("Recover this body");
  await waitForSave(page);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Deleted note" }).click();
  await expect(page.locator("#notes-list")).not.toContainText("Deleted note");

  await (await openFileAction(page, "Browse history…")).click();
  await page.locator("#history-note").selectOption({ label: "Deleted note" });
  await expect(page.locator("#history-preview-body")).toHaveValue(
    "Recover this body",
  );
  await page.getByRole("button", { name: "Restore note", exact: true }).click();

  await expect(page.locator("#note-title")).toHaveValue("Deleted note");
  await expect(page.locator("#note")).toHaveValue("Recover this body");
  await page
    .locator(".note-list-item", { hasText: "Keep me" })
    .locator(".note-select")
    .click();
  await expect(page.locator("#note")).toHaveValue("Unrelated current body");
});

test("full restore is reversible and backup testing never changes notes", async ({ page }) => {
  await page.locator("#note-title").fill("Current notebook");
  await page.locator("#note").fill("Keep before restore");
  await waitForSave(page);

  const backup = {
    format: "jotkeep-backup",
    version: 1,
    createdAt: CREATED_AT,
    document: documentFixture(),
  };
  await page.locator("#backup-test-file-input").setInputFiles({
    name: "tested.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator("#command-feedback")).toContainText("Test passed");
  await expect(page.locator("#backup-status")).toContainText("External backup:");
  await expect(page.locator("#note")).toHaveValue("Keep before restore");

  await page.locator("#backup-test-file-input").setInputFiles({
    name: "stale.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      ...backup,
      createdAt: "2020-01-01T00:00:00.000Z",
    })),
  });
  await expect(page.locator("#backup-status")).toContainText(
    "old — test or update it",
  );
  await expect(page.locator("#note")).toHaveValue("Keep before restore");

  await page.locator("#backup-file-input").setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator('[name="restore-mode"][value="replace"]').check();
  await page.getByRole("button", { name: "Replace all local notes" }).click();
  await expect(page.locator("#note")).toHaveValue("From backup");

  await (await openFileAction(page, "Browse history…")).click();
  await expect(page.locator("#history-preview-body")).toHaveValue(
    "Keep before restore",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore full notebook" }).click();
  await expect(page.locator("#note-title")).toHaveValue("Current notebook");
  await expect(page.locator("#note")).toHaveValue("Keep before restore");
});
