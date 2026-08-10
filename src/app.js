import { createAutosave, SAVE_STATES } from "./autosave.js";
import {
  MAX_BACKUP_BYTES,
  backupFilename,
  createBackup,
  decodeUtf8,
  mergeBackupDocument,
  parseBackup,
  sanitizeFilename,
  serializeBackup,
  titleFromTextFilename,
} from "./backup.js";
import { clearEditor, countText, createEditorCommands } from "./editor.js";
import {
  currentMatchIndex,
  findAdjacentMatch,
  findMatches,
  replaceAllLiteral,
} from "./find-replace.js";
import {
  EMOJI,
  SPECIAL_CHARACTERS,
  formatCurrentDateTime,
} from "./insert.js";
import {
  LIST_VIEWS,
  addNote,
  chooseNeighborNoteId,
  deleteNote,
  displayNoteTitle,
  filterNotes,
  notePreview,
  setActiveNote,
  sortNotes,
  updateNote,
  updatePreferences,
} from "./notes.js";
import {
  createNotesDocument,
} from "./storage.js";
import {
  PERSISTENCE_STATES,
  STORAGE_FAILURES,
  createBrowserStorageService,
} from "./indexeddb-storage.js";
import {
  createSafetyFile,
  safetyFileFilename,
  serializeSafetyFile,
} from "./safety-file-format.js";
import {
  SAFETY_FILE_STATES,
  createSafetyFileCoordinator,
  readSafetyFile,
  readSafetyFileHandle,
  supportsDirectSafetyFiles,
} from "./safety-file.js";

const AUTOSAVE_DELAY_MS = 500;
const MOBILE_BREAKPOINT = "(max-width: 48rem)";
const TOOLBAR_BREAKPOINT = "(max-width: 68rem)";
const SAFETY_PILL_LABELS = Object.freeze({
  [SAFETY_FILE_STATES.MANUAL_ONLY]: "Manual backups",
  [SAFETY_FILE_STATES.PENDING]: "Pending",
  [SAFETY_FILE_STATES.WRITING]: "Backing up…",
  [SAFETY_FILE_STATES.BACKED_UP]: "Backed up",
  [SAFETY_FILE_STATES.NEEDS_PERMISSION]: "Permission needed",
  [SAFETY_FILE_STATES.UNAVAILABLE]: "File unavailable",
  [SAFETY_FILE_STATES.EXTERNAL_CHANGE]: "Changed on disk",
  [SAFETY_FILE_STATES.FAILED]: "Backup failed",
});

const titleInput = document.querySelector("#note-title");
const note = document.querySelector("#note");
const saveState = document.querySelector("#save-state");
const safetyFileStatus = document.querySelector("#safety-file-status");
const safetyFilePill = document.querySelector("#safety-file-pill");
const noteCountFooter = document.querySelector("#note-count-footer");
const commandFeedback = document.querySelector("#command-feedback");
const wordCount = document.querySelector("#word-count");
const characterCount = document.querySelector("#character-count");
const backupStatus = document.querySelector("#backup-status");
const storageStatus = document.querySelector("#storage-status");
const moreButton = document.querySelector("#more-commands");
const commandMenu = document.querySelector("#command-menu");
const overflow = document.querySelector(".overflow");
const insertButton = document.querySelector("#insert-button");
const insertMenu = document.querySelector("#insert-menu");
const insertPopup = insertButton.closest(".toolbar-popup");
const fileButton = document.querySelector("#file-button");
const fileMenu = document.querySelector("#file-menu");
const filePopup = fileButton.closest(".toolbar-popup");
const sidebar = document.querySelector("#notes-sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const newNoteButton = document.querySelector("#new-note");
const searchInput = document.querySelector("#note-search");
const sortSelect = document.querySelector("#note-sort");
const listViewSelect = document.querySelector("#note-list-view");
const notesList = document.querySelector("#notes-list");
const notesEmptyState = document.querySelector("#notes-empty-state");
const workspace = document.querySelector(".workspace");
const findDialog = document.querySelector("#find-dialog");
const findDialogTitle = document.querySelector("#find-dialog-title");
const findQuery = document.querySelector("#find-query");
const replaceFields = document.querySelector("#replace-fields");
const replaceValue = document.querySelector("#replace-value");
const matchCase = document.querySelector("#match-case");
const wholeWord = document.querySelector("#whole-word");
const findStatus = document.querySelector("#find-status");
const findModeToggle = document.querySelector("#find-mode-toggle");
const findPreviousButton = document.querySelector("#find-previous");
const findNextButton = document.querySelector("#find-next");
const replaceOneButton = document.querySelector("#replace-one");
const replaceAllButton = document.querySelector("#replace-all");
const pickerDialog = document.querySelector("#picker-dialog");
const pickerDialogTitle = document.querySelector("#picker-dialog-title");
const characterGrid = document.querySelector("#character-grid");
const textFileInput = document.querySelector("#text-file-input");
const backupFileInput = document.querySelector("#backup-file-input");
const safetyFileInput = document.querySelector("#safety-file-input");
const restoreDialog = document.querySelector("#restore-dialog");
const restoreSummary = document.querySelector("#restore-summary");
const restoreError = document.querySelector("#restore-error");
const restoreOptions = document.querySelector("#restore-options");
const restoreChooseFile = document.querySelector("#restore-choose-file");
const restoreCancel = document.querySelector("#restore-cancel");
const restoreDialogClose = document.querySelector("#restore-dialog-close");
const restoreConfirm = document.querySelector("#restore-confirm");
const clearDataDialog = document.querySelector("#clear-data-dialog");
const clearDataSummary = document.querySelector("#clear-data-summary");
const clearDataError = document.querySelector("#clear-data-error");
const clearDataCancel = document.querySelector("#clear-data-cancel");
const clearDataDialogClose = document.querySelector("#clear-data-dialog-close");
const clearDataConfirm = document.querySelector("#clear-data-confirm");
const safetyOpenDialog = document.querySelector("#safety-open-dialog");
const safetyOpenSummary = document.querySelector("#safety-open-summary");
const safetyOpenError = document.querySelector("#safety-open-error");
const safetyOpenOptions = document.querySelector("#safety-open-options");
const safetyOpenConfirm = document.querySelector("#safety-open-confirm");
const safetyOpenCancel = document.querySelector("#safety-open-cancel");
const safetyOpenClose = document.querySelector("#safety-open-close");
const safetyConflictDialog = document.querySelector("#safety-conflict-dialog");
const safetyConflictError = document.querySelector("#safety-conflict-error");
const safetyConflictClose = document.querySelector("#safety-conflict-close");
const safetyConflictCancel = document.querySelector("#safety-conflict-cancel");
const safetyConflictDisconnect = document.querySelector("#safety-conflict-disconnect");
const safetyUseFile = document.querySelector("#safety-use-file");
const safetyOverwriteFile = document.querySelector("#safety-overwrite-file");
const narrowLayout = window.matchMedia(MOBILE_BREAKPOINT);
const compactToolbar = window.matchMedia(TOOLBAR_BREAKPOINT);
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const THEME_STORAGE_KEY = "jotkeep.theme.v1";
const THEME_SEQUENCE = ["auto", "light", "dark"];
const THEME_ICONS = Object.freeze({ auto: "◐", light: "☀", dark: "☾" });
const THEME_LABELS = Object.freeze({
  auto: "System theme",
  light: "Light theme",
  dark: "Dark theme",
});
const themeToggle = document.querySelector("#theme-toggle");
const themeColorMetas = document.querySelectorAll('meta[name="theme-color"]');

function currentTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return "auto";
  }
  return stored === "light" || stored === "dark" ? stored : "auto";
}

