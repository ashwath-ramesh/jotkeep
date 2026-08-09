# PlainJot

A privacy-first, browser-based plain-text editor whose notes remain usable,
portable, and recoverable without requiring a PlainJot account. The long-term
product goal is a fast, install-free notepad with a user-owned **Safety File**:
an automatically updated, optionally encrypted notebook file with version
history that lives outside browser storage.

The core promise is:

> No sign-up, no lock-in, and no silent data loss when browser storage is
> cleared—as long as the user has connected or downloaded a Safety File.

## Project status

Phase 6 is complete. The repository contains a modular, runtime-dependency-free
multiple-note application with:

- a titled, spellchecked plain-text editor with a responsive notes sidebar;
- note creation, selection, renaming, confirmed deletion, search, and sorting;
- compact and detailed note-list views with a persistent active note;
- debounced, transactional IndexedDB persistence with one record per note;
- verified, lossless migration from the version 2 `localStorage` notebook and
  both earlier single-note formats;
- visible save state plus live word and character counts;
- familiar editing commands and confirmed clearing;
- literal find and replace with case and whole-word options;
- date-time, special-character, and emoji insertion tools;
- UTF-8 text import and portable active-note downloads;
- validated, versioned JSON backup with merge-or-replace recovery;
- confirmed local-data clearing and visible last-backup creation time;
- a versioned, verified `.plainjot` Safety File with automatic direct-file
  updates where supported and explicit download fallback everywhere; and
- an accessible toolbar that adapts to narrow screens.

Later phases in this README remain the implementation roadmap. Check an item
only after its behavior and acceptance criteria are complete.

## Run locally

There are no runtime dependencies or build steps. Serve the repository with any
static file server so JavaScript modules, browser storage, and clipboard APIs run
in a normal web origin.

```bash
git clone <repository-url>
cd <repository-directory>
python3 -m http.server 8080
```

Open <http://localhost:8080>.

The automated tests require Node.js 20 or newer. Install the development-only
Playwright dependency and its Chromium browser, then run both unit and browser
tests:

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

Run only the dependency-free unit tests with `npm run test:unit`.

Opening `index.html` directly is not supported because browsers may block local
JavaScript module imports and clipboard access.

## Backup and recovery

PlainJot autosaves notes to browser storage, but browser storage is **not a
backup**: clearing site data, resetting the browser profile, or removing the
browser can erase it. Use **File → Export JSON backup** to create a versioned
file containing every note, timestamp, active-note selection, and current list
preference, then keep that downloaded file somewhere outside the browser.

**Restore JSON backup** validates the entire file before changing anything.
Merge adds copies of all backup notes while keeping the current active note and
preferences; Replace explicitly replaces the current notebook and preferences.
The status-bar date records when this browser last created a JSON backup. It
does not verify that the downloaded file still exists. Clearing PlainJot data
does not delete files that were already downloaded.

Individual `.txt` files are a plain-text escape route. Opening one creates a new
note, while downloading a note exports its body without formatting markup.

## Safety Files

A Safety File is a complete, user-owned notebook stored outside browser data.
Use **File → Create Safety File** in browsers that support direct file access,
or **Download Safety File** in any browser. A connected file is updated only
after the local IndexedDB autosave succeeds. PlainJot closes the external write,
reads the file back, validates it, and compares its SHA-256 fingerprint before
showing **Backed up**.

The local-save and Safety-File states are intentionally separate. Losing file
permission, moving the file, or changing it in another program pauses automatic
updates without affecting the local notebook. **Grant Safety File access** can
restore stale permission. An external change must be resolved explicitly by
using the external notebook, overwriting it with the local notebook, or
disconnecting it. Disconnecting and clearing PlainJot site data remove the
remembered connection but never delete the external file.

Direct access requires a secure context and browser support for the File System
Access API. PlainJot detects those capabilities at runtime. Where they are not
available, opening and verifying use a normal file input and saving creates an
explicit download. A downloaded file cannot be automatically updated or proven
to remain on disk, and the interface says so before the user relies on it.

### `.plainjot` format version 1

Safety Files are UTF-8 JSON with a 25 MiB limit. The format envelope is
versioned separately from the embedded application document:

