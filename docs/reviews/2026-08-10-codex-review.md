# Repository review

The most serious issue is a confirmed Safety File data-loss path: an orphaned remembered file handle can cause startup to overwrite the external notebook with a generated blank notebook and then report “Backed up.” The Lighthouse CLS report is also explained directly by the desktop sidebar being hidden in HTML and revealed only after asynchronous initialization.

## Critical and high findings

1. **Critical — An orphaned Safety File connection can overwrite the only external copy with a blank notebook.**  
   [src/indexeddb-storage.js:784](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:784), [src/indexeddb-storage.js:934](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:934), [src/safety-file.js:326](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:326), [src/app.js:550](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:550)  
   Connection metadata is written independently of notebook records. A cross-tab clear can delete both stores, after which another tab’s in-flight `saveSafetyFileConnection()` recreates only the connection record. On reload, storage returns a generated blank document alongside that connection; `initialize(..., {synchronize: true})` treats the blank document as a local change and writes it over the Safety File. I reproduced this path: external content became blank and the state ended as `backed-up`.  
   **Fix:** Never auto-synchronize a generated fallback when no persisted notebook exists. Read the Safety File and offer recovery instead. Make connection writes a transaction across both stores that verifies a current notebook revision/clear epoch. Broadcast clear operations to other tabs, but retain the storage-level guard because broadcasts are not reliable.

2. **High — The editor is usable before bootstrap and early typing can be silently overwritten.**  
   [index.html:102](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:102), [index.html:348](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:348), [src/app.js:211](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:211), [src/app.js:488](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:488)  
   The visible textarea is initially enabled and even has `autofocus`. `inert` is applied only after the module graph loads. Input entered before that point has no listener and is replaced by `showActiveNote()`. If module loading fails, the page also looks editable while saving nothing.  
   **Fix:** Put `inert` and `aria-busy="true"` in the HTML, show an explicit loading/failure state, and remove them only after state and handlers are ready. Add a `<noscript>` warning.

3. **High — The final 500 ms of edits are not crash-safe.**  
   [src/autosave.js:81](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/autosave.js:81), [src/app.js:2023](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:2023)  
   `pagehide` and `visibilitychange` start an asynchronous IndexedDB flush, but page termination does not guarantee that it completes. Browser crashes, force-closes, mobile process eviction, and navigation can lose the debounced tail.  
   **Fix:** Maintain a synchronous, bounded recovery journal for the active note or incremental edits, reconcile it at startup, shorten the debounce, and warn on `beforeunload` while dirty as a secondary defense. Do not rely on unload-time IndexedDB alone.

4. **High — Existing IndexedDB data causes divergent legacy data to be deleted without comparison.**  
   [src/indexeddb-storage.js:692](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:692)  
   When IndexedDB contains a notebook, every JotKeep legacy key is removed merely because one exists. An older still-open app tab can write a newer localStorage notebook after migration; the next new-version load will prefer older IndexedDB data and erase the newer legacy copy.  
   **Fix:** Delete legacy data only when it matches a verified migration checksum/revision. If valid data differs, preserve both and present a recovery conflict. Store a migration marker tying the exact source digest to the IndexedDB revision.

5. **High — A GitHub Pages project deployment may not provide a private storage origin.**  
   [src/indexeddb-storage.js:13](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:13), [src/indexeddb-storage.js:109](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:109)  
   IndexedDB and localStorage are origin-scoped, not path-scoped. If JotKeep is hosted under a shared `username.github.io/jotkeep/` origin, any other application under that GitHub Pages origin can open the `jotkeep` database, read notes, and retrieve the stored file handle.  
   **Fix:** Deploy JotKeep on a dedicated custom origin used for no other application, or a dedicated GitHub Pages account/origin. Namespacing database keys does not provide security isolation.

6. **High — Slow text imports can corrupt the imported note.**  
   [src/app.js:1060](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1060)  
   `notesDocument` switches to the imported note before `persistImmediately()` finishes, but the inputs still show the old note and remain enabled. Input during a slow IndexedDB save is therefore applied to the imported note using stale UI values.  
   **Fix:** Use `setNotebookTransitionPending(true)` around the entire transition, or keep the candidate separate until persistence succeeds and atomically swap document/UI state afterward.