function applyTheme(mode) {
  if (mode === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
  try {
    if (mode === "auto") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    /* The theme still applies for this visit. */
  }
  const next =
    THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(mode) + 1) % THEME_SEQUENCE.length];
  const label = `${THEME_LABELS[mode]}. Switch to ${THEME_LABELS[next].toLowerCase()}`;
  themeToggle.textContent = THEME_ICONS[mode];
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
  for (const meta of themeColorMetas) {
    const dark = mode === "auto" ? meta.media.includes("dark") : mode === "dark";
    meta.content = dark ? "#17150f" : "#f7f5f1";
  }
}

themeToggle.addEventListener("click", () => {
  const sequenceIndex = THEME_SEQUENCE.indexOf(currentTheme());
  applyTheme(THEME_SEQUENCE[(sequenceIndex + 1) % THEME_SEQUENCE.length]);
});
applyTheme(currentTheme());

workspace.inert = true;
workspace.setAttribute("aria-busy", "true");
const storageService = createBrowserStorageService();
const loadedNotes = await storageService.initialize();
let notesDocument = loadedNotes.document;
let canSafelySave = loadedNotes.canSafelySave;
let lastBackupMetadata = loadedNotes.lastBackupMetadata;
let storageIssue = loadedNotes.error;
let persistenceState = loadedNotes.persistenceState;
let editorCommands;
let sidebarOpen = !narrowLayout.matches;
let findReplaceMode = false;
let pickerSelection = null;
let ignoredFindCloseEvents = 0;
let ignoredPickerCloseEvents = 0;
let pendingBackup = null;
let backupReadGeneration = 0;
let textImportGeneration = 0;
let restoreReturnFocus = null;
let clearDataReturnFocus = null;
let notebookTransitionPending = false;
let safetyState = null;
let pendingSafetyFile = null;
let safetyFileInputMode = "open";

const directSafetyFilesSupported = supportsDirectSafetyFiles(window);
const safetyCoordinator = createSafetyFileCoordinator({
  storageService,
  initialConnection: loadedNotes.safetyFileConnection,
  directSupported: directSafetyFilesSupported,
  onStateChange: (state) => {
    safetyState = state;
    renderSafetyFileStatus();
  },
});

function setNotebookTransitionPending(pending) {
  notebookTransitionPending = pending;
  titleInput.disabled = pending;
  note.disabled = pending;
  newNoteButton.disabled = pending;
  sortSelect.disabled = pending;
  listViewSelect.disabled = pending;
  notesList.inert = pending;
}

function activeNote() {
  return notesDocument.notes.find(
    (savedNote) => savedNote.id === notesDocument.activeNoteId,
  );
}