```json
{
  "format": "plainjot-safety-file",
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

`fileId` and `createdAt` remain stable for the life of a connected file;
`revisionId` and `updatedAt` change on every verified write. Each note retains
its own `createdAt` and `updatedAt` timestamps. Unknown or incompatible format
versions are rejected without importing anything. The format is unencrypted in
Phase 6; optional encryption is a separately versioned future envelope.

## Browser storage durability

PlainJot stores notes as individual records in IndexedDB. Use **File → Keep data
on this device** to ask the browser for persistent storage. A grant makes
automatic eviction less likely; it does not create an external backup and does
not prevent the user from deleting the data through browser site-data settings.
The storage status at the bottom of the editor reports whether persistence was
granted and whether storage, quota, or migration problems need attention.

## Product principles

- **Local first:** editing is fast and offline; notes leave browser storage only
  through an explicit user action.
- **No account required:** the core app works without sign-up, a backend, or a
  network connection.
- **User owned:** backups use an open, versioned format with plain-text and JSON
  escape routes.
- **Hard to lose work:** every edit is saved automatically, backup health is
  visible, and recovery is tested as carefully as saving.
- **Honest security:** distinguish browser persistence, external backup, and
  encryption; never describe one as another.
- **Keyboard friendly:** common editor operations have predictable shortcuts.
- **Focused by default:** advanced controls stay out of the writing area until
  needed.
- **Accessible and responsive:** all core actions work with a keyboard, screen
  reader, touch device, and narrow viewport.

## Feature roadmap

### Phase 1 — Reliable single-note MVP

- [x] Plain-text editing surface
- [x] Native browser spellcheck
- [x] Restore a saved draft after refresh
- [x] Debounce autosave instead of writing on every keystroke
- [x] Show save state: `Saving…`, `Saved`, or `Storage unavailable`
- [x] Add a note title and persist it with the body
- [x] Display live word and character counts
- [x] Add undo, redo, cut, copy, paste, delete, and select-all commands
- [x] Confirm before clearing a non-empty note
- [x] Add responsive toolbar and keyboard-focus styles

Acceptance criteria:

- Text and title survive refresh and reopening the browser.
- A save happens within one second of the final edit.
- An unavailable or full storage area does not break editing and produces a
  visible warning.
- Word count ignores surrounding/repeated whitespace; character count includes
  spaces and line breaks.

### Phase 2 — Multiple notes

- [x] Create, rename, select, and delete notes
- [x] Show notes in a collapsible sidebar
- [x] Search note titles and bodies as the user types
- [x] Sort alphabetically, by creation date, or by last-modified date
- [x] Offer compact and detailed note-list views
- [x] Show an empty state when no note matches a search
- [x] Keep the active note selected after reload
- [x] Migrate the existing single-note storage value without data loss

Acceptance criteria:

- Creating a note never overwrites another note.
- Switching notes first flushes pending changes to storage.
- Search is case-insensitive and clearing it restores the full list.
- Deletion requires confirmation and selects a sensible neighboring note.
- Sorting changes presentation only; it does not mutate timestamps.

### Phase 3 — Find, replace, and insert tools

- [x] Find the next and previous match in the active note
- [x] Replace one match or all matches
- [x] Support match-case and whole-word options
- [x] Insert the current date and time at the cursor
- [x] Insert a special character at the cursor
- [x] Insert an emoji at the cursor
- [x] Preserve selection and cursor position when a dialog closes

Acceptance criteria:

- Find/replace handles empty input, no matches, multiline text, and characters
  with special regular-expression meaning.
- Replace-all cannot loop forever when replacement text contains search text.
- Insertions replace selected text and otherwise occur at the caret.
- Every text-changing command participates in autosave and updates counts.

### Phase 4 — Portable backup foundation

- [x] Import a UTF-8 `.txt` file into a new note
- [x] Download the active note as a `.txt` file
- [x] Sanitize the title before using it as a filename
- [x] Export all notes and preferences as a versioned JSON backup
- [x] Restore a backup after validation and explicit confirmation
- [x] Clear all local data after explicit confirmation
- [x] Show when the most recent restorable backup was created

Acceptance criteria:

- Canceling a file picker or dialog makes no changes.
- Invalid or incompatible backups show an actionable error and import nothing.
- Restore offers a clear merge-or-replace choice and never silently discards
  existing notes.
- Exported text preserves Unicode and line breaks.
- A backup can be exported, local data cleared, and all notes restored in an
  end-to-end test.
- Backup documentation explains that browser storage is not itself a backup.

### Phase 5 — Storage architecture and browser durability

- [x] Put persistence behind a small asynchronous storage adapter
- [x] Remove direct `localStorage` access from application and UI modules
- [x] Add an IndexedDB adapter that stores notes as individual records
- [x] Migrate the version 2 `localStorage` document without data loss
- [x] Keep the old value until the migrated IndexedDB data is verified
- [x] Use transactions for multi-record changes
- [x] Request persistent browser storage after an appropriate user action
- [x] Report quota, denied-persistence, unavailable-storage, and migration
  failures without blocking editing

Acceptance criteria:

- Existing users retain every note, active-note selection, and preference after
  migration.
- An interrupted or failed migration leaves the original data recoverable.
- Updating one note does not rewrite every note.
- Failed writes never appear as successfully saved.
- The UI states that IndexedDB and persistent storage can still be removed by a
  user clearing site data.

### Phase 6 — The PlainJot Safety File

- [x] Define and document a versioned `.plainjot` notebook format
- [x] Include notes, preferences, timestamps, and format metadata
- [x] Let the user create, open, verify, and disconnect a Safety File
- [x] Automatically update a connected file after local autosave settles
- [x] Show distinct local-save and Safety-File backup states
- [x] Detect stale permissions, unavailable files, and external modifications
- [x] Fall back to explicit `.plainjot` downloads where direct file writing is
  unsupported
- [x] Preserve JSON and `.txt` export so the format never becomes a lock-in

Acceptance criteria:

- Clearing PlainJot's site data does not affect the external Safety File.
- Opening a valid Safety File on a fresh browser restores the notebook.
- PlainJot never claims a backup succeeded until the external write and
  verification succeed.
- Permission denial or revocation does not damage the local notebook.
- Browser compatibility and fallback behavior are visible before the user
  relies on automatic file updates.

### Phase 7 — Time Machine and recovery

- [ ] Store space-efficient recent, daily, and weekly notebook snapshots
- [ ] Let users preview an earlier note before restoring it
- [ ] Restore one note, a copy of one note, or the entire notebook
- [ ] Preserve the current state as a snapshot before any restore
- [ ] Add a **Test my backup** action that performs a non-destructive validation
- [ ] Show backup age and warn when no recoverable external copy exists
- [ ] Apply documented retention and size limits

Acceptance criteria:

- A deleted or overwritten note can be recovered without replacing unrelated
  current notes.
- Restoring an old version is itself reversible.
- Corrupt or incomplete snapshots are rejected without changing current data.
- Snapshot pruning is deterministic and never removes the only current state.

### Phase 8 — Optional encrypted Safety Files

- [ ] Encrypt and decrypt only in the browser
- [ ] Use authenticated encryption and a password-based key derivation design
  reviewed independently before release
- [ ] Store versioned algorithm parameters, a unique salt, and non-secret
  metadata needed to open the file
- [ ] Never store or transmit the password or derived encryption key
- [ ] Detect wrong passwords and tampered files without exposing partial data
- [ ] Provide an offline recovery-key or password-verification workflow
- [ ] Publish a plain-language threat model and format specification

Acceptance criteria:

- Note titles and bodies do not appear as plaintext in an encrypted file.
- The same file can be opened in a fresh compatible PlainJot installation with
  the correct secret.
- A wrong secret, modified ciphertext, truncated file, or unsupported format
  imports nothing.
- The UI clearly states that PlainJot cannot recover a forgotten secret.
- No custom cryptographic primitive is invented for the feature.

### Phase 9 — Everyday polish, preferences, and printing

Formatting changes the editor's appearance, not the stored plain text.

- [ ] Toggle word wrap
- [ ] Toggle the status bar
- [ ] Enter and exit fullscreen mode
- [ ] Choose font family, size, weight, style, and line spacing
- [ ] Reset appearance settings to defaults
- [ ] Persist preferences independently from note content
- [ ] Add light, dark, and system color modes
- [ ] Add documented keyboard shortcuts and a searchable command palette
- [ ] Add a print view that hides application chrome
- [ ] Support saving to PDF through the browser print dialog

Acceptance criteria:

- Preferences apply to every note and survive reload.
- Content exported as `.txt` contains no formatting markup.
- Controls remain legible and usable at 200% zoom and in both color schemes.
- Fullscreen exit remains available by keyboard and through a visible control.
- Printed output contains the title and body, but no menus or sidebar.

### Phase 10 — Installable, offline, and cross-browser

- [ ] Make menus operable with arrow, Enter, Escape, and Tab keys
- [ ] Add an installable web app manifest and icons
- [ ] Cache the application shell for offline use
- [ ] Handle application updates without discarding unsaved work
- [ ] Warn when browser or Safety File storage is near its quota
- [ ] Add automated unit, integration, and end-to-end tests
- [ ] Test current Chrome, Firefox, Safari, and Edge releases

Acceptance criteria:

- The editor loads and existing notes remain editable while offline.
- Every icon-only action has an accessible name and visible tooltip.
- Focus is trapped inside modal dialogs and returns to the triggering control.
- No normal workflow produces an uncaught console error.

### Phase 11 — Account-free device transfer

- [ ] Export an encrypted, short-lived transfer package
- [ ] Transfer via a QR code or an explicit file without exposing note content
- [ ] Require confirmation on both the sending and receiving devices
- [ ] Make replay, expiration, cancellation, and interrupted-transfer behavior
  explicit
- [ ] Keep device transfer separate from permanent synchronization

Acceptance criteria:

- A notebook can move between two devices without creating a PlainJot account.
- Transfer secrets never appear in logs, analytics, or URL query parameters.
- An expired, canceled, replayed, incomplete, or tampered transfer imports
  nothing.
- Users can always use an offline Safety File instead of a transfer service.

### Phase 12 — Launch readiness and optional hosted sync

- [ ] Create an interactive recovery demo: write, clear site data, and restore
- [ ] Publish the storage architecture, threat model, and `.plainjot` format
- [ ] Add opt-in, privacy-preserving operational metrics that never include note
  content, titles, filenames, file paths, or secrets
- [ ] Commission a security review before advertising encrypted sync
- [ ] Design optional zero-knowledge hosted sync without weakening the free,
  account-free core
- [ ] Document data export, deletion, retention, conflicts, quotas, and service
  shutdown behavior before accepting payment

Acceptance criteria:

- The launch demo accurately distinguishes local save from external backup.
- The repository contains reproducible tests for migration, corruption,
  interrupted writes, recovery, and encrypted-file compatibility.
- Core local editing, Safety Files, basic history, and data export remain usable
  without payment or an account.
- Paid services monetize hosting and convenience, never access to or recovery of
  a user's own data.

## Sustainability boundaries

PlainJot should monetize optional infrastructure and convenience, not basic data
ownership or recovery.

The free, account-free core should include local editing, import/export, a
portable Safety File, basic version history, and offline use. Potential paid
services may include hosted zero-knowledge synchronization, longer hosted
history, large encrypted attachments, shared encrypted notebooks, and priority
support. Any hosted plan must provide a complete export and a documented way to
leave without losing access to notes.

An account may be required for an optional paid service, but never to open a
local `.plainjot` file. Billing identity, synchronization identity, and notebook
encryption keys should remain separate concepts.

## Suggested interface

The desktop layout should have three regions:

1. **Notes panel** — create, search, sort, switch, and delete notes.
2. **Command bar** — File, Edit, Insert, Format, Tools, View, and Help actions.
3. **Editor** — title, plain-text body, save status, word count, and character
   count.

On small screens, the notes panel becomes a drawer and secondary commands move
into an overflow menu. The editor must remain usable without horizontal page
scrolling.

## Current data model

The version 2 document remains the canonical application and JSON-backup shape.
IndexedDB stores each note separately and keeps active-note selection,
preferences, note ordering, and backup status in metadata records. The former
version 2 `localStorage` document is read only as a migration source.

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

- Generate stable IDs with `crypto.randomUUID()` and provide a fallback for
  older browsers if they are in scope.
- Store ISO 8601 UTC timestamps and format them only for display.
- Keep transient state—open menus, search terms, selections—out of persistence.
- Wrap storage reads, writes, parsing, and migrations in error handling.
- Treat the application model, IndexedDB schema, `.plainjot` format, snapshot
  format, and encrypted envelope as separately versioned boundaries.
- Keep storage adapters independent from UI code so browser storage, a Safety
  File, and future hosted sync can share application operations without sharing
  implementation details.
- Never remove a legacy source until the new representation has been written,
  read back, and validated.

## Source structure

The application uses browser-native ES modules and has no build step. Pure
behavior uses Node's test runner; recovery workflows use Playwright:

```text
.
├── index.html
├── src/
│   ├── app.js             # initialization and event wiring
│   ├── autosave.js        # debounce, flush, and save-state transitions
│   ├── backup.js          # backup format, validation, filenames, and merge
│   ├── editor.js          # selection and text-editing commands
│   ├── find-replace.js    # literal matching and replacement helpers
│   ├── insert.js          # insertion palettes and date-time formatting
│   ├── indexeddb-storage.js # async adapter, transactions, and migration
│   ├── notes.js           # note operations, filtering, and sorting
│   ├── safety-file-format.js # .plainjot schema and validation
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
│   └── storage.test.js
└── e2e/
    ├── backup.spec.js
    ├── safety-file.spec.js
    └── storage.spec.js