7. **High — The desktop sidebar causes the reported CLS 0.245.**  
   [index.html:52](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:52), [src/styles.css:407](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/styles.css:407), [src/styles.css:418](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/styles.css:418), [src/app.js:1823](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1823)  
   The sidebar ships `hidden`, so `.workspace` initially spans the full grid. After IndexedDB initialization and most application setup, desktop JavaScript reveals the 19rem sidebar and moves/resizes `.workspace`.  
   **Fix:** Render the desktop sidebar visible in the initial markup and hide it initially only through the mobile media query. Alternatively set a pre-paint layout attribute with a tiny inline bootstrap, while reserving the final grid dimensions.

8. **High — Every detailed preview duplicates the entire note body into the DOM.**  
   [src/notes.js:70](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/notes.js:70), [src/app.js:440](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:440), [src/app.js:468](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:468)  
   CSS visually ellipsizes previews, but `notePreview()` normalizes and returns the full content. A multi-megabyte notebook is duplicated into sidebar DOM and rebuilt on every keystroke.  
   **Fix:** Generate a bounded preview, such as 160 graphemes, using an early-terminating scan. Cache it per note and update only the active note’s list item.

9. **High — Per-note IndexedDB records still incur whole-notebook work on every save.**  
   [src/app.js:517](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:517), [src/indexeddb-storage.js:178](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:178), [src/indexeddb-storage.js:385](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:385), [src/indexeddb-storage.js:411](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/indexeddb-storage.js:411)  
   Each save clones the complete document, reads every note with `getAll()`, reconstructs it, and performs repeated `JSON.stringify()` comparisons. Only the final `put()` is per-note.  
   **Fix:** Pass an explicit mutation or changed-note set to storage. Use a monotonic notebook revision for transactional cross-tab CAS, then write only the changed note and necessary metadata.

## Medium findings

10. **Medium — JSON backup status claims success without knowing a download completed.**  
    [src/app.js:744](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:744), [src/app.js:1116](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1116)  
    `link.click()` cannot confirm that the user accepted the download or that disk writing succeeded, yet the app records “Last JSON backup created.” Revoking the object URL at zero delay can also break downloads in some browsers.  
    **Fix:** Say “download requested/prepared,” distinguish attempted from verified backups, revoke after a conservative delay, and use File System Access plus read-back verification where available.

11. **Medium — Notebook growth can make every complete backup route unavailable.**  
    [src/backup.js:6](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/backup.js:6), [src/safety-file-format.js:5](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file-format.js:5), [src/storage.js:47](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/storage.js:47)  
    Notes and note count are unbounded, but both JSON backups and Safety Files stop at 25 MiB. A user can cross the limit while still saving to evictable IndexedDB.  
    **Fix:** Track estimated serialized size continuously, warn well before the threshold, and provide a streaming/chunked or multi-file full-notebook export.

12. **Medium — Manual backups have no embedded accidental-corruption check.**  
    [src/backup.js:104](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/backup.js:104), [src/safety-file-format.js:59](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file-format.js:59)  
    Schema validation catches malformed JSON but not a bit flip that leaves valid JSON and valid field types. The connected Safety File digest lives only in IndexedDB; downloaded files are self-unverifiable.  
    **Fix:** Add a versioned canonical-document SHA-256 field and validate it on import. Document that this detects accidental corruption, not malicious tampering.

13. **Medium — Safety File conflict detection has a read/write race.**  
    [src/safety-file.js:141](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:141), [src/safety-file.js:155](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:155)  
    An external writer can change the file after the expected-digest read but before JotKeep’s write. JotKeep can overwrite that change and then successfully verify its own result.  
    **Fix:** Recheck immediately before writing, but recognize this cannot provide true OS-level CAS. For strong protection, retain immutable timestamped revisions or write a new revision file rather than replacing the only copy.