function pluralizedCount(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function updateCounts() {
  const counts = countText(note.value);
  wordCount.textContent = pluralizedCount(counts.words, "word", "words");
  characterCount.textContent = pluralizedCount(
    counts.characters,
    "character",
    "characters",
  );
}

function setCommandFeedback(message) {
  commandFeedback.textContent = message;
}

function renderSafetyFileStatus() {
  if (!safetyState) {
    return;
  }
  const name = safetyState.fileName ? ` “${safetyState.fileName}”` : "";
  let message;
  switch (safetyState.kind) {
    case SAFETY_FILE_STATES.MANUAL_ONLY:
      message = "Safety File: Automatic updates unavailable—download manually";
      break;
    case SAFETY_FILE_STATES.PENDING:
      message = `Safety File${name}: Waiting for local save`;
      break;
    case SAFETY_FILE_STATES.WRITING:
      message = `Safety File${name}: Backing up…`;
      break;
    case SAFETY_FILE_STATES.BACKED_UP:
      message = `Safety File${name}: Backed up`;
      if (safetyState.verifiedAt) {
        message += ` ${timestampFormatter.format(new Date(safetyState.verifiedAt))}`;
      }
      if (safetyState.connectionRemembered === false) {
        message += "; connection not remembered";
      }
      break;
    case SAFETY_FILE_STATES.NEEDS_PERMISSION:
      message = `Safety File${name}: Permission needed`;
      break;
    case SAFETY_FILE_STATES.UNAVAILABLE:
      message = `Safety File${name}: File unavailable`;
      break;
    case SAFETY_FILE_STATES.EXTERNAL_CHANGE:
      message = `Safety File${name}: Changed outside JotKeep`;
      break;
    case SAFETY_FILE_STATES.FAILED:
      message = `Safety File${name}: Backup failed; local copy is safe`;
      break;
    default:
      message = "Safety File: Not connected";
      break;
  }
  safetyFileStatus.textContent = message;
  safetyFileStatus.title = safetyState.error?.message ?? message;

  const tone =
    safetyState.kind === SAFETY_FILE_STATES.BACKED_UP
      ? "success"
      : [
            SAFETY_FILE_STATES.NEEDS_PERMISSION,
            SAFETY_FILE_STATES.UNAVAILABLE,
            SAFETY_FILE_STATES.EXTERNAL_CHANGE,
            SAFETY_FILE_STATES.FAILED,
          ].includes(safetyState.kind)
        ? "warning"
        : "neutral";
  safetyFileStatus.dataset.tone = tone;
  safetyFilePill.dataset.tone = tone;
  safetyFilePill.textContent = SAFETY_PILL_LABELS[safetyState.kind]
    ? `Safety File · ${SAFETY_PILL_LABELS[safetyState.kind]}`
    : "";
  safetyFilePill.hidden = !SAFETY_PILL_LABELS[safetyState.kind];

  for (const button of document.querySelectorAll('[data-file-action="create-safety"]')) {
    button.hidden = !directSafetyFilesSupported;
  }
  for (const button of document.querySelectorAll('[data-file-action="grant-safety"]')) {
    button.hidden = safetyState.kind !== SAFETY_FILE_STATES.NEEDS_PERMISSION;
  }
  for (const button of document.querySelectorAll('[data-file-action="resolve-safety"]')) {
    button.hidden = safetyState.kind !== SAFETY_FILE_STATES.EXTERNAL_CHANGE;
  }
  for (const button of document.querySelectorAll('[data-file-action="disconnect-safety"]')) {
    button.hidden = safetyCoordinator.getConnection() === null;
  }
}

function renderBackupStatus() {
  if (lastBackupMetadata === null) {
    backupStatus.textContent = "No JSON backup created in this browser";
    backupStatus.removeAttribute("title");
    return;
  }

  const created = new Date(lastBackupMetadata.createdAt);
  backupStatus.textContent = `Last JSON backup created ${timestampFormatter.format(created)}`;
  backupStatus.title = lastBackupMetadata.createdAt;
}

function renderStorageStatus() {
  let message;

  if (storageIssue?.kind === STORAGE_FAILURES.QUOTA) {
    message = "Browser storage is full; unsaved edits remain available in this tab.";
  } else if (storageIssue?.kind === STORAGE_FAILURES.MIGRATION) {
    message = "Storage migration failed; the original local data was kept.";
  } else if (storageIssue?.kind === STORAGE_FAILURES.CONFLICT) {
    message = "Notes changed in another tab; reload before saving more changes.";
  } else if (storageIssue) {
    message = "Browser storage is unavailable; editing continues in this tab.";
  } else {
    switch (persistenceState) {
      case PERSISTENCE_STATES.GRANTED:
        message = "Persistent browser storage enabled; clearing site data still removes notes.";
        break;
      case PERSISTENCE_STATES.DENIED:
        message = "Persistent storage was not granted; notes still save in browser storage.";
        break;
      case PERSISTENCE_STATES.UNAVAILABLE:
        message = "Persistent-storage status is unavailable; notes still save in this browser.";
        break;
      case PERSISTENCE_STATES.UNSUPPORTED:
        message = "Browser storage can be removed automatically or by clearing site data.";
        break;
      default:
        message = "Browser storage is not persistent; clearing site data removes notes.";
        break;
    }
  }

  storageStatus.textContent = message;
  storageStatus.title = message;
}

function reportStorageIssue(error) {
  storageIssue = error;
  renderStorageStatus();
}

function visibleNotes() {
  return sortNotes(
    filterNotes(notesDocument.notes, searchInput.value),
    notesDocument.preferences.sortBy,
  );
}

function createNoteListItem(savedNote) {
  const item = document.createElement("li");
  const selectButton = document.createElement("button");
  const deleteButton = document.createElement("button");
  const title = document.createElement("span");
  const displayTitle = displayNoteTitle(savedNote);

  item.className = "note-list-item";
  if (savedNote.id === notesDocument.activeNoteId) {
    item.classList.add("is-active");
  }

  selectButton.type = "button";
  selectButton.className = "note-select";
  selectButton.dataset.noteId = savedNote.id;
  if (savedNote.id === notesDocument.activeNoteId) {
    selectButton.setAttribute("aria-current", "true");
  }

  title.className = "note-list-title";
  title.textContent = displayTitle;
  selectButton.append(title);

  if (notesDocument.preferences.listView === LIST_VIEWS.DETAILED) {
    const details = document.createElement("span");
    const preview = document.createElement("span");
    const timestamp = document.createElement("time");

    details.className = "note-list-details";
    preview.className = "note-list-preview";
    preview.textContent = notePreview(savedNote);
    timestamp.className = "note-list-time";
    timestamp.dateTime = savedNote.updatedAt;
    timestamp.textContent = timestampFormatter.format(
      new Date(savedNote.updatedAt),
    );
    details.append(preview, timestamp);
    selectButton.append(details);
  }

  deleteButton.type = "button";
  deleteButton.className = "note-delete danger-button";
  deleteButton.dataset.deleteNoteId = savedNote.id;
  deleteButton.setAttribute("aria-label", `Delete ${displayTitle}`);
  deleteButton.title = `Delete ${displayTitle}`;
  deleteButton.textContent = "×";

  item.append(selectButton, deleteButton);
  return item;
}

function renderNotes() {
  const matchingNotes = visibleNotes();
  const fragment = document.createDocumentFragment();

  for (const savedNote of matchingNotes) {
    fragment.append(createNoteListItem(savedNote));
  }

  notesList.replaceChildren(fragment);
  notesList.dataset.view = notesDocument.preferences.listView;
  notesEmptyState.hidden = matchingNotes.length !== 0;
  notesEmptyState.textContent =
    matchingNotes.length === 0
      ? `No notes match “${searchInput.value.trim()}”.`
      : "";
  sortSelect.value = notesDocument.preferences.sortBy;
  listViewSelect.value = notesDocument.preferences.listView;
  noteCountFooter.textContent = `${pluralizedCount(notesDocument.notes.length, "note", "notes")} · local first`;
}

function showActiveNote({ focus = "none" } = {}) {
  const savedNote = activeNote();
  editorCommands?.invalidatePendingCommands();
  titleInput.value = savedNote.title;
  note.value = savedNote.content;
  setCommandFeedback("");
  updateCounts();
  editorCommands?.rememberSelection();

  if (focus === "title") {
    titleInput.focus();
  } else if (focus === "body") {
    note.focus();
  }
}

showActiveNote();
renderNotes();
renderBackupStatus();
renderStorageStatus();
workspace.inert = false;
workspace.removeAttribute("aria-busy");

const autosave = createAutosave({
  delay: AUTOSAVE_DELAY_MS,
  save: async () => {
    if (!canSafelySave) {
      throw storageIssue ?? new Error("Stored notes cannot be safely replaced.");
    }
    await storageService.saveNotebook(structuredClone(notesDocument));
  },
  onStateChange: (state) => {
    saveState.textContent = `Local: ${state}`;
    saveState.dataset.saved = String(state === SAVE_STATES.SAVED);
    if (state === SAVE_STATES.SAVED) {
      storageIssue = null;
      renderStorageStatus();
    }
  },
  onSaved: () => {
    safetyCoordinator.localSaveSettled(notesDocument);
  },
  onError: reportStorageIssue,
  errorState: (error) => {
    if (error?.kind === STORAGE_FAILURES.QUOTA) {
      return SAVE_STATES.QUOTA;
    }
    if (error?.kind === STORAGE_FAILURES.MIGRATION) {
      return SAVE_STATES.MIGRATION;
    }
    if (error?.kind === STORAGE_FAILURES.CONFLICT) {
      return SAVE_STATES.CONFLICT;
    }
    return SAVE_STATES.UNAVAILABLE;
  },
});

autosave.setState(storageIssue?.kind === STORAGE_FAILURES.MIGRATION
  ? SAVE_STATES.MIGRATION
  : loadedNotes.storageAvailable
    ? SAVE_STATES.SAVED
    : SAVE_STATES.UNAVAILABLE);
void safetyCoordinator.initialize(notesDocument);

async function persistImmediately() {
  safetyCoordinator.markDirty();
  autosave.markDirty();
  return await autosave.flush();
}

function updateActiveNote(changes) {
  const nextDocument = updateNote(
    notesDocument,
    notesDocument.activeNoteId,
    changes,
  );

  if (nextDocument === notesDocument) {
    return false;
  }

  notesDocument = nextDocument;
  setCommandFeedback("");
  renderNotes();
  safetyCoordinator.markDirty();
  autosave.markDirty();
  return true;
}

titleInput.addEventListener("input", () => {
  updateActiveNote({ title: titleInput.value });
});

note.addEventListener("input", () => {
  updateCounts();
  updateActiveNote({ content: note.value });
});

editorCommands = createEditorCommands(note, {
  onFeedback: setCommandFeedback,
});

function closeMenu({ returnFocus = false } = {}) {
  if (commandMenu.hidden) {
    return;
  }

  commandMenu.hidden = true;
  moreButton.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    moreButton.focus();
  }
}

function openMenu() {
  closeInsertMenu();
  closeFileMenu();
  commandMenu.hidden = false;
  moreButton.setAttribute("aria-expanded", "true");
  commandMenu.querySelector('[role="menuitem"]').focus();
}

function closeInsertMenu({ returnFocus = false } = {}) {
  if (insertMenu.hidden) {
    return;
  }

  insertMenu.hidden = true;
  insertButton.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    insertButton.focus();
  }
}

function openInsertMenu() {
  closeMenu();
  closeFileMenu();
  insertMenu.hidden = false;
  insertButton.setAttribute("aria-expanded", "true");
  insertMenu.querySelector('[role="menuitem"]').focus();
}

function closeFileMenu({ returnFocus = false } = {}) {
  if (fileMenu.hidden) {
    return;
  }

  fileMenu.hidden = true;
  fileButton.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    fileButton.focus();
  }
}

function openFileMenu() {
  closeMenu();
  closeInsertMenu();
  fileMenu.hidden = false;
  fileButton.setAttribute("aria-expanded", "true");
  fileMenu.querySelector('[role="menuitem"]').focus();
}

function closeAllMenus() {
  closeMenu();
  closeInsertMenu();
  closeFileMenu();
}

moreButton.addEventListener("click", () => {
  if (commandMenu.hidden) {
    openMenu();
  } else {
    closeMenu({ returnFocus: true });
  }
});

insertButton.addEventListener("click", () => {
  if (insertMenu.hidden) {
    openInsertMenu();
  } else {
    closeInsertMenu({ returnFocus: true });
  }
});