```

Future phases should continue using focused modules for Safety File access,
snapshots, encryption, and device transfer rather than expanding `app.js` into
a persistence layer.

## Keyboard shortcuts to support

Use platform conventions (`Cmd` on macOS, `Ctrl` elsewhere) and do not override
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

When intercepting a browser shortcut, the app must complete the expected action
or clearly explain why it cannot.

## Testing strategy

Prioritize the paths where users could lose data:

- **Unit tests:** word counting, search matching, replace-all, filename
  sanitization, note sorting, backup validation, snapshot retention, format
  compatibility, and schema migrations.
- **Integration tests:** debounced autosave, note switching, failed storage
  writes, `localStorage` migration, file-permission changes, interrupted Safety
  File writes, import/export, encryption errors, and preference restoration.
- **End-to-end tests:** create and edit several notes, reload, search, delete,
  export a backup, clear site data, restore, connect a Safety File, recover an
  older note, and print.
- **Manual checks:** keyboard-only use, screen-reader labels, touch layout, 200%
  zoom, offline reload, cross-browser file fallbacks, Unicode, very long lines,
  and large notes.

Before marking a phase complete, test both the successful path and cancellation,
invalid input, unavailable storage, and quota-exceeded behavior.

## Privacy and security

- Do not send note content to analytics, logging, or third-party services.
- Do not render note content as HTML; treat it as plain text to avoid script
  injection.
- Validate backup shape, version, field types, and reasonable size limits before
  importing.
- Explain that clearing site data removes `localStorage`, IndexedDB, and stored
  file permissions, but not a user-owned external Safety File.
- Never place transfer or encryption secrets in query parameters, logs,
  analytics, crash reports, or telemetry.
- Treat filenames, file paths, note counts, timestamps, and backup metadata as
  potentially sensitive even when note bodies are encrypted.
- Make all networking optional for the free core. If hosted sync is added,
  publish its threat model, retention, deletion, and metadata behavior before
  implementation.

## Definition of done

A feature is complete when:

- its acceptance criteria pass;
- loading, empty, error, and cancellation states are handled;
- it works with keyboard and touch input;
- it has appropriate automated tests;
- it introduces no uncaught browser-console errors; and
- the related checkbox and documentation are updated.

## Attribution

[OnlineNotepad.org](https://onlinenotepad.org/) is used only as a product
reference. This project is an independent implementation and is not affiliated
with or endorsed by that site.