14. **Medium — An oversized local notebook is reported as an external file change.**  
    [src/safety-file.js:45](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:45), [src/safety-file.js:152](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:152), [src/safety-file.js:312](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:312)  
    `serializeSafetyFile()` throws `SafetyFileValidationError` for the 25 MiB limit; all validation errors become `INVALID`, which maps to `EXTERNAL_CHANGE`. The UI then offers irrelevant conflict resolution.  
    **Fix:** Introduce a distinct local `TOO_LARGE`/serialization failure and display the real remediation.

15. **Medium — Granting permission can report successful verification after a conflict.**  
    [src/safety-file.js:482](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file.js:482), [src/app.js:1438](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1438)  
    `verify()` catches external-change errors, but `grant()` returns true for every state except `NEEDS_PERMISSION`. The UI then says access was restored and the file verified even when state is `EXTERNAL_CHANGE`.  
    **Fix:** Return a structured result and claim success only when verification produced `BACKED_UP` or a legitimate local `PENDING` state.

16. **Medium — Cache freshness depends on a manual version bump, and query cache-busting is disabled.**  
    [sw.js:1](/home/ash/src/github.com/ashwath-ramesh/jotkeep/sw.js:1), [sw.js:61](/home/ash/src/github.com/ashwath-ramesh/jotkeep/sw.js:61)  
    Stable filenames are served cache-first forever. Forgetting to change `CACHE_VERSION` leaves stale assets, while `ignoreSearch: true` makes `app.js?v=...` match the old cached entry. GitHub Pages deployment propagation can also produce a mixed precache.  
    **Fix:** Generate a content-hashed precache manifest, use exact asset matches, and use network-first with cached fallback for navigation.

17. **Medium — New workers immediately take over old application tabs.**  
    [sw.js:24](/home/ash/src/github.com/ashwath-ramesh/jotkeep/sw.js:24), [sw.js:37](/home/ash/src/github.com/ashwath-ramesh/jotkeep/sw.js:37)  
    `skipWaiting()` plus `clients.claim()` replaces the controller without coordinating open editors. Old JavaScript can continue writing alongside a new worker/app schema.  
    **Fix:** Leave the worker waiting, notify clients that an update is ready, flush local edits, and activate/reload only after explicit acceptance or once no old clients remain.

18. **Medium — Service-worker installation failure is completely silent.**  
    [index.html:597](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:597), [sw.js:24](/home/ash/src/github.com/ashwath-ramesh/jotkeep/sw.js:24)  
    Registration errors are swallowed, and a single precache failure prevents offline readiness without any user-visible indication.  
    **Fix:** Surface offline availability status, log a privacy-safe diagnostic, and provide a retry path.

19. **Medium — Font loading can add secondary layout shift.**  
    [index.html:33](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:33), [src/styles.css:1](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/styles.css:1), [src/styles.css:448](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/styles.css:448)  
    Only the 400 face is preloaded, while the visible title/placeholder uses 600. Both faces use `font-display: swap` without fallback metric overrides.  
    **Fix:** Preload the visible 600 face, add `size-adjust`, `ascent-override`, `descent-override`, and `line-gap-override` to a matching fallback, or use `font-display: optional`.

20. **Medium — Startup loads every feature before enabling the editor.**  
    [index.html:40](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:40), [src/app.js:1](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1), [src/app.js:211](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:211)  
    The 21.7 KB stylesheet is render-blocking, and the app statically loads backup, Safety File, picker, clipboard, and find/replace code before initialization. The module script is not parser-blocking, which is good, but the UI remains inert until all modules and IndexedDB are ready.  
    **Fix:** Keep a small critical shell stylesheet, lazy-load secondary dialogs/features, and bundle/minify or module-preload the core persistence path.

21. **Medium — Mobile note selection closes the drawer after attempting to focus inert content.**  
    [src/app.js:1791](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1791), [src/app.js:1884](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:1884)  
    `showActiveNote({focus: ...})` runs while `.workspace` is still inert; then the sidebar containing the current focus is hidden. Keyboard and screen-reader focus can be lost.  
    **Fix:** Close the drawer first, remove `inert`, then focus the title/body. If focus is inside a panel being hidden during resize, explicitly move it.