fileButton.addEventListener("click", () => {
  if (fileMenu.hidden) {
    openFileMenu();
  } else {
    closeFileMenu({ returnFocus: true });
  }
});

function addMenuKeyboardHandling(menu, close) {
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(
      (item) => !item.hidden && !item.disabled,
    );
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close({ returnFocus: true });
        return;
      case "Tab":
        close();
        return;
      default:
        return;
    }

    event.preventDefault();
    items[nextIndex].focus();
  });
}

addMenuKeyboardHandling(commandMenu, closeMenu);
addMenuKeyboardHandling(insertMenu, closeInsertMenu);
addMenuKeyboardHandling(fileMenu, closeFileMenu);

document.addEventListener("pointerdown", (event) => {
  if (!commandMenu.hidden && !overflow.contains(event.target)) {
    closeMenu();
  }
  if (!insertMenu.hidden && !insertPopup.contains(event.target)) {
    closeInsertMenu();
  }
  if (!fileMenu.hidden && !filePopup.contains(event.target)) {
    closeFileMenu();
  }
});

for (const button of document.querySelectorAll("[data-command]")) {
  button.addEventListener("click", async () => {
    closeAllMenus();
    await editorCommands.execute(button.dataset.command);
  });
}

function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function chooseFile(input) {
  input.value = "";
  input.click();
}

const safetyPickerOptions = {
  types: [{
    description: "JotKeep Safety Files",
    accept: { "application/json": [".jotkeep"] },
  }],
  excludeAcceptAllOption: true,
};

function assertSafetyFilename(name) {
  if (!/\.jotkeep$/iu.test(name)) {
    throw new TypeError("Choose a file whose name ends in .jotkeep.");
  }
}

function showSafetyOpenDialog(read, handle = null) {
  pendingSafetyFile = { read, handle };
  const noteCount = read.value.document.notes.length;
  safetyOpenSummary.textContent = `${read.fileName ?? handle?.name ?? "Safety File"} · ${pluralizedCount(noteCount, "note", "notes")} · Updated ${timestampFormatter.format(new Date(read.value.updatedAt))}`;
  safetyOpenError.hidden = true;
  safetyOpenError.textContent = "";
  safetyOpenOptions.hidden = false;
  safetyOpenConfirm.disabled = false;
  safetyOpenOptions.querySelector('[value="replace"]').checked = true;
  safetyOpenConfirm.textContent = "Replace local notebook";
  safetyOpenConfirm.classList.add("danger-confirm-button");
  safetyOpenConfirm.classList.remove("primary-button");
  safetyOpenDialog.showModal();
}

async function chooseDirectSafetyFile() {
  try {
    const [handle] = await window.showOpenFilePicker({
      ...safetyPickerOptions,
      multiple: false,
    });
    assertSafetyFilename(handle.name);
    await autosave.flush();
    const read = await readSafetyFileHandle(handle);
    showSafetyOpenDialog(read, handle);
  } catch (error) {
    if (error?.name !== "AbortError") {
      setCommandFeedback(`Could not open Safety File: ${error.message}`);
    }
  }
}

async function createDirectSafetyFile() {
  try {
    const handle = await window.showSaveFilePicker({
      ...safetyPickerOptions,
      suggestedName: "JotKeep Safety File.jotkeep",
    });
    assertSafetyFilename(handle.name);
    await autosave.flush();
    await safetyCoordinator.waitForIdle();
    await safetyCoordinator.create(handle, structuredClone(notesDocument));
    setCommandFeedback(
      `Created and verified Safety File “${handle.name}”. Automatic updates are connected.`,
    );
  } catch (error) {
    if (error?.name !== "AbortError") {
      setCommandFeedback(`Could not create Safety File: ${error.message}`);
    }
  }
}

async function downloadSafetyFile() {
  await autosave.flush();
  try {
    const value = createSafetyFile(notesDocument);
    const serialized = serializeSafetyFile(value);
    const filename = safetyFileFilename(value.createdAt);
    downloadFile(serialized, "application/json;charset=utf-8", filename);
    setCommandFeedback(
      `Prepared Safety File download “${filename}”. This browser cannot verify that the downloaded file remains on disk.`,
    );
  } catch (error) {
    setCommandFeedback(`Could not prepare Safety File: ${error.message}`);
  }
}

async function verifySafetyFile() {
  const connection = safetyCoordinator.getConnection();
  if (connection) {
    const read = await safetyCoordinator.verify(notesDocument);
    if (read) {
      const matches = safetyState.kind === SAFETY_FILE_STATES.BACKED_UP;
      setCommandFeedback(
        matches
          ? `Verified Safety File “${connection.fileName}”; it matches the local notebook.`
          : `Verified Safety File “${connection.fileName}”; local changes are not backed up yet.`,
      );
    } else {
      setCommandFeedback(
        safetyState.error?.message ?? "Could not verify the connected Safety File.",
      );
    }
    return;
  }

  if (directSafetyFilesSupported) {
    try {
      const [handle] = await window.showOpenFilePicker({
        ...safetyPickerOptions,
        multiple: false,
      });
      assertSafetyFilename(handle.name);
      const read = await readSafetyFileHandle(handle);
      setCommandFeedback(
        `Verified “${handle.name}”: ${pluralizedCount(read.value.document.notes.length, "note", "notes")}, updated ${timestampFormatter.format(new Date(read.value.updatedAt))}. It was not connected.`,
      );
    } catch (error) {
      if (error?.name !== "AbortError") {
        setCommandFeedback(`Could not verify Safety File: ${error.message}`);
      }
    }
  } else {
    safetyFileInputMode = "verify";
    chooseFile(safetyFileInput);
  }
}

safetyFileInput.addEventListener("change", async () => {
  const [file] = safetyFileInput.files;
  if (!file) {
    return;
  }
  safetyFileInput.value = "";
  try {
    assertSafetyFilename(file.name);
    const read = { ...(await readSafetyFile(file)), fileName: file.name };
    if (safetyFileInputMode === "verify") {
      setCommandFeedback(
        `Verified “${file.name}”: ${pluralizedCount(read.value.document.notes.length, "note", "notes")}, updated ${timestampFormatter.format(new Date(read.value.updatedAt))}.`,
      );
    } else {
      await autosave.flush();
      showSafetyOpenDialog(read);
    }
  } catch (error) {
    setCommandFeedback(`Could not ${safetyFileInputMode === "verify" ? "verify" : "open"} Safety File: ${error.message}`);
  } finally {
    safetyFileInputMode = "open";
  }
});

function closeSafetyOpenDialog() {
  if (safetyOpenDialog.open) {
    safetyOpenDialog.close();
  }
}

safetyOpenCancel.addEventListener("click", closeSafetyOpenDialog);
safetyOpenClose.addEventListener("click", closeSafetyOpenDialog);
safetyOpenDialog.addEventListener("close", () => {
  pendingSafetyFile = null;
});
safetyOpenOptions.addEventListener("change", () => {
  const replace = safetyOpenOptions.querySelector('[name="safety-open-mode"]:checked').value === "replace";
  safetyOpenConfirm.textContent = replace ? "Replace local notebook" : "Merge and update Safety File";
  safetyOpenConfirm.classList.toggle("danger-confirm-button", replace);
  safetyOpenConfirm.classList.toggle("primary-button", !replace);
});

