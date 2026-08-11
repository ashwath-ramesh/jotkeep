import { test, expect } from "@playwright/test";

async function openViewMenu(page) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  return page.locator("#view-menu");
}

async function expectNotepadFillsEditorPanel(page) {
  await expect
    .poll(() =>
      page.locator("#note").evaluate((note) => {
        const noteBox = note.getBoundingClientRect();
        const panelBox = note.closest(".editor-panel").getBoundingClientRect();
        return Math.abs(noteBox.bottom - panelBox.bottom);
      }),
    )
    .toBeLessThanOrEqual(1);
}

test("the note body fills the remaining viewport and scrolls long notes internally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "Note body" });
  const guide = page.getByRole("region", {
    name: "Three things to know before you write",
  });
  await expect(guide).toBeVisible();
  await expectNotepadFillsEditorPanel(page);

  const longNote = Array.from(
    { length: 120 },
    (_, index) => `Line ${index + 1}: enough content to require scrolling`,
  ).join("\n");
  await editor.fill(longNote);
  await expect(guide).toBeHidden();
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNotepadFillsEditorPanel(page);

    const layout = await editor.evaluate((note) => {
      const noteBox = note.getBoundingClientRect();
      const statusBox = document
        .querySelector("#status-bar")
        .getBoundingClientRect();
      return {
        distanceFromStatusBar: Math.abs(noteBox.bottom - statusBox.top),
        documentScrolls:
          document.documentElement.scrollHeight > window.innerHeight,
        editorScrolls: note.scrollHeight > note.clientHeight,
      };
    });
    expect(layout.distanceFromStatusBar).toBeLessThanOrEqual(1);
    expect(layout.documentScrolls).toBe(false);
    expect(layout.editorScrolls).toBe(true);
  }
});

test("appearance settings apply to every note, survive reload, and reset independently", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Note title" }).fill("Plain note");
  await page.getByRole("textbox", { name: "Note body" }).fill("One very long line ".repeat(40));
  await expect(page.locator("#save-state")).toHaveText("Local: Saved");

  await openViewMenu(page);
  await page.getByRole("menuitem", { name: "Appearance…" }).click();
  await page.locator("#appearance-color-mode").selectOption("dark");
  await page.locator("#appearance-font-family").selectOption("mono");
  await page.locator("#appearance-font-size").selectOption("24");
  await page.locator("#appearance-font-weight").selectOption("600");
  await page.locator("#appearance-font-style").selectOption("italic");
  await page.locator("#appearance-line-spacing").selectOption("1.4");
  await page.getByRole("button", { name: "Done" }).click();

  await openViewMenu(page);
  await page.getByRole("menuitemcheckbox", { name: "Word wrap" }).click();
  await openViewMenu(page);
  await page.getByRole("menuitemcheckbox", { name: "Status bar" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-font-family", "mono");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "24");
  await expect(page.locator("html")).toHaveAttribute("data-word-wrap", "false");
  await expect(page.locator("#note")).toHaveAttribute("wrap", "off");
  await expect(page.locator("#status-bar")).toBeHidden();

  const persisted = await page.evaluate(() => ({
    appearance: JSON.parse(localStorage.getItem("jotkeep.appearance.v1")),
    noteValue: document.querySelector("#note").value,
  }));
  expect(persisted.appearance).toMatchObject({
    colorMode: "dark",
    wordWrap: false,
    statusBar: false,
    fontFamily: "mono",
    fontSize: 24,
    fontWeight: 600,
    fontStyle: "italic",
    lineSpacing: 1.4,
  });
  expect(persisted.noteValue).toBe("One very long line ".repeat(40));

  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-font-family", "mono");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "24");
  await expect(page.locator("#status-bar")).toBeHidden();

  await openViewMenu(page);
  await page.getByRole("menuitem", { name: "Reset appearance" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("html")).toHaveAttribute("data-font-family", "newsreader");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "18");
  await expect(page.locator("#note")).toHaveAttribute("wrap", "soft");
  await expect(page.locator("#status-bar")).toBeVisible();
});

test("the command palette searches, executes, and defers destructive confirmation", async ({
  page,
}) => {
  await page.goto("/");
  const commandsButton = page.getByRole("button", { name: "Commands", exact: true });
  await commandsButton.click();
  const search = page.getByRole("searchbox", { name: "Search commands" });
  await search.fill("dark color");
  await expect(page.locator('#command-palette-results [role="option"]')).toHaveCount(1);
  await search.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(commandsButton).toBeFocused();

  await page.keyboard.press("Control+Slash");
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
  await search.press("Escape");

  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "/",
      shiftKey: true,
    }));
  });
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
  await search.fill("clear local data");
  await page.locator('#command-palette-results [role="option"]', {
    hasText: "Clear all local data",
  }).click();
  const clearDialog = page.getByRole("dialog", { name: "Clear all local data" });
  await expect(clearDialog).toBeVisible();
  await clearDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const initialCount = await page.locator("#notes-list > li").count();
  await page.keyboard.press("Control+KeyN");
  await expect(page.locator("#notes-list > li")).toHaveCount(initialCount + 1);
});

