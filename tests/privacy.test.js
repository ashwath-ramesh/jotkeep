import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const privacyPage = readFileSync(join(repoRoot, "privacy.html"), "utf8");
const privacyStyles = readFileSync(
  join(repoRoot, "src", "privacy.css"),
  "utf8",
);

function occurrences(pattern) {
  return [...privacyPage.matchAll(pattern)];
}

test("privacy page has one main heading and labelled disclosure sections", () => {
  assert.equal(occurrences(/<h1(?:\s[^>]*)?>/gu).length, 1);
  assert.equal(occurrences(/<main(?:\s[^>]*)?>/gu).length, 1);

  for (const id of [
    "browser-storage-heading",
    "files-heading",
    "removal-heading",
    "network-heading",
    "contact-heading",
  ]) {
    assert.match(
      privacyPage,
      new RegExp(`<section aria-labelledby="${id}"`, "u"),
    );
    assert.match(privacyPage, new RegExp(`<h2 id="${id}"`, "u"));
  }
});

test("privacy page covers the complete checklist disclosure contract", () => {
  assert.match(privacyPage, /works without an account/iu);
  assert.match(privacyPage, /Notebook data and history\s+use IndexedDB/iu);
  assert.match(
    privacyPage,
    /Appearance settings, the recovery journal,[\s\S]*first-use guide use local storage/iu,
  );
  assert.match(privacyPage, /Browser storage\s+is not an external backup/iu);

  assert.match(privacyPage, /reads a local file only after you select it/iu);
  assert.match(privacyPage, /writes the\s+current notebook and restore points/iu);
  assert.match(
    privacyPage,
    /Disconnecting JotKeep does not delete\s+the file/iu,
  );

  assert.match(privacyPage, /Clear all local data…/u);
  assert.match(
    privacyPage,
    /remove cached application files and site permissions/iu,
  );
  assert.match(
    privacyPage,
    /Downloaded backups, text files, and Safety Files[\s\S]*not deleted/iu,
  );

  assert.match(privacyPage, /does not set or read cookies/iu);
  assert.match(
    privacyPage,
    /does not\s+include analytics, advertising, crash reporting, telemetry/iu,
  );
  assert.match(privacyPage, /no automatic requests to\s+third-party origins/iu);
  assert.match(privacyPage, /same JotKeep origin/iu);
  assert.match(privacyPage, /do not include your note\s+content/iu);
  assert.match(privacyPage, /hosting provider receives standard\s+request details/iu);

  assert.match(
    privacyPage,
    /<time datetime="2026-08-11">11 August 2026<\/time>/u,
  );
  assert.match(
    privacyPage,
    /href="https:\/\/github\.com\/ashwath-ramesh\/jotkeep\/issues"/u,
  );
  assert.match(
    privacyPage,
    /Issues are public, so do not include note content/iu,
  );
});

test("privacy heading uses the application's metric-matched font fallback", () => {
  assert.match(
    privacyStyles,
    /font-family: "Newsreader-fallback";[\s\S]*size-adjust: 96\.12%;[\s\S]*ascent-override: 76\.47%;[\s\S]*descent-override: 27\.57%;[\s\S]*line-gap-override: 0%;/u,
  );
  assert.match(
    privacyStyles,
    /--font-writing:[\s\S]*"Newsreader", "Newsreader-fallback"/u,
  );
});

test("privacy page loads no scripts or third-party application resources", () => {
  assert.equal(occurrences(/<script(?:\s|>)/gu).length, 0);
  assert.match(privacyPage, /script-src 'none'/u);

  const resourceUrls = occurrences(
    /<(?:img|link)\b[^>]*\b(?:href|src)="([^"]+)"[^>]*>/gu,
  ).map((match) => match[1]);
  assert.deepEqual(resourceUrls, ["icons/icon.svg", "src/privacy.css"]);

  const externalLinks = occurrences(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"/gu)
    .map((match) => match[1]);
  assert.deepEqual(externalLinks, [
    "https://github.com/ashwath-ramesh/jotkeep/issues",
  ]);
});