safetyOpenConfirm.addEventListener("click", async () => {
  if (!pendingSafetyFile) {
    return;
  }
  const selected = pendingSafetyFile;
  const mode = safetyOpenOptions.querySelector('[name="safety-open-mode"]:checked').value;
  safetyOpenError.hidden = true;
  safetyOpenConfirm.disabled = true;
  try {
    let read = selected.read;
    if (selected.handle) {
      if (
        typeof selected.handle.requestPermission === "function" &&
        (await selected.handle.requestPermission({ mode: "readwrite" })) !== "granted"
      ) {
        throw new Error("Write permission was not granted; no local notes were changed.");
      }
      read = await readSafetyFileHandle(selected.handle);
      if (read.digest !== selected.read.digest) {
        throw new Error("The selected Safety File changed while the dialog was open. Open it again.");
      }
    }

    const candidate = mode === "merge"
      ? mergeBackupDocument(notesDocument, read.value.document)
      : structuredClone(read.value.document);

    await safetyCoordinator.waitForIdle();
    if (selected.handle) {
      await safetyCoordinator.prepareConnectionSwitch(read.value.fileId);
    }
    if (mode === "merge") {
      await storageService.saveNotebook(candidate);
    } else {
      await storageService.replaceNotebook(candidate);
    }

    textImportGeneration += 1;
    notesDocument = candidate;
    canSafelySave = true;
    storageIssue = null;
    autosave.reset(SAVE_STATES.SAVED);
    saveState.textContent = `Local: ${SAVE_STATES.SAVED}`;
    searchInput.value = "";
    renderNotes();
    showActiveNote({ focus: "body" });

    if (selected.handle) {
      await safetyCoordinator.connectVerified(
        selected.handle,
        read,
        read.value.document,
      );
      if (mode === "merge") {
        safetyCoordinator.markDirty();
        safetyCoordinator.localSaveSettled(candidate);
        await safetyCoordinator.waitForIdle();
      }
    }

    closeSafetyOpenDialog();
    if (
      selected.handle &&
      mode === "merge" &&
      safetyState.kind !== SAFETY_FILE_STATES.BACKED_UP
    ) {
      setCommandFeedback(
        `Merged “${read.fileName}” locally, but the Safety File was not updated: ${safetyState.error?.message ?? "check its backup status"}`,
      );
    } else {
      setCommandFeedback(
        selected.handle
          ? `${mode === "merge" ? "Merged and connected" : "Opened and connected"} Safety File “${read.fileName}”.`
          : `${mode === "merge" ? "Merged" : "Opened"} “${read.fileName}”. Download a new Safety File to preserve future changes.`,
      );
    }
  } catch (error) {
    safetyOpenError.textContent = `Could not open this Safety File: ${error.message}`;
    safetyOpenError.hidden = false;
    safetyOpenConfirm.disabled = false;
  }
});

function closeSafetyConflictDialog() {
  if (safetyConflictDialog.open) {
    safetyConflictDialog.close();
  }
}

safetyConflictClose.addEventListener("click", closeSafetyConflictDialog);
safetyConflictCancel.addEventListener("click", closeSafetyConflictDialog);
safetyConflictDisconnect.addEventListener("click", async () => {
  if (await safetyCoordinator.disconnect()) {
    closeSafetyConflictDialog();
    setCommandFeedback("Disconnected the Safety File. The external file was not changed.");
  } else {
    safetyConflictError.textContent = safetyState.error.message;
    safetyConflictError.hidden = false;
  }
});
safetyUseFile.addEventListener("click", async () => {
  safetyConflictError.hidden = true;
  try {
    const connection = safetyCoordinator.getConnection();
    const read = await readSafetyFileHandle(connection.handle);
    await storageService.replaceNotebook(read.value.document);
    notesDocument = structuredClone(read.value.document);
    textImportGeneration += 1;
    canSafelySave = true;
    storageIssue = null;
    autosave.reset(SAVE_STATES.SAVED);
    saveState.textContent = `Local: ${SAVE_STATES.SAVED}`;
    searchInput.value = "";
    renderNotes();
    renderStorageStatus();
    showActiveNote({ focus: "body" });
    await safetyCoordinator.connectVerified(connection.handle, read, notesDocument);
    closeSafetyConflictDialog();
    setCommandFeedback(`Replaced the local notebook with Safety File “${connection.fileName}”.`);
  } catch (error) {
    safetyConflictError.textContent = `Could not use the Safety File: ${error.message}`;
    safetyConflictError.hidden = false;
  }
});
safetyOverwriteFile.addEventListener("click", async () => {
  safetyConflictError.hidden = true;
  if (await safetyCoordinator.overwrite(structuredClone(notesDocument))) {
    closeSafetyConflictDialog();
    setCommandFeedback("Overwrote and verified the Safety File with the local notebook.");
  } else {
    safetyConflictError.textContent = safetyState.error?.message ?? "Could not overwrite the Safety File.";
    safetyConflictError.hidden = false;
  }
});

async function importTextFile(file, generation) {
  if (!/\.txt$/iu.test(file.name)) {
    throw new TypeError("Choose a file whose name ends in .txt.");
  }

  const content = decodeUtf8(await file.arrayBuffer());
  if (generation !== textImportGeneration) {
    return;
  }

  await autosave.flush();
  notesDocument = addNote(notesDocument, {
    title: titleFromTextFilename(file.name),
    content,
  });
  searchInput.value = "";
  const saved = await persistImmediately();
  showActiveNote({ focus: "body" });
  renderNotes();
  setCommandFeedback(
    saved
      ? `Imported “${file.name}” as a new note.`
      : `Imported “${file.name}” for this session, but browser storage is unavailable.`,
  );

  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
}

textFileInput.addEventListener("change", async () => {
  const [file] = textFileInput.files;
  if (!file) {
    return;
  }

  const generation = ++textImportGeneration;
  textFileInput.value = "";

  try {
    await importTextFile(file, generation);
  } catch (error) {
    if (generation === textImportGeneration) {
      setCommandFeedback(`Could not import text: ${error.message}`);
    }
  }
});

async function downloadActiveNote() {
  await autosave.flush();
  const savedNote = activeNote();
  const filename = sanitizeFilename(savedNote.title);
  downloadFile(savedNote.content, "text/plain;charset=utf-8", filename);
  setCommandFeedback(`Created text download “${filename}”.`);
}

async function exportJsonBackup() {
  await autosave.flush();

  try {
    const backup = createBackup(notesDocument);
    const serialized = serializeBackup(backup);
    parseBackup(serialized);
    const filename = backupFilename(backup.createdAt);
    downloadFile(serialized, "application/json;charset=utf-8", filename);

    lastBackupMetadata = { version: 1, createdAt: backup.createdAt };
    let metadataSaved = true;
    try {
      await storageService.saveLastBackup(backup.createdAt);
    } catch (error) {
      metadataSaved = false;
      reportStorageIssue(error);
    }

    renderBackupStatus();
    setCommandFeedback(
      metadataSaved
        ? `Created JSON backup “${filename}”. Keep the downloaded file somewhere safe.`
        : `Created JSON backup “${filename}”, but this browser could not remember its date.`,
    );
  } catch (error) {
    setCommandFeedback(`Could not create backup: ${error.message}`);
  }
}

async function requestBrowserPersistence() {
  persistenceState = await storageService.requestPersistence();
  renderStorageStatus();

  switch (persistenceState) {
    case PERSISTENCE_STATES.GRANTED:
      setCommandFeedback(
        "Persistent browser storage is enabled. Clearing site data can still remove your notes.",
      );
      break;
    case PERSISTENCE_STATES.DENIED:
      setCommandFeedback(
        "The browser did not grant persistent storage. Editing and browser saves still work.",
      );
      break;
    case PERSISTENCE_STATES.UNSUPPORTED:
      setCommandFeedback(
        "This browser does not offer a persistent-storage request. Keep JSON backups somewhere safe.",
      );
      break;
    default:
      setCommandFeedback(
        "JotKeep could not request persistent storage. Editing and browser saves still work.",
      );
      break;
  }
}