22. **Medium — `role="toolbar"` does not implement toolbar keyboard behavior.**  
    [index.html:141](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:141), [src/app.js:683](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:683)  
    Menu keyboard handling exists, but the toolbar itself has no arrow-key/roving-tabindex implementation.  
    **Fix:** Implement the ARIA toolbar pattern, including arrow navigation, or remove `role="toolbar"` and let the controls behave as a normal button group.

23. **Medium — Autosave and Safety File transitions can over-announce to assistive technology.**  
    [index.html:361](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:361), [src/app.js:281](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:281)  
    Several simultaneous `role="status"` live regions can announce Saving, Saved, Pending, Writing, Backed up, storage state, and feedback in quick succession.  
    **Fix:** Use one debounced, `aria-atomic` live region for meaningful settled outcomes; keep transient visual states out of the live region.

24. **Medium — No Content Security Policy protects the note origin.**  
    [index.html:3](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:3)  
    Current rendering avoids XSS, but any future injection would expose all notes and stored file handles.  
    **Fix:** Move inline scripts to external files or hash them, then add a restrictive CSP: self-only scripts/styles/fonts/images/workers, `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'`. CSP does not solve the shared-origin GitHub Pages problem.

25. **Medium — Clock rollback can disable Safety File updates.**  
    [src/safety-file-format.js:58](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file-format.js:58), [src/safety-file-format.js:95](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/safety-file-format.js:95), [src/notes.js:95](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/notes.js:95)  
    If the system clock moves before the Safety File’s creation time, the next file is rejected because `createdAt > updatedAt`. Note modification times can also move backward and sort incorrectly.  
    **Fix:** Clamp updates monotonically against prior timestamps, while retaining a separate logical revision ID/counter for ordering.

## Low findings

26. **Low — “Clear all local data” leaves the theme preference behind.**  
    [index.html:520](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:520), [src/app.js:157](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:157), [src/storage.js:12](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/storage.js:12)  
    The dialog promises to remove preferences, but `jotkeep.theme.v1` is not among the cleared keys.  
    **Fix:** Centralize every owned key and delete the theme key explicitly. Do not use `localStorage.clear()` on a potentially shared origin.

27. **Low — The page loses its only heading when the notes panel is hidden.**  
    [index.html:52](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:52), [index.html:56](/home/ash/src/github.com/ashwath-ramesh/jotkeep/index.html:56)  
    On mobile and whenever the sidebar is closed, the sole `<h1>` leaves the accessibility tree.  
    **Fix:** Keep a stable visually hidden page-level `<h1>` outside the collapsible panel and use a lower-level heading inside it.

28. **Low — The manifest relies solely on one SVG for regular and maskable icons.**  
    [manifest.webmanifest:9](/home/ash/src/github.com/ashwath-ramesh/jotkeep/manifest.webmanifest:9), [icons/icon.svg:1](/home/ash/src/github.com/ashwath-ramesh/jotkeep/icons/icon.svg:1)  
    Platform support for SVG install icons is uneven, and the rounded/transparent artwork is not a dedicated maskable asset. The manifest also lacks an explicit stable `id` and `scope`.  
    **Fix:** Add 192×192 and 512×512 PNG icons, a full-bleed maskable variant, and explicit `id`/`scope`. Consider a dark-theme launch background strategy.

29. **Low — Note validation permits impossible timestamp ordering.**  
    [src/storage.js:47](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/storage.js:47)  
    A backup with `updatedAt < createdAt` is accepted, unlike the Safety File envelope.  
    **Fix:** Validate timestamp ordering and define a migration policy for existing malformed notes.

## Test coverage gaps