test("printing uses a complete inert title-and-body view and hides application chrome", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls += 1;
    };
  });
  await page.goto("/");
  await openViewMenu(page);
  await page.getByRole("menuitem", { name: "Appearance…" }).click();
  await page.locator("#appearance-font-family").selectOption("sans");
  await page.locator("#appearance-font-size").selectOption("24");
  await page.locator("#appearance-font-weight").selectOption("600");
  await page.locator("#appearance-font-style").selectOption("italic");
  await page.locator("#appearance-line-spacing").selectOption("1.4");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("");
  const body = "First line\n<script>window.printedAttack = true</script>\n" + "Long text ".repeat(200);
  await page.getByRole("textbox", { name: "Note body" }).fill(body);

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Print note…" }).click();
  expect(await page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator("#print-title")).toHaveText("Untitled Note");
  await expect(page.locator("#print-body")).toHaveText(body);
  expect(await page.evaluate(() => window.printedAttack)).toBeUndefined();
  await expect(page.locator("#print-view script")).toHaveCount(0);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-shell")).toBeHidden();
  await expect(page.locator("#print-view")).toBeVisible();
  const printStyles = await page.evaluate(() => {
    const container = getComputedStyle(document.querySelector("#print-view"));
    const body = getComputedStyle(document.querySelector("#print-body"));
    return {
      body: {
        family: body.fontFamily,
        size: body.fontSize,
        style: body.fontStyle,
        weight: body.fontWeight,
        lineHeight: body.lineHeight,
        whiteSpace: body.whiteSpace,
      },
      container: {
        family: container.fontFamily,
        size: container.fontSize,
        style: container.fontStyle,
        weight: container.fontWeight,
        lineHeight: container.lineHeight,
      },
    };
  });
  expect(printStyles.body).toMatchObject({
    ...printStyles.container,
    whiteSpace: "pre-wrap",
  });
});

test("important feedback remains visible with the status bar disabled and has one live region", async ({
  page,
}) => {
  await page.goto("/");
  await openViewMenu(page);
  await page.getByRole("menuitemcheckbox", { name: "Status bar" }).click();
  await expect(page.locator("#status-bar")).toBeHidden();

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is unavailable", "QuotaExceededError");
    };
  });

  await openViewMenu(page);
  await page.getByRole("menuitem", { name: "Appearance…" }).click();
  await page.locator("#appearance-font-size").selectOption("20");

  const message =
    "Appearance changed for this visit, but this browser could not save the preference.";
  await expect(page.locator("#status-bar")).toBeVisible();
  await expect(page.locator("#command-feedback")).toHaveText(message);
  await expect(page.locator("#app-announcer")).toHaveText(message);
  await expect(page.locator("#command-feedback")).not.toHaveAttribute("role", "status");
  await expect(page.locator("#command-feedback")).not.toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.locator("#app-announcer")).toHaveAttribute("role", "status");
  await expect(page.locator("#save-state")).toBeHidden();
});

test("creating a note with the keyboard closes any open application menu", async ({
  page,
}) => {
  await page.goto("/");

  for (const menu of [
    { button: "File", id: "#file-menu" },
    { button: "View", id: "#view-menu" },
  ]) {
    const trigger = page.getByRole("button", { name: menu.button, exact: true });
    await trigger.click();
    await expect(page.locator(menu.id)).toBeVisible();
    const count = await page.locator("#notes-list > li").count();
    await page.keyboard.press("Control+KeyN");
    await expect(page.locator("#notes-list > li")).toHaveCount(count + 1);
    await expect(page.locator(menu.id)).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  }

  await page.setViewportSize({ width: 1100, height: 720 });
  const more = page.getByRole("button", { name: "More", exact: true });
  await more.click();
  await expect(page.locator("#command-menu")).toBeVisible();
  const count = await page.locator("#notes-list > li").count();
  await page.keyboard.press("Control+KeyN");
  await expect(page.locator("#notes-list > li")).toHaveCount(count + 1);
  await expect(page.locator("#command-menu")).toBeHidden();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
});

test("fullscreen has synchronized visible entry and exit controls", async ({ page }) => {
  await page.addInitScript(() => {
    let fullscreenElement = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: async function requestFullscreen() {
        fullscreenElement = this;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
  });
  await page.goto("/");
  const fullscreen = page.getByRole("button", { name: "Enter fullscreen" }).first();
  await fullscreen.click();
  await expect(page.locator("#fullscreen-toggle")).toHaveAttribute(
    "aria-label",
    "Exit fullscreen",
  );
  await expect(page.locator("#fullscreen-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fullscreen-toggle").click();
  await expect(page.locator("#fullscreen-toggle")).toHaveAttribute(
    "aria-label",
    "Enter fullscreen",
  );
  await expect(page.locator("#fullscreen-toggle")).toHaveAttribute("aria-pressed", "false");
});