function setRestoreError(message) {
  pendingBackup = null;
  restoreSummary.textContent = "";
  restoreError.textContent = message;
  restoreError.hidden = false;
  restoreOptions.hidden = true;
  restoreConfirm.disabled = true;
  restoreConfirm.textContent = "Restore backup";

  if (!restoreDialog.open) {
    restoreDialog.showModal();
  }
}

function setRestoreLoading() {
  pendingBackup = null;
  restoreSummary.textContent = "Validating the selected backup…";
  restoreError.textContent = "";
  restoreError.hidden = true;
  restoreOptions.hidden = true;
  restoreConfirm.disabled = true;
  restoreConfirm.textContent = "Validating backup…";
  restoreConfirm.classList.remove("danger-confirm-button");
  restoreConfirm.classList.add("primary-button");

  if (!restoreDialog.open) {
    restoreDialog.showModal();
  }
}

function showRestoreBackup(backup) {
  pendingBackup = backup;
  restoreError.hidden = true;
  restoreError.textContent = "";
  restoreOptions.hidden = false;
  restoreConfirm.disabled = false;
  const noteCount = backup.document.notes.length;
  restoreSummary.textContent = `${pluralizedCount(noteCount, "note", "notes")} · Created ${timestampFormatter.format(new Date(backup.createdAt))}`;

  const mergeOption = restoreOptions.querySelector('[value="merge"]');
  const replaceOption = restoreOptions.querySelector('[value="replace"]');
  mergeOption.disabled = !canSafelySave;
  mergeOption.closest("label").title = canSafelySave
    ? ""
    : "Merge is unavailable because the current stored notebook could not be loaded safely.";
  (canSafelySave ? mergeOption : replaceOption).checked = true;
  updateRestoreConfirmation();

  if (!restoreDialog.open) {
    restoreDialog.showModal();
  }
}

async function readBackupFile(file) {
  if (!/\.json$/iu.test(file.name)) {
    throw new TypeError("Choose a file whose name ends in .json.");
  }
  if (file.size > MAX_BACKUP_BYTES) {
    throw new TypeError("The selected backup is larger than 25 MiB.");
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new TypeError("The selected backup is not valid UTF-8.");
  }

  return parseBackup(text, { byteLength: file.size });
}

backupFileInput.addEventListener("change", async () => {
  const [file] = backupFileInput.files;
  if (!file) {
    return;
  }

  const generation = ++backupReadGeneration;
  backupFileInput.value = "";
  setRestoreLoading();

  try {
    await autosave.flush();
    const backup = await readBackupFile(file);
    if (generation === backupReadGeneration) {
      showRestoreBackup(backup);
    }
  } catch (error) {
    if (generation === backupReadGeneration) {
      setRestoreError(`Could not restore this file: ${error.message}`);
    }
  }
});

function updateRestoreConfirmation() {
  const mode = restoreOptions.querySelector('[name="restore-mode"]:checked')?.value;
  restoreConfirm.textContent =
    mode === "replace" ? "Replace all local notes" : "Merge backup";
  restoreConfirm.classList.toggle("danger-confirm-button", mode === "replace");
  restoreConfirm.classList.toggle("primary-button", mode !== "replace");
}

restoreOptions.addEventListener("change", updateRestoreConfirmation);
restoreChooseFile.addEventListener("click", () => chooseFile(backupFileInput));

function closeRestoreDialog() {
  if (restoreDialog.open) {
    restoreDialog.close();
  }
}

restoreCancel.addEventListener("click", closeRestoreDialog);
restoreDialogClose.addEventListener("click", closeRestoreDialog);
restoreDialog.addEventListener("close", () => {
  backupReadGeneration += 1;
  pendingBackup = null;
  restoreReturnFocus?.focus();
  restoreReturnFocus = null;
});

restoreConfirm.addEventListener("click", async () => {
  if (pendingBackup === null) {
    return;
  }

  const mode = restoreOptions.querySelector('[name="restore-mode"]:checked').value;
  if (mode === "merge" && !canSafelySave) {
    setRestoreError(
      "Merge is unavailable because the current stored notebook could not be loaded safely. Choose Replace instead.",
    );
    return;
  }

  let candidate;
  try {
    candidate =
      mode === "merge"
        ? mergeBackupDocument(notesDocument, pendingBackup.document)
        : structuredClone(pendingBackup.document);
  } catch (error) {
    restoreError.textContent =
      "JotKeep could not prepare this restore without creating duplicate note IDs. No notes were changed.";
    restoreError.hidden = false;
    return;
  }

  try {
    if (mode === "replace") {
      await storageService.replaceNotebook(candidate);
    } else {
      await storageService.saveNotebook(candidate);
    }
  } catch (error) {
    reportStorageIssue(error);
    restoreError.textContent =
      "JotKeep could not save the restored notebook. Check browser storage access or available space; no notes were changed.";
    restoreError.hidden = false;
    return;
  }

  textImportGeneration += 1;
  notesDocument = candidate;
  canSafelySave = true;
  storageIssue = null;
  autosave.reset(SAVE_STATES.SAVED);
  saveState.textContent = `Local: ${SAVE_STATES.SAVED}`;
  safetyCoordinator.markDirty();
  safetyCoordinator.localSaveSettled(candidate);
  searchInput.value = "";
  renderNotes();
  showActiveNote({ focus: "body" });
  const restoredCount = pendingBackup.document.notes.length;
  closeRestoreDialog();
  setCommandFeedback(
    mode === "merge"
      ? `Merged ${pluralizedCount(restoredCount, "note", "notes")} from the backup.`
      : `Restored ${pluralizedCount(restoredCount, "note", "notes")} from the backup.`,
  );
});

function openClearDataDialog(trigger) {
  closeAllMenus();
  clearDataReturnFocus = trigger;
  clearDataSummary.textContent = `${pluralizedCount(notesDocument.notes.length, "local note", "local notes")} will be removed.`;
  clearDataError.hidden = true;
  clearDataError.textContent = "";
  clearDataDialog.showModal();
  clearDataCancel.focus();
}

function closeClearDataDialog() {
  if (clearDataDialog.open) {
    clearDataDialog.close();
  }
}

clearDataCancel.addEventListener("click", closeClearDataDialog);
clearDataDialogClose.addEventListener("click", closeClearDataDialog);
clearDataDialog.addEventListener("close", () => {
  clearDataReturnFocus?.focus();
  clearDataReturnFocus = null;
});

clearDataConfirm.addEventListener("click", async () => {
  await safetyCoordinator.suspend();
  await autosave.flush();
  await safetyCoordinator.waitForIdle();
  try {
    await storageService.clear();
  } catch (error) {
    reportStorageIssue(error);
    clearDataError.textContent =
      "JotKeep could not clear browser storage. Your current notes remain open.";
    clearDataError.hidden = false;
    safetyCoordinator.resume(notesDocument);
    return;
  }

  textImportGeneration += 1;
  autosave.reset(SAVE_STATES.CLEARED);
  canSafelySave = true;
  storageIssue = null;
  notesDocument = createNotesDocument();
  lastBackupMetadata = null;
  await safetyCoordinator.disconnect({ persist: false });
  searchInput.value = "";
  renderNotes();
  renderBackupStatus();
  renderStorageStatus();
  showActiveNote({ focus: "body" });
  closeClearDataDialog();
  setCommandFeedback("All JotKeep data was cleared from this browser.");
});

