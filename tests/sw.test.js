import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serviceWorkerSource = readFileSync(join(repoRoot, "sw.js"), "utf8");

function precacheUrls() {
  const listMatch = serviceWorkerSource.match(
    /const PRECACHE_URLS = \[([\s\S]*?)\];/,
  );
  assert.notEqual(listMatch, null, "sw.js must define PRECACHE_URLS");
  return [...listMatch[1].matchAll(/"(\.\/[^"]*)"/g)].map(([, url]) => url);
}

test("service worker declares a cache version", () => {
  const versionMatch = serviceWorkerSource.match(
    /const CACHE_VERSION = "([^"]+)";/,
  );
  assert.notEqual(versionMatch, null, "sw.js must define CACHE_VERSION");
  assert.equal(
    versionMatch[1],
    "jotkeep-v12",
    "shell changes must ship with a new cache version",
  );
});

test("every precached URL exists on disk", () => {
  for (const url of precacheUrls()) {
    if (url === "./") {
      continue;
    }
    assert.equal(
      existsSync(join(repoRoot, url)),
      true,
      `${url} is precached by sw.js but missing from the repository`,
    );
  }
});

test("every application-shell file is precached", () => {
  const precached = new Set(precacheUrls());
  const required = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./icons/icon.svg",
    ...readdirSync(join(repoRoot, "src"))
      .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
      .map((name) => `./src/${name}`),
    ...readdirSync(join(repoRoot, "fonts"))
      .filter((name) => name.endsWith(".woff2"))
      .map((name) => `./fonts/${name}`),
  ];

  for (const url of required) {
    assert.equal(
      precached.has(url),
      true,
      `${url} must be listed in PRECACHE_URLS in sw.js (and CACHE_VERSION bumped)`,
    );
  }
});

test("the worker waits for consent instead of taking over old tabs", () => {
  const installBlock = serviceWorkerSource.match(
    /addEventListener\("install",([\s\S]*?)\n\}\);/u,
  );
  assert.notEqual(installBlock, null);
  assert.equal(
    installBlock[1].includes("self.skipWaiting"),
    false,
    "install must not call self.skipWaiting(); updates activate via the SKIP_WAITING message",
  );
  assert.match(serviceWorkerSource, /SKIP_WAITING/u);
  assert.equal(
    serviceWorkerSource.includes("ignoreSearch:"),
    false,
    "asset matching must be exact so query-busted URLs bypass stale entries",
  );
});
