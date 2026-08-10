const CACHE_PREFIX = "jotkeep-";
const CACHE_VERSION = "jotkeep-v3";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./src/styles.css",
  "./src/app.js",
  "./src/autosave.js",
  "./src/backup.js",
  "./src/editor.js",
  "./src/find-replace.js",
  "./src/indexeddb-storage.js",
  "./src/insert.js",
  "./src/notes.js",
  "./src/safety-file-format.js",
  "./src/safety-file.js",
  "./src/storage.js",
  "./fonts/newsreader-latin-400.woff2",
  "./fonts/newsreader-latin-600.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        cache.addAll(
          PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })),
        ),
      )
      .then(() => self.skipWaiting()),
  );
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
  if (new URL(event.request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches
      .match(event.request.mode === "navigate" ? "./index.html" : event.request, {
        ignoreSearch: true,
      })
      .then((cached) => cached ?? fetch(event.request)),
  );
});