for (const button of document.querySelectorAll("[data-file-action]")) {
  button.addEventListener("click", async () => {
    closeAllMenus();

    switch (button.dataset.fileAction) {
      case "open-text":
        chooseFile(textFileInput);
        break;
      case "download-text":
        await downloadActiveNote();
        break;
      case "create-safety":
        await createDirectSafetyFile();
        break;
      case "open-safety":
        if (directSafetyFilesSupported) {
          await chooseDirectSafetyFile();
        } else {
          safetyFileInputMode = "open";
          chooseFile(safetyFileInput);
        }
        break;
      case "download-safety":
        await downloadSafetyFile();
        break;
      case "verify-safety":
        await verifySafetyFile();
        break;
      case "grant-safety":
        if (await safetyCoordinator.grant(notesDocument)) {
          setCommandFeedback("Safety File access restored and the file was verified.");
        } else {
          setCommandFeedback("Safety File access was not granted. Local saves continue normally.");
        }
        break;
      case "resolve-safety":
        safetyConflictError.hidden = true;
        safetyConflictError.textContent = "";
        safetyConflictDialog.showModal();
        break;
      case "disconnect-safety":
        if (await safetyCoordinator.disconnect()) {
          setCommandFeedback("Disconnected the Safety File. The external file was not changed.");
        } else {
          setCommandFeedback(safetyState.error.message);
        }
        break;
      case "export-backup":
        await exportJsonBackup();
        break;
      case "restore-backup":
        restoreReturnFocus = button.closest("#file-menu") ? fileButton : moreButton;
        chooseFile(backupFileInput);
        break;
      case "persist-storage":
        await requestBrowserPersistence();
        break;
      case "clear-data":
        openClearDataDialog(
          button.closest("#file-menu") ? fileButton : moreButton,
        );
        break;
    }
  });
}

function findOptions() {
  return {
    matchCase: matchCase.checked,
    wholeWord: wholeWord.checked,
  };
}

function currentFindMatches() {
  return findMatches(note.value, findQuery.value, findOptions());
}

function setFindStatus(message) {
  findStatus.textContent = message;
}

function refreshFindStatus() {
  if (findQuery.value === "") {
    setFindStatus("Enter text to find.");
    return;
  }

  const matches = currentFindMatches();

  if (matches.length === 0) {
    setFindStatus("No matches.");
    return;
  }

  const currentIndex = currentMatchIndex(
    matches,
    editorCommands.getSelection(),
  );
  setFindStatus(
    currentIndex === -1
      ? pluralizedCount(matches.length, "match", "matches")
      : `Match ${currentIndex + 1} of ${matches.length}`,
  );
}

function setFindMode(replaceMode) {
  findReplaceMode = replaceMode;
  findDialogTitle.textContent = replaceMode ? "Find and replace" : "Find";
  replaceFields.hidden = !replaceMode;
  replaceOneButton.hidden = !replaceMode;
  replaceAllButton.hidden = !replaceMode;
  findModeToggle.textContent = replaceMode ? "Hide replace" : "Show replace";
  findModeToggle.setAttribute("aria-pressed", String(replaceMode));
}

function openFindDialog(replaceMode) {
  closeAllMenus();

  if (pickerDialog.open) {
    pickerDialog.close();
  }

  if (sidebarOpen && narrowLayout.matches) {
    setSidebarOpen(false);
  }

  setFindMode(replaceMode);

  if (!findDialog.open) {
    const selection = editorCommands.getSelection();
    const selectedText = note.value.slice(selection.start, selection.end);

    if (selectedText !== "") {
      findQuery.value = selectedText;
    }

    findDialog.showModal();
  }

  refreshFindStatus();
  findQuery.focus();
  findQuery.select();
}

function navigateToMatch(direction) {
  if (findQuery.value === "") {
    setFindStatus("Enter text to find.");
    return false;
  }

  const matches = currentFindMatches();
  const adjacent = findAdjacentMatch(
    matches,
    editorCommands.getSelection(),
    direction,
  );

  if (adjacent === null) {
    setFindStatus("No matches.");
    return false;
  }

  editorCommands.selectRange(adjacent.match.start, adjacent.match.end);
  setFindStatus(
    `${adjacent.index + 1} of ${matches.length}${
      adjacent.wrapped ? " · Wrapped" : ""
    }`,
  );
  return true;
}

function runFindDialogMutation(mutation, returnFocus) {
  ignoredFindCloseEvents += 1;
  findDialog.close();
  mutation();
  findDialog.showModal();
  returnFocus.focus();
}

function replaceCurrentMatch() {
  if (findQuery.value === "") {
    setFindStatus("Enter text to find.");
    return;
  }

  const matches = currentFindMatches();
  const selection = editorCommands.getSelection();
  const matchIndex = currentMatchIndex(matches, selection);

  if (matchIndex === -1) {
    navigateToMatch("next");
    return;
  }

  const replacement = replaceValue.value;
  runFindDialogMutation(() => {
    editorCommands.replaceRange(selection, replacement);
    const remainingMatches = currentFindMatches();

    if (remainingMatches.length === 0) {
      setFindStatus("Replaced 1 match. No matches remain.");
    } else {
      const adjacent = findAdjacentMatch(
        remainingMatches,
        editorCommands.getSelection(),
        "next",
      );
      editorCommands.selectRange(adjacent.match.start, adjacent.match.end);
      setFindStatus(
        `Replaced 1 match. ${adjacent.index + 1} of ${remainingMatches.length}${
          adjacent.wrapped ? " · Wrapped" : ""
        }`,
      );
    }
  }, replaceOneButton);
}

function replaceEveryMatch() {
  if (findQuery.value === "") {
    setFindStatus("Enter text to find.");
    return;
  }

  const result = replaceAllLiteral(
    note.value,
    findQuery.value,
    replaceValue.value,
    findOptions(),
  );

  if (result.count === 0) {
    setFindStatus("No matches.");
    return;
  }

  runFindDialogMutation(() => {
    editorCommands.replaceRange(
      { start: 0, end: note.value.length, direction: "none" },
      result.text,
    );
    editorCommands.selectRange(result.caret, result.caret);
    setFindStatus(
      `Replaced ${pluralizedCount(result.count, "match", "matches")}.`,
    );
  }, replaceAllButton);
}

findModeToggle.addEventListener("click", () => {
  setFindMode(!findReplaceMode);
  if (findReplaceMode) {
    replaceValue.focus();
  }
});
findPreviousButton.addEventListener("click", () => navigateToMatch("previous"));
findNextButton.addEventListener("click", () => navigateToMatch("next"));
replaceOneButton.addEventListener("click", replaceCurrentMatch);
replaceAllButton.addEventListener("click", replaceEveryMatch);
findQuery.addEventListener("input", refreshFindStatus);
matchCase.addEventListener("change", refreshFindStatus);
wholeWord.addEventListener("change", refreshFindStatus);

findDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  findDialog.close();
});
findDialog.addEventListener("close", () => {
  if (ignoredFindCloseEvents > 0) {
    ignoredFindCloseEvents -= 1;
    return;
  }

  editorCommands.restoreSelection();
});

for (const button of document.querySelectorAll('[data-action="find"]')) {
  button.addEventListener("click", () => openFindDialog(false));
}

for (const button of document.querySelectorAll('[data-action="replace"]')) {
  button.addEventListener("click", () => openFindDialog(true));
}

function openCharacterPicker(kind) {
  closeAllMenus();

  if (findDialog.open) {
    findDialog.close();
  }

  pickerSelection = editorCommands.getSelection();
  const isEmoji = kind === "emoji";
  const palette = isEmoji ? EMOJI : SPECIAL_CHARACTERS;
  pickerDialogTitle.textContent = isEmoji
    ? "Insert emoji"
    : "Insert special character";
  characterGrid.dataset.kind = kind;
  const fragment = document.createDocumentFragment();

  for (const [value, label] of palette) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.character = value;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = value;
    fragment.append(button);
  }

  characterGrid.replaceChildren(fragment);
  pickerDialog.showModal();
  characterGrid.querySelector("button").focus();
}

characterGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-character]");

  if (!button) {
    return;
  }

  const selection = pickerSelection;
  ignoredPickerCloseEvents += 1;
  pickerDialog.close();
  editorCommands.insertText(button.dataset.character, selection);
  pickerSelection = null;
});

pickerDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  pickerDialog.close();
});
pickerDialog.addEventListener("close", () => {
  if (ignoredPickerCloseEvents > 0) {
    ignoredPickerCloseEvents -= 1;
    return;
  }

  editorCommands.restoreSelection(pickerSelection);
  pickerSelection = null;
});

for (const button of document.querySelectorAll("[data-picker]")) {
  button.addEventListener("click", () =>
    openCharacterPicker(button.dataset.picker),
  );
}

for (const button of document.querySelectorAll('[data-insert="date-time"]')) {
  button.addEventListener("click", () => {
    closeAllMenus();
    editorCommands.insertText(formatCurrentDateTime());
  });
}

for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => {
    const dialog =
      button.dataset.closeDialog === "find" ? findDialog : pickerDialog;
    dialog.close();
  });
}

function clearActiveNote() {
  closeAllMenus();
  clearEditor({
    titleInput,
    textarea: note,
    confirmClear: () => window.confirm("Clear this note?"),
    onClear: () => {
      setCommandFeedback("");
      updateCounts();
      updateActiveNote({ title: "", content: "" });
      editorCommands.rememberSelection();
    },
  });
}

for (const button of document.querySelectorAll('[data-action="clear"]')) {
  button.addEventListener("click", clearActiveNote);
}

function setSidebarOpen(open, { returnFocus = false, focusPanel = false } = {}) {
  /* The inline head script may have hidden the drawer pre-paint; from the
     first call onward the hidden attribute below is the single source of
     truth. */
  delete document.documentElement.dataset.sidebar;
  const isBlockingDrawer = open && narrowLayout.matches;
  sidebarOpen = open;
  sidebar.hidden = !open;
  sidebarBackdrop.hidden = !isBlockingDrawer;
  sidebarToggle.setAttribute("aria-expanded", String(open));
  sidebarToggle.setAttribute(
    "aria-label",
    open ? "Hide notes panel" : "Show notes panel",
  );

  if (isBlockingDrawer && focusPanel) {
    searchInput.focus();
  }

  workspace.toggleAttribute("inert", isBlockingDrawer);

  if (isBlockingDrawer) {
    workspace.setAttribute("aria-hidden", "true");
  } else {
    workspace.removeAttribute("aria-hidden");
  }

  document.body.classList.toggle("drawer-open", isBlockingDrawer);

  if (returnFocus) {
    sidebarToggle.focus();
  } else if (focusPanel && !isBlockingDrawer) {
    searchInput.focus();
  }
}

setSidebarOpen(sidebarOpen);

sidebarToggle.addEventListener("click", () => {
  setSidebarOpen(!sidebarOpen, {
    returnFocus: sidebarOpen,
    focusPanel: !sidebarOpen,
  });
});

sidebarBackdrop.addEventListener("click", () => {
  setSidebarOpen(false, { returnFocus: true });
});

document.addEventListener("keydown", (event) => {
  const shortcutKey = event.key.toLowerCase();

  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (shortcutKey === "o") {
      event.preventDefault();
      closeAllMenus();
      chooseFile(textFileInput);
      return;
    }

    if (shortcutKey === "s") {
      event.preventDefault();
      closeAllMenus();
      downloadActiveNote();
      return;
    }

    if (shortcutKey === "f") {
      event.preventDefault();
      openFindDialog(false);
      return;
    }

    if (shortcutKey === "h") {
      event.preventDefault();
      openFindDialog(true);
      return;
    }
  }

  if (event.key === "Escape" && sidebarOpen && narrowLayout.matches) {
    event.preventDefault();
    setSidebarOpen(false, { returnFocus: true });
  }
});

narrowLayout.addEventListener("change", (event) => {
  closeAllMenus();
  setSidebarOpen(!event.matches);
});

compactToolbar.addEventListener("change", closeAllMenus);

async function selectSavedNote(noteId) {
  if (noteId !== notesDocument.activeNoteId) {
    if (notebookTransitionPending) {
      return;
    }
    setNotebookTransitionPending(true);
    try {
      await autosave.flush();
      notesDocument = setActiveNote(notesDocument, noteId);
      await persistImmediately();
    } finally {
      setNotebookTransitionPending(false);
    }
    showActiveNote({ focus: "body" });
    renderNotes();
  } else {
    note.focus();
  }

  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
}

async function createSavedNote() {
  if (notebookTransitionPending) {
    return;
  }
  setNotebookTransitionPending(true);
  try {
    await autosave.flush();
    notesDocument = addNote(notesDocument);
    searchInput.value = "";
    await persistImmediately();
  } finally {
    setNotebookTransitionPending(false);
  }
  showActiveNote({ focus: "title" });
  renderNotes();

  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
}

async function deleteSavedNote(noteId, trigger) {
  const savedNote = notesDocument.notes.find((item) => item.id === noteId);

  if (!window.confirm(`Delete “${displayNoteTitle(savedNote)}”?`)) {
    trigger.focus();
    return;
  }

  if (notebookTransitionPending) {
    return;
  }
  setNotebookTransitionPending(true);

  let deletingActiveNote;
  let deletingOnlyNote;
  let nextActiveNoteId;
  try {
    await autosave.flush();
    deletingActiveNote = noteId === notesDocument.activeNoteId;
    deletingOnlyNote = notesDocument.notes.length === 1;

    if (deletingOnlyNote) {
      searchInput.value = "";
    }

    if (deletingActiveNote && !deletingOnlyNote) {
      nextActiveNoteId = chooseNeighborNoteId(
        noteId,
        visibleNotes().map((item) => item.id),
      );

      if (nextActiveNoteId === null) {
        searchInput.value = "";
        nextActiveNoteId = chooseNeighborNoteId(
          noteId,
          sortNotes(notesDocument.notes, notesDocument.preferences.sortBy).map(
            (item) => item.id,
          ),
        );
      }
    }

    notesDocument = deleteNote(notesDocument, noteId, { nextActiveNoteId });
    await persistImmediately();
  } finally {
    setNotebookTransitionPending(false);
  }
  renderNotes();

  if (deletingActiveNote) {
    showActiveNote({ focus: deletingOnlyNote ? "title" : "body" });

    if (narrowLayout.matches) {
      setSidebarOpen(false);
    }
  } else {
    const activeButton = notesList.querySelector('[aria-current="true"]');
    (activeButton ?? searchInput).focus();
  }
}

newNoteButton.addEventListener("click", () => {
  void createSavedNote();
});

notesList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-note-id]");
  if (deleteButton) {
    void deleteSavedNote(deleteButton.dataset.deleteNoteId, deleteButton);
    return;
  }

  const selectButton = event.target.closest("[data-note-id]");
  if (selectButton) {
    void selectSavedNote(selectButton.dataset.noteId);
  }
});

searchInput.addEventListener("input", renderNotes);

sortSelect.addEventListener("change", async () => {
  notesDocument = updatePreferences(notesDocument, { sortBy: sortSelect.value });
  renderNotes();
  await persistImmediately();
});

listViewSelect.addEventListener("change", async () => {
  notesDocument = updatePreferences(notesDocument, {
    listView: listViewSelect.value,
  });
  renderNotes();
  await persistImmediately();
});

window.addEventListener("pagehide", () => {
  void autosave.flush();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void autosave.flush();
  }
});
