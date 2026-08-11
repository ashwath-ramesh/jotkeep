import { test, expect } from "@playwright/test";

async function setActiveNote(page, title, body) {
  await page.getByRole("textbox", { name: "Note title" }).fill(title);
  await page.getByRole("textbox", { name: "Note body" }).fill(body);
}

async function createNote(page, title, body) {
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await setActiveNote(page, title, body);
}

test("note search matches titles and bodies, counts results, and retains its query", async ({
  page,
}) => {
  await page.goto("/");
  await setActiveNote(page, "Alpha heading", "First body");
  await createNote(page, "Beta heading", "A needle in this body");
  await createNote(page, "Gamma heading", "Third body");

  const search = page.getByRole("searchbox", { name: "Search notes" });
  const count = page.locator("#note-search-count");

  await search.fill("alpha");
  await expect(search).toHaveValue("alpha");
  await expect(count).toHaveText("1 matching note");
  await expect(page.locator("#notes-list .note-list-title")).toHaveText([
    "Alpha heading",
  ]);

  await search.fill("needle");
  await expect(count).toHaveText("1 matching note");
  await expect(page.locator("#notes-list .note-list-title")).toHaveText([
    "Beta heading",
  ]);

  await page.getByRole("textbox", { name: "Note body" }).fill(
    "The active note now has a needle too.",
  );
  await expect(search).toHaveValue("needle");
  await expect(count).toHaveText("2 matching notes");
  await expect(page.locator("#notes-list .note-list-title")).toHaveText([
    "Gamma heading",
    "Beta heading",
  ]);
});

test("a no-results search has a keyboard-accessible clear action", async ({ page }) => {
  await page.goto("/");
  await setActiveNote(page, "First note", "First body");
  await createNote(page, "Second note", "Second body");

  const search = page.getByRole("searchbox", { name: "Search notes" });
  const count = page.locator("#note-search-count");
  const emptyState = page.locator("#notes-empty-state");
  const clearSearch = page.getByRole("button", { name: "Clear search" });

  await search.fill("missing query");
  await expect(search).toHaveValue("missing query");
  await expect(count).toHaveText("0 matching notes");
  await expect(page.locator("#notes-list > li")).toHaveCount(0);
  await expect(emptyState).toContainText("No notes match “missing query”.");

  await clearSearch.focus();
  await clearSearch.press("Enter");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(count).toBeHidden();
  await expect(emptyState).toBeHidden();
  await expect(page.locator("#notes-list > li")).toHaveCount(2);
});