1. **Critical coverage gap — No orphaned-connection or cross-tab clear race test.**  
   [e2e/safety-file.spec.js:207](/home/ash/src/github.com/ashwath-ramesh/jotkeep/e2e/safety-file.spec.js:207), [tests/safety-file.test.js:138](/home/ash/src/github.com/ashwath-ramesh/jotkeep/tests/safety-file.test.js:138)  
   Add two-context tests that gate the connection metadata write, clear in the other tab, reload, and assert the external file is never modified. Also initialize directly with a connection and no persisted notebook.

2. **High coverage gap — No startup-input or abrupt-termination durability test.**  
   [tests/autosave.test.js:31](/home/ash/src/github.com/ashwath-ramesh/jotkeep/tests/autosave.test.js:31), [e2e/offline.spec.js:3](/home/ash/src/github.com/ashwath-ramesh/jotkeep/e2e/offline.spec.js:3)  
   Test delayed module/IndexedDB startup, typing before readiness, closing inside the debounce window, and recovery after a new context starts.

3. **High coverage gap — Import tests do not exercise input during a delayed save.**  
   [e2e/backup.spec.js:215](/home/ash/src/github.com/ashwath-ramesh/jotkeep/e2e/backup.spec.js:215)  
   The existing delayed import only races clear. Gate the IndexedDB transaction, type in the old UI during import, and verify neither note is corrupted.

4. **High coverage gap — Service-worker tests inspect strings but never execute update behavior.**  
   [tests/sw.test.js:18](/home/ash/src/github.com/ashwath-ramesh/jotkeep/tests/sw.test.js:18), [e2e/offline.spec.js:3](/home/ash/src/github.com/ashwath-ramesh/jotkeep/e2e/offline.spec.js:3)  
   Add tests for old-to-new worker activation, open clients, failed precache, query-string asset requests, navigation fallback, and an update available/reload flow.

5. **Medium coverage gap — Only desktop Chromium is configured.**  
   [playwright.config.js:14](/home/ash/src/github.com/ashwath-ramesh/jotkeep/playwright.config.js:14)  
   Add Firefox, WebKit, a mobile viewport/touch project, keyboard-only drawer/dialog/menu tests, and automated accessibility checks. Direct File System Access cases can remain Chromium-specific.

6. **Medium coverage gap — No performance or CLS regression budget exists.**  
   [src/styles.css:407](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/styles.css:407), [src/app.js:468](/home/ash/src/github.com/ashwath-ramesh/jotkeep/src/app.js:468)  
   Add a Web Vitals/Lighthouse assertion for CLS below 0.1 and a large-notebook benchmark covering typing latency, DOM size, save CPU, and memory.

7. **Medium coverage gap — No stored-XSS regression payloads.**  
   [e2e/backup.spec.js:172](/home/ash/src/github.com/ashwath-ramesh/jotkeep/e2e/backup.spec.js:172)  
   Import titles, bodies, filenames, and error text containing HTML/SVG/script payloads; assert they remain text and create no unexpected elements or requests.

8. **Medium coverage gap — Boundary failures are tested only at parsing helpers.**  
   [tests/safety-file-format.test.js:72](/home/ash/src/github.com/ashwath-ramesh/jotkeep/tests/safety-file-format.test.js:72), [tests/storage.test.js:72](/home/ash/src/github.com/ashwath-ramesh/jotkeep/tests/storage.test.js:72)  
   Add coordinator/UI tests for crossing 25 MiB, clock rollback, partial IndexedDB records, blocked upgrades, transient retry without a new edit, and divergent valid legacy data.

## Security posture that is already good

I found no stored-XSS sink for note content. Titles, bodies, previews, filenames, and validation messages use `.value`, `.textContent`, or safe property setters; there is no `innerHTML`, `eval`, or runtime third-party script. Backup imports validate format, version, types, IDs, timestamps, and size before mutation. Direct Safety File writes are closed, read back, parsed, and fingerprint-verified.

## Validation performed

- All 73 unit test cases passed.
- All source, unit, and E2E JavaScript passed syntax checks.
- Manifest and package JSON parsed successfully.
- `git diff --check` passed, and the worktree remained unchanged.
- The 22 Playwright tests were reviewed line by line but could not be executed because this read-only sandbox denied opening the local HTTP-server socket and creating Playwright’s output directory.
---

