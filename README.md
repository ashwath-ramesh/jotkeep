# JotKeep

JotKeep is a privacy-first, plain-text notepad that runs in the browser. It
needs no installation and no account. Notes stay usable, portable, and
recoverable without JotKeep. Each notebook can have a user-owned **Safety
File**: a notebook file that JotKeep updates automatically and keeps outside
browser storage. Version history and optional encryption for the Safety File
are on the roadmap.

The core promise:

> No sign-up, no lock-in, and no silent data loss when browser storage is
> cleared — if the user has connected or downloaded a Safety File.

## Contents

- [Product principles](#product-principles)
- [Run locally](#run-locally)
  - [Tests](#tests)
- [Backup and recovery](#backup-and-recovery)
- [Safety Files](#safety-files)
  - [`.jotkeep` format version 1](#jotkeep-format-version-1)
- [Browser storage durability](#browser-storage-durability)
- [Offline, installation, and theming](#offline-installation-and-theming)
- [Feature roadmap](#feature-roadmap)
  - [Phase 1 — Reliable single-note MVP](#phase-1--reliable-single-note-mvp)
  - [Phase 2 — Multiple notes](#phase-2--multiple-notes)
  - [Phase 3 — Find, replace, and insert tools](#phase-3--find-replace-and-insert-tools)
  - [Phase 4 — Portable backup foundation](#phase-4--portable-backup-foundation)
  - [Phase 5 — Storage architecture and browser durability](#phase-5--storage-architecture-and-browser-durability)
  - [Phase 6 — The JotKeep Safety File](#phase-6--the-jotkeep-safety-file)
  - [Phase 7 — Time Machine and recovery](#phase-7--time-machine-and-recovery)
  - [Phase 8 — Optional encrypted Safety Files](#phase-8--optional-encrypted-safety-files)
  - [Phase 9 — Everyday polish, preferences, and printing](#phase-9--everyday-polish-preferences-and-printing)
  - [Phase 10 — Installable, offline, and cross-browser](#phase-10--installable-offline-and-cross-browser)
  - [Phase 11 — Account-free device transfer](#phase-11--account-free-device-transfer)
  - [Phase 12 — Launch readiness and optional hosted sync](#phase-12--launch-readiness-and-optional-hosted-sync)
- [Sustainability boundaries](#sustainability-boundaries)
- [Current data model](#current-data-model)
- [Source structure](#source-structure)
- [Keyboard shortcuts to support](#keyboard-shortcuts-to-support)
- [Testing strategy](#testing-strategy)
- [Privacy and security](#privacy-and-security)
- [Definition of done](#definition-of-done)
- [Attribution](#attribution)

## Product principles

- **Local first:** editing is fast and works offline. Notes leave browser
  storage only through an explicit user action.
- **No account required:** the core application works without sign-up, a
  backend, or a network connection.
- **User owned:** backups use an open, versioned format with plain-text and
  JSON escape routes.
- **Hard to lose work:** every edit is saved automatically, backup health is
  visible, and recovery is tested as carefully as saving.
- **Honest security:** browser persistence, external backup, and encryption
  are different things. Never describe one as another.
- **Keyboard friendly:** common editor operations have predictable shortcuts.
- **Focused by default:** advanced controls stay out of the writing area
  until needed.
- **Accessible and responsive:** all core actions work with a keyboard, a
  screen reader, touch, and a narrow viewport.

## Run locally

The application has no runtime dependencies and no build step. Serve the
repository with a static file server. This gives JavaScript modules, browser
storage, and the clipboard a normal web origin.

```bash
git clone <repository-url>
cd <repository-directory>
python3 -m http.server 8080
```

Open <http://localhost:8080>.

Do not open `index.html` directly from disk. Browsers can block module
imports and clipboard access on `file://` pages.

A service worker caches the application shell on `localhost` and on HTTPS
origins. After you edit a file, the browser can serve the old cached copy.
To see your change, increase `CACHE_VERSION` in `sw.js`, or unregister the
service worker in the browser developer tools and reload.

### Tests

The tests need Node.js 20 or newer. Install the development-only Playwright
dependency, install its Chromium browser, and run the unit and browser tests:

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

Run only the dependency-free unit tests with `npm run test:unit`.

## Backup and recovery

JotKeep saves notes to browser storage automatically. Browser storage is
**not a backup**. The browser can erase it when the user clears site data,
resets the profile, or removes the browser.

Use **File → Export JSON backup** to create a versioned backup file. The file
contains every note, all timestamps, the active-note selection, and the list
preference. Keep the file outside the browser.

**Restore JSON backup** validates the full file before it changes anything.
Merge adds copies of all backup notes and keeps the current active note and
preferences. Replace replaces the current notebook and preferences. The date
in the status bar shows when this browser last created a JSON backup. It does
not show that the file still exists. When the user clears JotKeep data, files
that were already downloaded stay on disk.

Single `.txt` files are a plain-text escape route. An opened `.txt` file
becomes a new note. A downloaded note contains only the note body, without
formatting markup.

## Safety Files

A Safety File is a complete, user-owned notebook file outside browser data.
Use **File → Create Safety File** in browsers that support direct file
access. Use **Download Safety File** in all other browsers.

JotKeep updates a connected file only after the local IndexedDB save
succeeds. It then closes the write, reads the file back, validates it, and
compares its SHA-256 fingerprint. Only then does it show **Backed up**.

The local-save state and the Safety-File state are separate. When file
permission is lost, the file moves, or another program changes the file,
JotKeep pauses automatic updates. The local notebook is not changed. **Grant
Safety File access** restores stale permission.

The user must resolve an external change explicitly: use the external
notebook, overwrite it with the local notebook, or disconnect it.
Disconnecting or clearing JotKeep site data removes the remembered
connection. It never deletes the external file.

Direct file access needs a secure context and browser support for the File
System Access API. JotKeep detects these capabilities at runtime. Without
direct access, open and verify use a normal file input, and save creates a
download. JotKeep cannot update a downloaded file automatically and cannot
prove that it stays on disk. The interface says this before the user relies
on it.

### `.jotkeep` format version 1

A Safety File is UTF-8 JSON with a 25 MiB limit. The format envelope has its
own version, separate from the embedded application document:

```json
{
  "format": "jotkeep-safety-file",
  "version": 1,
  "fileId": "stable-file-id",
  "revisionId": "new-id-for-each-write",
  "createdAt": "2026-08-09T12:00:00.000Z",
  "updatedAt": "2026-08-09T12:30:00.000Z",
  "document": {
    "version": 2,
    "activeNoteId": "note_123",
    "notes": [
      {
        "id": "note_123",
        "title": "Untitled Note",
        "content": "",
        "createdAt": "2026-08-09T12:00:00.000Z",
        "updatedAt": "2026-08-09T12:30:00.000Z"
      }
    ],
    "preferences": {
      "sortBy": "updatedAt",
      "listView": "detailed"
    }
  }
}
```

`fileId` and `createdAt` stay stable for the life of a connected file.
`revisionId` and `updatedAt` change on each verified write. Each note keeps
its own `createdAt` and `updatedAt` timestamps. JotKeep rejects unknown or
incompatible format versions and imports nothing. The format is unencrypted
in Phase 6. Optional encryption is a future envelope with its own version.

## Browser storage durability

JotKeep stores each note as one record in IndexedDB. Use **File → Keep data
on this device** to request persistent storage from the browser. A grant
makes automatic eviction less likely. It does not create an external backup,
and the user can still delete the data in the browser's site-data settings.
The storage status at the bottom of the editor shows whether persistence was
granted and reports storage, quota, and migration problems.

## Offline, installation, and theming

- A service worker (`sw.js`) caches every application file when the page
  first loads. Later visits load from the cache first, so the app opens
  immediately and works without a network connection.
- The cache name comes from the `CACHE_VERSION` constant in `sw.js`.
  Increase the constant when any cached file changes. The unit test
  `tests/sw.test.js` fails if a shipped file is missing from the cache list.
- `manifest.webmanifest` and `icons/icon.svg` make the app installable.
- The design system behind the interface is documented in
  [DESIGN.md](DESIGN.md).
- The interface has a light theme and a dark theme. By default the browser
  selects one with the `prefers-color-scheme` media query. The toggle in the
  title bar overrides this with a fixed light or dark theme. The choice is
  stored in `localStorage` in this browser only.
- The editor uses the Newsreader typeface. The two subsetted font files
  (about 46 KB in total) are served from the `fonts/` directory in this
  repository. The app requests no file from any other origin.

## Feature roadmap

### Phase 1 — Reliable single-note MVP

- [x] Plain-text editing surface
- [x] Native browser spellcheck
- [x] Restore a saved draft after refresh
- [x] Debounce autosave instead of a write on each keystroke
- [x] Show the save state: `Saving…`, `Saved`, or `Storage unavailable`
- [x] Add a note title and persist it with the body
- [x] Show live word and character counts
- [x] Add undo, redo, cut, copy, paste, delete, and select-all commands
- [x] Confirm before a non-empty note is cleared
- [x] Add a responsive toolbar and keyboard-focus styles

Acceptance criteria:

- The text and the title survive a refresh and a browser restart.
- A save occurs less than one second after the last edit.
- Unavailable or full storage does not break editing and shows a visible
  warning.
- The word count ignores extra whitespace. The character count includes
  spaces and line breaks.

### Phase 2 — Multiple notes

- [x] Create, rename, select, and delete notes
- [x] Show notes in a collapsible sidebar
- [x] Search note titles and bodies as the user types
- [x] Sort alphabetically, by creation date, or by last-modified date
- [x] Offer compact and detailed note-list views
- [x] Show an empty state when no note matches a search
- [x] Keep the active note selected after a reload
- [x] Migrate the existing single-note storage value without data loss

Acceptance criteria:

- A new note never overwrites another note.
- A note switch first flushes pending changes to storage.
- Search is case-insensitive. A cleared search restores the full list.
- Deletion needs confirmation and selects a sensible neighboring note.
- Sorting changes only the presentation. It does not change timestamps.

### Phase 3 — Find, replace, and insert tools

- [x] Find the next and previous match in the active note
- [x] Replace one match or all matches
- [x] Support match-case and whole-word options
- [x] Insert the current date and time at the cursor
- [x] Insert a special character at the cursor
- [x] Insert an emoji at the cursor
- [x] Keep the selection and cursor position when a dialog closes

Acceptance criteria:

- Find and replace handle empty input, no matches, multiline text, and
  characters with special regular-expression meaning.
- Replace-all cannot loop forever when the replacement text contains the
  search text.
- An insertion replaces the selected text or occurs at the caret.
- Each text-changing command starts autosave and updates the counts.

### Phase 4 — Portable backup foundation

- [x] Import a UTF-8 `.txt` file into a new note
- [x] Download the active note as a `.txt` file
- [x] Sanitize the title before its use as a filename
- [x] Export all notes and preferences as a versioned JSON backup
- [x] Restore a backup after validation and explicit confirmation
- [x] Clear all local data after explicit confirmation
- [x] Show when the most recent restorable backup was created

Acceptance criteria:

- A canceled file picker or dialog makes no changes.
- An invalid or incompatible backup shows an actionable error and imports
  nothing.
- Restore gives a clear merge-or-replace choice and never silently discards
  existing notes.
- Exported text keeps Unicode and line breaks.
- An end-to-end test exports a backup, clears local data, and restores all
  notes.
- The backup documentation says that browser storage is not a backup.

### Phase 5 — Storage architecture and browser durability

- [x] Put persistence behind a small asynchronous storage adapter
- [x] Remove direct `localStorage` access from application and UI modules
- [x] Add an IndexedDB adapter that stores each note as one record
- [x] Migrate the version 2 `localStorage` document without data loss
- [x] Keep the old value until the migrated IndexedDB data is verified
- [x] Use transactions for multi-record changes
- [x] Request persistent browser storage after an applicable user action
- [x] Report quota, denied-persistence, unavailable-storage, and migration
  failures and do not block editing

Acceptance criteria:

- After migration, existing users keep every note, the active-note
  selection, and all preferences.
- An interrupted or failed migration keeps the original data recoverable.
- An update to one note does not rewrite every note.
- A failed write never shows as saved.
- The UI says that a user who clears site data also removes IndexedDB and
  persistent storage.

### Phase 6 — The JotKeep Safety File

- [x] Define and document a versioned `.jotkeep` notebook format
- [x] Include notes, preferences, timestamps, and format metadata
- [x] Let the user create, open, verify, and disconnect a Safety File
- [x] Update a connected file automatically after the local autosave settles
- [x] Show separate local-save and Safety-File backup states
- [x] Detect stale permissions, unavailable files, and external changes
- [x] Fall back to explicit `.jotkeep` downloads where the browser cannot
  write files directly
- [x] Keep JSON and `.txt` export so the format never becomes a lock-in

Acceptance criteria:

- Cleared JotKeep site data does not change the external Safety File.
- A valid Safety File restores the notebook in a fresh browser.
- JotKeep claims a backup only after the external write and its verification
  succeed.
- Permission denial or revocation does not damage the local notebook.
- The UI shows browser compatibility and fallback behavior before the user
  relies on automatic updates.

### Phase 7 — Time Machine and recovery

- [ ] Store space-efficient recent, daily, and weekly notebook snapshots
- [ ] Let the user preview an earlier note before a restore
- [ ] Restore one note, a copy of one note, or the full notebook
- [ ] Keep the current state as a snapshot before each restore
- [ ] Add a **Test my backup** action that does a non-destructive validation
- [ ] Show the backup age and warn when no recoverable external copy exists
- [ ] Apply documented retention and size limits

Acceptance criteria:

- A deleted or overwritten note can be recovered without a change to
  unrelated current notes.
- A restore of an old version is itself reversible.
- A corrupt or incomplete snapshot is rejected and current data is not
  changed.
- Snapshot pruning is deterministic and never removes the only current
  state.

### Phase 8 — Optional encrypted Safety Files

- [ ] Encrypt and decrypt only in the browser
- [ ] Use authenticated encryption and a password-based key derivation
  design with an independent review before release
- [ ] Store versioned algorithm parameters, a unique salt, and the
  non-secret metadata needed to open the file
- [ ] Never store or transmit the password or the derived encryption key
- [ ] Detect wrong passwords and changed files and do not expose partial
  data
- [ ] Provide an offline recovery-key or password-verification workflow
- [ ] Publish a plain-language threat model and format specification

Acceptance criteria:

- Note titles and bodies do not appear as plaintext in an encrypted file.
- The same file opens in a fresh compatible JotKeep installation with the
  correct secret.
- A wrong secret, changed ciphertext, truncated file, or unsupported format
  imports nothing.
- The UI says that JotKeep cannot recover a forgotten secret.
- The feature does not invent a custom cryptographic primitive.

### Phase 9 — Everyday polish, preferences, and printing

Formatting changes the appearance of the editor, not the stored plain text.

- [ ] Toggle word wrap
- [ ] Toggle the status bar
- [ ] Enter and exit fullscreen mode
- [ ] Choose the font family, size, weight, style, and line spacing
- [ ] Reset appearance settings to the defaults
- [ ] Persist preferences separately from note content
- [ ] Add light, dark, and system color modes
- [ ] Add documented keyboard shortcuts and a searchable command palette
- [ ] Add a print view that hides the application chrome
- [ ] Support save to PDF through the browser print dialog

Acceptance criteria:

- Preferences apply to every note and survive a reload.
- Content exported as `.txt` contains no formatting markup.
- Controls stay legible and usable at 200% zoom and in both color schemes.
- Fullscreen exit stays available with the keyboard and a visible control.
- Printed output contains the title and the body, but no menus or sidebar.

### Phase 10 — Installable, offline, and cross-browser

- [ ] Make menus operable with the arrow, Enter, Escape, and Tab keys
- [x] Add an installable web app manifest and icons
- [x] Cache the application shell for offline use
- [ ] Apply application updates without loss of unsaved work
- [ ] Warn when browser or Safety File storage is near its quota
- [ ] Add automated unit, integration, and end-to-end tests
- [ ] Test the current Chrome, Firefox, Safari, and Edge releases

Acceptance criteria:

- The editor loads offline and existing notes stay editable.
- Each icon-only action has an accessible name and a visible tooltip.
- Focus stays in a modal dialog and returns to the control that opened it.
- No normal workflow causes an uncaught console error.

### Phase 11 — Account-free device transfer

- [ ] Export an encrypted, short-lived transfer package
- [ ] Transfer with a QR code or an explicit file and do not expose note
  content
- [ ] Require confirmation on the sending device and on the receiving device
- [ ] Make replay, expiration, cancellation, and interrupted-transfer
  behavior explicit
- [ ] Keep device transfer separate from permanent synchronization

Acceptance criteria:

- A notebook can move between two devices without a JotKeep account.
- Transfer secrets never appear in logs, analytics, or URL query parameters.
- An expired, canceled, replayed, incomplete, or changed transfer imports
  nothing.
- The user can always use an offline Safety File instead of a transfer
  service.

### Phase 12 — Launch readiness and optional hosted sync

- [ ] Create an interactive recovery demo: write, clear site data, and
  restore
- [ ] Publish the storage architecture, the threat model, and the `.jotkeep`
  format
- [ ] Add opt-in, privacy-preserving metrics that never include note
  content, titles, filenames, file paths, or secrets
- [ ] Commission a security review before encrypted sync is advertised
- [ ] Design optional zero-knowledge hosted sync that does not weaken the
  free, account-free core
- [ ] Document export, deletion, retention, conflicts, quotas, and service
  shutdown behavior before payment is accepted

Acceptance criteria:

- The launch demo correctly separates local save from external backup.
- The repository contains reproducible tests for migration, corruption,
  interrupted writes, recovery, and encrypted-file compatibility.
- Core local editing, Safety Files, basic history, and data export stay
  usable without payment or an account.
- Paid services monetize hosting and convenience, never access to or
  recovery of a user's own data.

## Sustainability boundaries

JotKeep monetizes optional infrastructure and convenience, not basic data
ownership or recovery.

The free, account-free core includes local editing, import and export, a
portable Safety File, basic version history, and offline use. Possible paid
services include hosted zero-knowledge synchronization, longer hosted
history, large encrypted attachments, shared encrypted notebooks, and
priority support. Each hosted plan must give a complete export and a
documented way to leave without loss of access to notes.

A paid service can require an account. A local `.jotkeep` file never
requires an account. Billing identity, synchronization identity, and
notebook encryption keys stay separate concepts.

## Current data model

The version 2 document is the canonical shape for the application and the
JSON backup. IndexedDB stores each note as one record. Metadata records keep
the active-note selection, preferences, note order, and backup status. The
old version 2 `localStorage` document is only a migration source.

```json
{
  "version": 2,
  "activeNoteId": "note_123",
  "notes": [
    {
      "id": "note_123",
      "title": "Untitled Note",
      "content": "",
      "createdAt": "2026-08-09T12:00:00.000Z",
      "updatedAt": "2026-08-09T12:00:00.000Z"
    }
  ],
  "preferences": {
    "sortBy": "updatedAt",
    "listView": "detailed"
  }
}
```

Implementation notes:

- Generate stable IDs with `crypto.randomUUID()` and add a fallback for
  older browsers if they are in scope.
- Store ISO 8601 UTC timestamps and format them only for display.
- Keep transient state — open menus, search terms, selections — out of
  persistence.
- Wrap storage reads, writes, parsing, and migrations in error handling.
- Version these boundaries separately: the application model, the IndexedDB
  schema, the `.jotkeep` format, the snapshot format, and the encrypted
  envelope.
- Keep storage adapters separate from UI code. Browser storage, a Safety
  File, and future hosted sync then share application operations, not
  implementation details.
- Never remove a legacy source before the new representation is written,
  read back, and validated.

## Source structure

The application uses browser-native ES modules and has no build step. Pure
behavior uses the Node test runner. Recovery workflows use Playwright:

```text
.
├── index.html
├── DESIGN.md              # design-system intent behind the CSS tokens
├── sw.js                  # service worker: application-shell precache
├── manifest.webmanifest
├── icons/
│   └── icon.svg
├── fonts/                 # subsetted Newsreader files, licensed under the OFL
│   ├── newsreader-latin-400.woff2
│   ├── newsreader-latin-600.woff2
│   └── OFL.txt
├── src/
│   ├── app.js             # initialization and event wiring
│   ├── autosave.js        # debounce, flush, and save-state transitions
│   ├── backup.js          # backup format, validation, filenames, and merge
│   ├── editor.js          # selection and text-editing commands
│   ├── find-replace.js    # literal matching and replacement helpers
│   ├── insert.js          # insertion palettes and date-time formatting
│   ├── indexeddb-storage.js # async adapter, transactions, and migration
│   ├── notes.js           # note operations, filtering, and sorting
│   ├── safety-file-format.js # .jotkeep schema and validation
│   ├── safety-file.js     # file access, verification, sync, and conflicts
│   ├── storage.js         # document validation and legacy format helpers
│   └── styles.css
├── tests/
│   ├── autosave.test.js
│   ├── backup.test.js
│   ├── editor.test.js
│   ├── find-replace.test.js
│   ├── insert.test.js
│   ├── notes.test.js
│   ├── safety-file-format.test.js
│   ├── safety-file.test.js
│   ├── storage.test.js
│   └── sw.test.js
└── e2e/
    ├── backup.spec.js
    ├── offline.spec.js
    ├── safety-file.spec.js
    └── storage.spec.js
```

Future phases must continue to use focused modules for Safety File access,
snapshots, encryption, and device transfer. Do not turn `app.js` into a
persistence layer.

## Keyboard shortcuts to support

Use platform conventions (`Cmd` on macOS, `Ctrl` elsewhere). Do not override
browser or assistive-technology shortcuts unnecessarily.

| Action | Shortcut |
| --- | --- |
| New note | `Cmd/Ctrl + N` |
| Open text file | `Cmd/Ctrl + O` |
| Download note | `Cmd/Ctrl + S` |
| Print | `Cmd/Ctrl + P` |
| Undo / redo | `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` |
| Find | `Cmd/Ctrl + F` |
| Find and replace | `Cmd/Ctrl + H` |
| Select all | `Cmd/Ctrl + A` |
| Fullscreen | `F11` only when it does not conflict with the browser |
| Close dialog or menu | `Escape` |

When the application intercepts a browser shortcut, it must complete the
expected action or explain why it cannot.

## Testing strategy

Give priority to the paths where users can lose data:

- **Unit tests:** word counts, search matches, replace-all, filename
  sanitization, note sorting, backup validation, snapshot retention, format
  compatibility, schema migrations, and the service-worker cache list.
- **Integration tests:** debounced autosave, note switches, failed storage
  writes, `localStorage` migration, file-permission changes, interrupted
  Safety File writes, import and export, encryption errors, and preference
  restoration.
- **End-to-end tests:** create and edit notes, reload, search, delete,
  export a backup, clear site data, restore, connect a Safety File, recover
  an older note, offline reload, and print.
- **Manual checks:** keyboard-only use, screen-reader labels, touch layout,
  200% zoom, cross-browser file fallbacks, Unicode, very long lines, and
  large notes.

Before a phase is marked complete, test the successful path and also
cancellation, invalid input, unavailable storage, and quota-exceeded
behavior.

## Privacy and security

- Do not send note content to analytics, logs, or third-party services.
- Serve all assets, including fonts, from this repository. The app must not
  request files from another origin.
- Do not render note content as HTML. Treat it as plain text to prevent
  script injection.
- Validate the backup shape, version, field types, and size limits before an
  import.
- Explain that cleared site data removes `localStorage`, IndexedDB, and
  stored file permissions, but not a user-owned external Safety File.
- Never put transfer or encryption secrets in query parameters, logs,
  analytics, crash reports, or telemetry.
- Treat filenames, file paths, note counts, timestamps, and backup metadata
  as sensitive, even when note bodies are encrypted.
- Keep all networking optional for the free core. Before hosted sync is
  implemented, publish its threat model, retention, deletion, and metadata
  behavior.

## Definition of done

A feature is complete when:

- its acceptance criteria pass;
- loading, empty, error, and cancellation states are handled;
- it works with keyboard and touch input;
- it has applicable automated tests;
- it causes no uncaught browser-console errors; and
- the related checkbox and documentation are updated.

## Attribution

The Newsreader typeface is copyright The Newsreader Project Authors and is
used under the [SIL Open Font License, Version 1.1](fonts/OFL.txt).

[OnlineNotepad.org](https://onlinenotepad.org/) is only a product reference.
This project is an independent implementation. It has no affiliation with
and no endorsement from that site.
