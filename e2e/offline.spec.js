import { test, expect } from "@playwright/test";

test("the app loads and edits notes while offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        });
      });
    }
    return registration.active?.state;
  });

  await context.setOffline(true);
  try {
    await page.reload();

    const editor = page.getByRole("textbox", { name: "Note body" });
    await expect(editor).toBeVisible();
    await editor.fill("Written without a network connection.");
    await expect(page.locator("#save-state")).toHaveText("Local: Saved");
  } finally {
    await context.setOffline(false);
  }
});
