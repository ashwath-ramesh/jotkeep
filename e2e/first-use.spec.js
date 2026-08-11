import { test, expect } from "@playwright/test";

async function expectBackupActionFocused(page, menuSelector) {
  const directFileAccess = await page.evaluate(
    () => typeof window.showSaveFilePicker === "function",
  );
  const expectedAction = directFileAccess ? "create-safety" : "download-safety";
  const action = page.locator(
    `${menuSelector} [data-file-action="${expectedAction}"]`,
  );
  await expect(action).toBeVisible();
  await expect(action).toBeFocused();
}

test("a fresh notebook explains privacy, storage, and external backups before editing", async ({
  page,
}) => {
  await page.goto("/");

  const guide = page.getByRole("region", {
    name: "Three things to know before you write",
  });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("JotKeep is a private, plain-text notepad.");
  await expect(guide).toContainText("Browser storage is not an external backup");
  await expect(page.getByRole("textbox", { name: "Note body" })).toBeFocused();

  const learnAboutBackups = guide.getByRole("button", {
    name: "Learn about backups",
  });
  await learnAboutBackups.click();
  const backupGuide = page.getByRole("dialog", {
    name: "Back up your notebook",
  });
  await expect(backupGuide).toBeVisible();
  await expect(backupGuide).toContainText("Safety File");
  await expect(backupGuide).toContainText("complete copy of your notebook");
  await expect(backupGuide).toContainText("JSON backup");
  await expect(backupGuide).toContainText("complete snapshot of your notes");
  await expect(backupGuide).toContainText("Neither file is encrypted");
  await backupGuide.getByRole("button", { name: "Not now" }).click();
  await expect(learnAboutBackups).toBeFocused();

  await learnAboutBackups.click();
  await backupGuide
    .getByRole("button", { name: "Show backup options" })
    .click();
  await expect(page.locator("#file-menu")).toBeVisible();
  await expectBackupActionFocused(page, "#file-menu");

  await page.getByRole("textbox", { name: "Note body" }).fill("My first note");
  await expect(guide).toBeHidden();
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  await page.reload();
  await expect(guide).toBeHidden();

  const backupHelp = page.getByRole("button", { name: "Backup help" });
  await backupHelp.click();
  await expect(
    page.getByRole("dialog", { name: "Back up your notebook" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(backupHelp).toBeFocused();
});

test("the first-use guide can be dismissed before editing", async ({ page }) => {
  await page.goto("/");

  const guide = page.getByRole("region", {
    name: "Three things to know before you write",
  });
  await expect(guide).toContainText(
    "This guide closes after your first edit, or you can close it now.",
  );
  await guide.getByRole("button", { name: "Close first-use guide" }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Note body" })).toBeFocused();

  await page.reload();
  await expect(guide).toBeHidden();
});

test("the first-use backup path opens the responsive command menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const guide = page.getByRole("region", {
    name: "Three things to know before you write",
  });
  await guide.getByRole("button", { name: "Learn about backups" }).click();
  await page
    .getByRole("dialog", { name: "Back up your notebook" })
    .getByRole("button", { name: "Show backup options" })
    .click();

  await expect(page.locator("#command-menu")).toBeVisible();
  await expect(page.getByRole("button", { name: "More" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expectBackupActionFocused(page, "#command-menu");
});
