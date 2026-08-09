# Browser Notepad

A privacy-first, browser-based plain-text editor inspired by the workflow of
[Online Notepad](https://onlinenotepad.org/). The goal is to build a fast,
install-free notepad with multiple local notes, reliable autosave, familiar
editing tools, and import/export support.

This project should reproduce useful product behavior—not the reference site's
name, copy, branding, or proprietary assets.

## Project status

Phase 1 is complete. The repository contains a modular, dependency-free
single-note application with:

- a titled, spellchecked plain-text editor;
- debounced, versioned `localStorage` persistence and legacy-draft migration;
- visible save state plus live word and character counts;
- familiar editing commands and confirmed clearing; and
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

Node.js LTS is included in the development container for the dependency-free
unit tests:

```bash
npm test
```

Opening `index.html` directly is not supported because browsers may block local
JavaScript module imports and clipboard access.

## Product principles

- **Local first:** notes stay on the device unless the user explicitly exports
  them.
- **No account required:** the core app works without sign-up, a backend, or a
  network connection.
- **Hard to lose work:** every edit is saved automatically and storage failures
  are visible to the user.
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

- [ ] Create, rename, select, and delete notes
- [ ] Show notes in a collapsible sidebar
- [ ] Search note titles and bodies as the user types
- [ ] Sort alphabetically, by creation date, or by last-modified date
- [ ] Offer compact and detailed note-list views
- [ ] Show an empty state when no note matches a search
- [ ] Keep the active note selected after reload
- [ ] Migrate the existing single-note storage value without data loss

Acceptance criteria:

- Creating a note never overwrites another note.
- Switching notes first flushes pending changes to storage.
- Search is case-insensitive and clearing it restores the full list.
- Deletion requires confirmation and selects a sensible neighboring note.
- Sorting changes presentation only; it does not mutate timestamps.

### Phase 3 — Find, replace, and insert tools

- [ ] Find the next and previous match in the active note
- [ ] Replace one match or all matches
- [ ] Support match-case and whole-word options
- [ ] Insert the current date and time at the cursor
- [ ] Insert a special character at the cursor
- [ ] Insert an emoji at the cursor
- [ ] Preserve selection and cursor position when a dialog closes

Acceptance criteria:

- Find/replace handles empty input, no matches, multiline text, and characters
  with special regular-expression meaning.
- Replace-all cannot loop forever when replacement text contains search text.
- Insertions replace selected text and otherwise occur at the caret.
- Every text-changing command participates in autosave and updates counts.

### Phase 4 — Files, backup, and printing

- [ ] Import a UTF-8 `.txt` file into a new note
- [ ] Download the active note as a `.txt` file
- [ ] Sanitize the title before using it as a filename
- [ ] Export all notes and preferences as a versioned JSON backup
- [ ] Restore a backup after validation and explicit confirmation
- [ ] Clear all local data after explicit confirmation
- [ ] Add a print view that hides application chrome
- [ ] Support saving to PDF through the browser print dialog

Acceptance criteria:

- Canceling a file picker or dialog makes no changes.
- Invalid or incompatible backups show an actionable error and import nothing.
- Restore offers a clear merge-or-replace choice and never silently discards
  existing notes.
- Exported text preserves Unicode and line breaks.
- Printed output contains the title and body, but no menus or sidebar.

### Phase 5 — View and formatting preferences

Formatting changes the editor's appearance, not the stored plain text.

- [ ] Toggle word wrap
- [ ] Toggle the status bar
- [ ] Enter and exit fullscreen mode
- [ ] Choose font family, size, weight, style, and line spacing
- [ ] Reset appearance settings to defaults
- [ ] Persist preferences independently from note content
- [ ] Add light, dark, and system color modes

Acceptance criteria:

- Preferences apply to every note and survive reload.
- Content exported as `.txt` contains no formatting markup.
- Controls remain legible and usable at 200% zoom and in both color schemes.
- Fullscreen exit remains available by keyboard and through a visible control.

### Phase 6 — Polish and offline support

- [ ] Add documented keyboard shortcuts
- [ ] Make menus operable with arrow, Enter, Escape, and Tab keys
- [ ] Add an installable web app manifest and icons
- [ ] Cache the application shell for offline use
- [ ] Warn when local storage is near or over its quota
- [ ] Add automated unit, integration, and end-to-end tests
- [ ] Test current Chrome, Firefox, Safari, and Edge releases

Acceptance criteria:

- The editor loads and existing notes remain editable while offline.
- Every icon-only action has an accessible name and visible tooltip.
- Focus is trapped inside modal dialogs and returns to the triggering control.
- No normal workflow produces an uncaught console error.

## Suggested interface

The desktop layout should have three regions:

1. **Notes panel** — create, search, sort, switch, and delete notes.
2. **Command bar** — File, Edit, Insert, Format, Tools, View, and Help actions.
3. **Editor** — title, plain-text body, save status, word count, and character
   count.

On small screens, the notes panel becomes a drawer and secondary commands move
into an overflow menu. The editor must remain usable without horizontal page
scrolling.

## Suggested data model

Use a versioned document rather than separate unstructured storage keys. A
version number makes future migrations and backup validation possible.

```json
{
  "version": 1,
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
    "listView": "detailed",
    "wordWrap": true,
    "showStatusBar": true,
    "colorMode": "system"
  }
}
```

Implementation notes:

- Generate stable IDs with `crypto.randomUUID()` and provide a fallback for
  older browsers if they are in scope.
- Store ISO 8601 UTC timestamps and format them only for display.
- Keep transient state—open menus, search terms, selections—out of persistence.
- Wrap storage reads, writes, parsing, and migrations in error handling.
- Consider IndexedDB if note volume or size outgrows `localStorage`; keep the
  storage layer behind a small adapter so that change does not affect the UI.

## Source structure

Phase 1 uses browser-native ES modules so behavior can be tested without a
framework or build step:

```text
.
├── index.html
├── src/
│   ├── app.js             # initialization and event wiring
│   ├── autosave.js        # debounce, flush, and save-state transitions
│   ├── editor.js          # selection and text-editing commands
│   ├── storage.js         # versioned persistence and legacy migration
│   └── styles.css
└── tests/
    ├── autosave.test.js
    ├── editor.test.js
    └── storage.test.js
```

Future phases can add modules for multi-note state, shortcuts, and file handling
as those features are implemented.

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
  sanitization, note sorting, backup validation, and schema migrations.
- **Integration tests:** debounced autosave, note switching, failed storage
  writes, import/export, and preference restoration.
- **End-to-end tests:** create and edit several notes, reload, search, delete,
  export a backup, clear data, restore, and print.
- **Manual checks:** keyboard-only use, screen-reader labels, touch layout, 200%
  zoom, offline reload, Unicode, very long lines, and large notes.

Before marking a phase complete, test both the successful path and cancellation,
invalid input, unavailable storage, and quota-exceeded behavior.

## Privacy and security

- Do not send note content to analytics, logging, or third-party services.
- Do not render note content as HTML; treat it as plain text to avoid script
  injection.
- Validate backup shape, version, field types, and reasonable size limits before
  importing.
- Explain that clearing site data removes locally stored notes unless the user
  exported a backup.
- If cloud sync is ever added, make it optional and update this privacy model
  before implementation.

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