## Resolution log (2026-08-10)

All findings addressed except where noted. Full test suite: 88 unit + 28 e2e passing; Lighthouse desktop 100/100/100/100, CLS 0.

| # | Status | Resolution |
|---|--------|------------|
| 1 | Fixed | Generated fallback notebooks never auto-sync over a connected Safety File; guarded conflict state + regression tests |
| 2 | Fixed | `<main>` ships `inert aria-busy` until bootstrap completes; noscript warning; save state ships as "Loading…" |
| 3 | Fixed | Synchronous localStorage recovery journal per keystroke (≤256 KiB), reconciled at startup; beforeunload warning while dirty |
| 4 | Fixed | Legacy localStorage deleted only when it matches the stored IndexedDB notebook; divergent copies preserved |
| 5 | Not code-fixable | Shared `*.github.io` origin exposes IndexedDB to sibling projects — needs a dedicated custom domain (owner decision) |
| 6 | Fixed | Text import wraps the whole transition in `setNotebookTransitionPending` |
| 7 | Fixed (earlier) | Sidebar renders open pre-paint; CLS 0 |
| 8 | Fixed (core) | Previews now bounded to 160 characters via early-terminating scan; per-item list updates deferred with #9 |
| 9 | Deferred | Per-note mutation API for storage — larger refactor, needs its own change |
| 10 | Fixed | "Requested … download" wording; object URL revoked after 30 s |
| 11 | Fixed | Warning when the notebook approaches 20 MiB (limit 25 MiB) |
| 12 | Fixed | SHA-256 `checksum` embedded in backups and Safety Files; verified on read; legacy files without checksum still accepted |
| 13 | Acknowledged | Pre-write digest recheck already existed; true OS-level CAS is impossible with the File System Access API |
| 14 | Fixed | Distinct `too-large` failure maps to FAILED (with remediation), not EXTERNAL_CHANGE |
| 15 | Fixed | `grant()` reports success only for BACKED_UP / PENDING / WRITING outcomes |
| 16 | Partial | Exact asset matching (no ignoreSearch); manual version bump kept — content-hashed manifest needs a build step this repo deliberately avoids |
| 17 | Fixed | No unsolicited `skipWaiting`; waiting worker triggers an "Update ready — refresh" button that flushes edits first |
| 18 | Fixed | Registration/install failures surface in the status bar; "Offline ready" shown when active |
| 19 | Fixed (earlier) | 600 preload + metric-matched fallback |
| 20 | Partial | Module preload was tested and rejected (hurts mobile FCP); lazy-loading dialogs deferred with #9 |
| 21 | Fixed | Drawer closes (removing `inert`) before focus moves to the editor |
| 22 | Fixed | `role="toolbar"` → `role="group"` (no keyboard contract implied) |
| 23 | Fixed | Save/Safety File status lines are no longer live regions; settled outcomes announce via command feedback |
| 24 | Fixed | Meta CSP: self-only sources, hashed inline boot script, `object-src/base-uri/form-action 'none'`; guard test recomputes the hash |
| 25 | Fixed | Monotonic clamps in `updateNote` and `createSafetyFile` |
| 26 | Fixed | Clear-all resets the theme to system and removes `jotkeep.theme.v1` (and the recovery journal) |
| 27 | Fixed | Stable visually-hidden page `<h1>`; sidebar heading demoted to `<h2>` |
| 28 | Fixed | 192/512 PNG icons + full-bleed maskable variant; manifest `id`/`scope` |
| 29 | Fixed | Impossible note timestamps clamped on import (backups + Safety Files) with policy documented |

Test-coverage gaps: #1 (orphaned connection) and #7 (stored XSS payloads) now have regression tests; journal recovery, migration guard, checksums, TOO_LARGE, grant, clamps, and CSP hash are also covered. Gaps #2–#6, #8 (fault-injection durability, SW behavioral tests, multi-browser projects, perf budgets) remain open.
