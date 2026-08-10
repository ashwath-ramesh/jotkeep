import { test, expect } from "@playwright/test";

const RECOVERY_KEY = "jotkeep.recovery.v1";

test("typing journals the active note and a clean save clears the journal", async ({
  page,
}) => {
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "Note body" });
  await editor.fill("Crash-safe content");

  const journal = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    RECOVERY_KEY,
  );
  expect(journal.content).toBe("Crash-safe content");

  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), RECOVERY_KEY),
  ).toBeNull();
});

test("a journal newer than the stored note is recovered at startup", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Note body" });
  await editor.fill("Persisted before the crash");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  // Simulate a crash that happened mid-debounce: the journal holds edits the
  // asynchronous IndexedDB save never received.
  await page.evaluate((key) => {
    const noteId = document
      .querySelector('#notes-list [data-note-id]')
      .getAttribute("data-note-id");
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        noteId,
        title: "Recovered title",
        content: "Edits from the crash window",
        updatedAt: "2099-01-01T00:00:00.000Z",
      }),
    );
  }, RECOVERY_KEY);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue(
    "Edits from the crash window",
  );
  await expect(page.locator("#note-title")).toHaveValue("Recovered title");
  await expect(page.locator("#command-feedback")).toHaveText(
    "Recovered edits that had not finished saving.",
  );

  // The recovered edits persist and the journal is retired.
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), RECOVERY_KEY),
  ).toBeNull();
});

test("a stale journal for a missing note is discarded untouched", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Note body" }).fill("Real note");
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        noteId: "note_deleted-long-ago",
        title: "Ghost",
        content: "Should never resurface",
        updatedAt: "2099-01-01T00:00:00.000Z",
      }),
    );
  }, RECOVERY_KEY);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue(
    "Real note",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), RECOVERY_KEY),
  ).toBeNull();
});
