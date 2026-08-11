import { test, expect } from "@playwright/test";

test("the app opens its complete privacy page through controlled navigation", async ({
  page,
}) => {
  const browserErrors = [];
  const requestedOrigins = new Set();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    requestedOrigins.add(new URL(request.url()).origin);
  });

  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await page.getByRole("link", { name: "Privacy", exact: true }).click();

  await expect(page).toHaveURL(/\/privacy\.html$/u);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Your notes stay under your control",
    }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "The JotKeep application code does not set or read cookies.",
  );
  await expect(page.getByRole("main")).toContainText(
    "Clear all local data…",
  );
  await expect(page.getByRole("time")).toHaveAttribute("datetime", "2026-08-11");
  await expect(
    page.getByRole("link", { name: "JotKeep issue tracker" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/ashwath-ramesh/jotkeep/issues",
  );

  await page.goto("/privacy.html?source=review");
  await expect(page).toHaveURL(/\/privacy\.html\?source=review$/u);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Your notes stay under your control",
    }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  expect([...requestedOrigins]).toEqual(["http://127.0.0.1:8080"]);
  expect(browserErrors).toEqual([]);
});
