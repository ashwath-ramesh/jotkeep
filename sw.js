const CACHE_PREFIX = "jotkeep-";
const CACHE_VERSION = "jotkeep-v13";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./src/styles.css",
  "./src/app.js",
  "./src/autosave.js",
  "./src/backup.js",
  "./src/commands.js",
  "./src/editor.js",
  "./src/find-replace.js",
  "./src/indexeddb-storage.js",
  "./src/insert.js",
  "./src/notes.js",
  "./src/preferences.js",
  "./src/privacy.css",
  "./src/safety-file-format.js",
  "./src/safety-file.js",
  "./src/snapshots.js",
  "./src/storage.js",
  "./fonts/newsreader-latin-400.woff2",
  "./fonts/newsreader-latin-600.woff2",
];

self.addEventListener("install", (event) => {
  // No skipWaiting(): the new worker stays waiting until every old tab
  // closes or the page asks for the update, so a fresh worker never takes
  // over an editor that is still running old application code.
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        cache.addAll(
          PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }
  // Known navigations use their exact precached page. Unknown application
  // routes fall back to the app shell; freshness arrives via the update
  // prompt, so a page and its assets always come from one deployment.
  // Asset requests match exactly (no ignoreSearch) so a query-busted URL is
  // never satisfied by a stale cached entry.
  if (event.request.mode === "navigate") {
    const privacyPath = new URL(
      "./privacy.html",
      self.registration.scope,
    ).pathname;
    const cachedPage = requestUrl.pathname === privacyPath
      ? "./privacy.html"
      : "./index.html";
    event.respondWith(
      caches.match(cachedPage).then((cached) => cached ?? fetch(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
