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
  verifyBackupChecksum,
} from "./backup.js";
import { clearEditor, countText, createEditorCommands } from "./editor.js";
import {
  COMMAND_CATALOG,
  commandById,
  formatShortcut,
  searchCommands,
} from "./commands.js";
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
  fingerprintText,
  notebookChecksum,
  safetyFileChecksum,
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
import { SNAPSHOT_KINDS, restoreNoteFromSnapshot } from "./snapshots.js";
import {
  createAppearanceStore,
} from "./preferences.js";

const AUTOSAVE_DELAY_MS = 500;
const BACKUP_STATUS_REFRESH_MS = 60 * 1000;
const MOBILE_BREAKPOINT = "(max-width: 48rem)";
const TOOLBAR_BREAKPOINT = "(max-width: 75rem)";
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
const appAnnouncer = document.querySelector("#app-announcer");
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
const viewButton = document.querySelector("#view-button");
const viewMenu = document.querySelector("#view-menu");
const viewPopup = viewButton.closest(".toolbar-popup");
const appShell = document.querySelector(".app-shell");
const sidebar = document.querySelector("#notes-sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const newNoteButton = document.querySelector("#new-note");
const searchInput = document.querySelector("#note-search");
const noteSearchCount = document.querySelector("#note-search-count");
const sortSelect = document.querySelector("#note-sort");
const listViewSelect = document.querySelector("#note-list-view");
const notesList = document.querySelector("#notes-list");
const notesEmptyState = document.querySelector("#notes-empty-state");
const notesEmptyMessage = document.querySelector("#notes-empty-message");
const clearNoteSearchButton = document.querySelector("#clear-note-search");
const firstUseGuide = document.querySelector("#first-use-guide");
const firstUseGuideClose = document.querySelector("#first-use-guide-close");
const firstUseBackupOptions = document.querySelector(
  "#first-use-backup-options",
);
const backupHelp = document.querySelector("#backup-help");
const backupGuideDialog = document.querySelector("#backup-guide-dialog");
const backupGuideClose = document.querySelector("#backup-guide-close");
const backupGuideNotNow = document.querySelector("#backup-guide-not-now");
const backupGuideShowOptions = document.querySelector(
  "#backup-guide-show-options",
);
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
const backupTestFileInput = document.querySelector("#backup-test-file-input");
const restoreDialog = document.querySelector("#restore-dialog");
const restoreSummary = document.querySelector("#restore-summary");
const restoreError = document.querySelector("#restore-error");
const restoreOptions = document.querySelector("#restore-options");
const restoreChooseFile = document.querySelector("#restore-choose-file");
const restoreCancel = document.querySelector("#restore-cancel");
const restoreDialogClose = document.querySelector("#restore-dialog-close");
const restoreConfirm = document.querySelector("#restore-confirm");
const historyDialog = document.querySelector("#history-dialog");
const historyDialogClose = document.querySelector("#history-dialog-close");
const historySnapshotSelect = document.querySelector("#history-snapshot");
const historyNoteSelect = document.querySelector("#history-note");
const historySummary = document.querySelector("#history-summary");
const historyError = document.querySelector("#history-error");
const historyPreviewTitle = document.querySelector("#history-preview-title");
const historyPreviewBody = document.querySelector("#history-preview-body");
const historyRestoreNote = document.querySelector("#history-restore-note");
const historyRestoreCopy = document.querySelector("#history-restore-copy");
const historyRestoreNotebook = document.querySelector("#history-restore-notebook");
const historyCancel = document.querySelector("#history-cancel");
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
const safetyConflictChoices = document.querySelector("#safety-conflict-choices");
const safetyConflictActions = document.querySelector("#safety-conflict-actions");
const safetyOverwriteConfirmation = document.querySelector("#safety-overwrite-confirmation");
const safetyOverwriteConfirmationTitle = document.querySelector(
  "#safety-overwrite-confirmation-title",
);
const safetyOverwriteSummary = document.querySelector("#safety-overwrite-summary");
const safetyOverwriteActions = document.querySelector("#safety-overwrite-actions");
const safetyOverwriteBack = document.querySelector("#safety-overwrite-back");
const safetyOverwriteCancel = document.querySelector("#safety-overwrite-cancel");
const safetyOverwriteConfirm = document.querySelector("#safety-overwrite-confirm");
const statusBar = document.querySelector("#status-bar");
const fullscreenToggle = document.querySelector("#fullscreen-toggle");
const appearanceDialog = document.querySelector("#appearance-dialog");
const appearanceClose = document.querySelector("#appearance-close");
const appearanceDone = document.querySelector("#appearance-done");
const appearanceColorMode = document.querySelector("#appearance-color-mode");
const appearanceFontFamily = document.querySelector("#appearance-font-family");
const appearanceFontSize = document.querySelector("#appearance-font-size");
const appearanceFontWeight = document.querySelector("#appearance-font-weight");
const appearanceFontStyle = document.querySelector("#appearance-font-style");
const appearanceLineSpacing = document.querySelector("#appearance-line-spacing");
const commandPaletteDialog = document.querySelector("#command-palette-dialog");
const commandPaletteClose = document.querySelector("#command-palette-close");
const commandPaletteSearch = document.querySelector("#command-palette-search");
const commandPaletteStatus = document.querySelector("#command-palette-status");
const commandPaletteResults = document.querySelector("#command-palette-results");
const printView = document.querySelector("#print-view");
const printTitle = document.querySelector("#print-title");
const printBody = document.querySelector("#print-body");
const narrowLayout = window.matchMedia(MOBILE_BREAKPOINT);
const compactToolbar = window.matchMedia(TOOLBAR_BREAKPOINT);
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const THEME_SEQUENCE = ["system", "light", "dark"];
const THEME_ICONS = Object.freeze({ system: "◐", light: "☀", dark: "☾" });
const THEME_LABELS = Object.freeze({
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
});
const themeToggle = document.querySelector("#theme-toggle");
const themeColorMetas = document.querySelectorAll('meta[name="theme-color"]');
const appearanceStore = createAppearanceStore();
let appearance = appearanceStore.load().preferences;

function currentTheme() {
  return appearance.colorMode;
}

function applyTheme(mode) {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
  const next =
    THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(mode) + 1) % THEME_SEQUENCE.length];
  const label = `${THEME_LABELS[mode]}. Switch to ${THEME_LABELS[next].toLowerCase()}`;
  themeToggle.textContent = THEME_ICONS[mode];
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
  for (const meta of themeColorMetas) {
    const dark = mode === "system" ? meta.media.includes("dark") : mode === "dark";
    meta.content = dark ? "#17150f" : "#f7f5f1";
  }
}

function syncAppearanceControls() {
  appearanceColorMode.value = appearance.colorMode;
  appearanceFontFamily.value = appearance.fontFamily;
  appearanceFontSize.value = String(appearance.fontSize);
  appearanceFontWeight.value = String(appearance.fontWeight);
  appearanceFontStyle.value = appearance.fontStyle;
  appearanceLineSpacing.value = String(appearance.lineSpacing);

  for (const button of document.querySelectorAll('[data-app-command="view.word-wrap"]')) {
    button.setAttribute("aria-checked", String(appearance.wordWrap));
  }
  for (const button of document.querySelectorAll('[data-app-command="view.status-bar"]')) {
    button.setAttribute("aria-checked", String(appearance.statusBar));
  }
}

function applyAppearance() {
  const root = document.documentElement;
  root.dataset.fontFamily = appearance.fontFamily;
  root.dataset.fontSize = String(appearance.fontSize);
  root.dataset.fontWeight = String(appearance.fontWeight);
  root.dataset.fontStyle = appearance.fontStyle;
  root.dataset.lineSpacing = String(appearance.lineSpacing);
  root.dataset.wordWrap = String(appearance.wordWrap);
  root.dataset.statusBar = String(appearance.statusBar);
  note.wrap = appearance.wordWrap ? "soft" : "off";
  applyTheme(appearance.colorMode);
  syncAppearanceControls();
}

function updateAppearance(changes, { announce = true } = {}) {
  const result = appearanceStore.update(changes);
  appearance = result.preferences;
  applyAppearance();
  if (!result.persisted && announce) {
    setCommandFeedback(
      "Appearance changed for this visit, but this browser could not save the preference.",
      { important: true },
    );
  }
  return result.persisted;
}

themeToggle.addEventListener("click", () => {
  const sequenceIndex = THEME_SEQUENCE.indexOf(currentTheme());
  updateAppearance({
    colorMode: THEME_SEQUENCE[(sequenceIndex + 1) % THEME_SEQUENCE.length],
  });
});
applyAppearance();

const storageService = createBrowserStorageService();
const loadedNotes = await storageService.initialize();
let notesDocument = loadedNotes.document;
let canSafelySave = loadedNotes.canSafelySave;
let lastBackupMetadata = loadedNotes.lastBackupMetadata;
let externalBackupMetadata = loadedNotes.externalBackupMetadata;
let historyIssue = loadedNotes.historyError;
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
let historyReturnFocus = null;
let historyReadGeneration = 0;
let selectedHistoryDocument = null;
let clearDataReturnFocus = null;
let notebookTransitionPending = false;
let safetyState = null;
let pendingSafetyFile = null;
let safetyFileInputMode = "open";
let safetyOverwritePending = false;
let backupGuideReturnFocus = null;
let openBackupOptionsAfterGuide = false;

const directSafetyFilesSupported = supportsDirectSafetyFiles(window);
const safetyCoordinator = createSafetyFileCoordinator({
  storageService,
  initialConnection: loadedNotes.safetyFileConnection,
  directSupported: directSafetyFilesSupported,
  onStateChange: (state) => {
    safetyState = state;
    if (state.kind === SAFETY_FILE_STATES.BACKED_UP && state.verifiedAt) {
      const connection = safetyCoordinator.getConnection();
      if (connection) {
        externalBackupMetadata = {
          version: 1,
          kind: "safety-file",
          identity: connection.fileId,
          contentAt: connection.fileUpdatedAt,
          verifiedAt: connection.verifiedAt,
        };
        renderBackupStatus();
      }
    }
    renderSafetyFileStatus();
  },
  historyProvider: () => storageService.exportHistory(),
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

/* Crash-safety journal: IndexedDB saves are debounced and asynchronous, so a
   crash or process eviction can drop the final edits. Each keystroke writes
   the active note synchronously to localStorage; the journal is cleared once
   the notebook persists and reconciled at the next startup. */
const RECOVERY_STORAGE_KEY = "jotkeep.recovery.v1";
const RECOVERY_MAX_CONTENT_LENGTH = 256 * 1024;

function writeRecoveryJournal() {
  const savedNote = activeNote();
  try {
    if (!savedNote || savedNote.content.length > RECOVERY_MAX_CONTENT_LENGTH) {
      localStorage.removeItem(RECOVERY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        noteId: savedNote.id,
        title: savedNote.title,
        content: savedNote.content,
        updatedAt: savedNote.updatedAt,
      }),
    );
  } catch {
    /* Recovery is best-effort; the debounced IndexedDB save still runs. */
  }
}

function clearRecoveryJournal() {
  try {
    localStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    /* A stale journal is discarded at reconciliation instead. */
  }
}

function readRecoveryJournal() {
  try {
    const raw = localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      parsed?.version === 1 &&
      typeof parsed.noteId === "string" &&
      typeof parsed.title === "string" &&
      typeof parsed.content === "string" &&
      typeof parsed.updatedAt === "string"
    ) {
      return parsed;
    }
  } catch {
    /* Unreadable journals are treated as absent. */
  }
  return null;
}

let recoveredUnsavedEdits = false;
{
  const journal = readRecoveryJournal();
  if (journal) {
    const match = notesDocument.notes.find((item) => item.id === journal.noteId);
    if (
      match &&
      journal.updatedAt > match.updatedAt &&
      (match.title !== journal.title || match.content !== journal.content)
    ) {
      notesDocument = updateNote(notesDocument, journal.noteId, {
        title: journal.title,
        content: journal.content,
      });
      recoveredUnsavedEdits = true;
    } else {
      clearRecoveryJournal();
    }
  }
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

function setCommandFeedback(message, { important = false } = {}) {
  commandFeedback.textContent = message;
  appAnnouncer.textContent = message;
  statusBar.classList.toggle(
    "has-important-feedback",
    Boolean(message) && important,
  );
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
  if (externalBackupMetadata === null) {
    backupStatus.textContent = "No recoverable external backup verified";
    backupStatus.dataset.tone = "warning";
    backupStatus.title = lastBackupMetadata === null
      ? "Browser storage and local history are not external backups."
      : `A JSON download was requested ${timestampFormatter.format(new Date(lastBackupMetadata.createdAt))}, but this browser has not tested the downloaded file.`;
    return;
  }

  const contentDate = new Date(externalBackupMetadata.contentAt);
  const ageMs = Math.max(0, Date.now() - contentDate.getTime());
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  const age = days > 0
    ? pluralizedCount(days, "day", "days")
    : hours > 0
      ? pluralizedCount(hours, "hour", "hours")
      : "less than an hour";
  const stale = ageMs > 7 * 24 * 60 * 60 * 1000;
  backupStatus.textContent = stale
    ? `External backup is ${age} old — test or update it`
    : `External backup: ${age} old`;
  backupStatus.dataset.tone = stale ? "warning" : "success";
  backupStatus.title = `Content from ${externalBackupMetadata.contentAt}; last verified ${externalBackupMetadata.verifiedAt}. Manual verification cannot prove that a file still exists afterward.`;
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
  statusBar.classList.toggle("is-critical", Boolean(storageIssue));
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
  const query = searchInput.value.trim();
  const hasQuery = query !== "";
  const hasNoMatches = hasQuery && matchingNotes.length === 0;
  const fragment = document.createDocumentFragment();

  for (const savedNote of matchingNotes) {
    fragment.append(createNoteListItem(savedNote));
  }

  notesList.replaceChildren(fragment);
  notesList.dataset.view = notesDocument.preferences.listView;
  noteSearchCount.hidden = !hasQuery;
  noteSearchCount.textContent = hasQuery
    ? pluralizedCount(matchingNotes.length, "matching note", "matching notes")
    : "";
  notesEmptyState.hidden = !hasNoMatches;
  notesEmptyMessage.textContent = hasNoMatches
    ? `No notes match “${query}”.`
    : "";
  sortSelect.value = notesDocument.preferences.sortBy;
  listViewSelect.value = notesDocument.preferences.listView;
  noteCountFooter.textContent = `${pluralizedCount(notesDocument.notes.length, "note", "notes")} · local first`;
}

const FIRST_USE_GUIDE_DISMISSED_KEY = "jotkeep.first-use-guide.dismissed.v1";

function firstUseGuideWasDismissed() {
  try {
    return localStorage.getItem(FIRST_USE_GUIDE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function dismissFirstUseGuide({ remember = false } = {}) {
  firstUseGuide.hidden = true;
  if (remember) {
    try {
      localStorage.setItem(FIRST_USE_GUIDE_DISMISSED_KEY, "true");
    } catch {
      /* The guide can still close for this visit when storage is unavailable. */
    }
  }
}

function resetFirstUseGuideDismissal() {
  try {
    localStorage.removeItem(FIRST_USE_GUIDE_DISMISSED_KEY);
  } catch {
    /* Clearing IndexedDB remains useful if localStorage is unavailable. */
  }
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
const initialNote = activeNote();
firstUseGuide.hidden = !(
  loadedNotes.documentGenerated === true &&
  notesDocument.notes.length === 1 &&
  initialNote.title === "" &&
  initialNote.content === "" &&
  !firstUseGuideWasDismissed()
);
renderBackupStatus();
window.setInterval(renderBackupStatus, BACKUP_STATUS_REFRESH_MS);
renderStorageStatus();
appShell.inert = false;
appShell.removeAttribute("aria-busy");
// The textarea deliberately has no autofocus attribute: the shell ships inert
// so pre-bootstrap keystrokes cannot be silently dropped. The boot-focus
// class suppresses the focus ring this programmatic focus would draw
// (autofocus never drew one); real keyboard interaction restores it.
note.classList.add("boot-focus");
const removeBootFocus = () => note.classList.remove("boot-focus");
note.addEventListener("keydown", removeBootFocus, { once: true });
note.addEventListener("pointerdown", removeBootFocus, { once: true });
note.addEventListener("blur", removeBootFocus, { once: true });
note.focus({ preventScroll: true });

const autosave = createAutosave({
  delay: AUTOSAVE_DELAY_MS,
  save: async () => {
    if (!canSafelySave) {
      throw storageIssue ?? new Error("Stored notes cannot be safely replaced.");
    }
    const result = await storageService.saveNotebook(structuredClone(notesDocument));
    if (result?.snapshotError) {
      setCommandFeedback(
        `${result.snapshotError.message} Current notes were still saved.`,
        { important: true },
      );
    }
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
    clearRecoveryJournal();
    warnWhenApproachingBackupLimit();
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
if (recoveredUnsavedEdits) {
  autosave.markDirty();
  showActiveNote();
  setCommandFeedback("Recovered edits that had not finished saving.");
}
void safetyCoordinator.initialize(notesDocument, {
  documentGenerated: loadedNotes.documentGenerated === true,
});

/* Backups and Safety Files stop working at 25 MiB, so warn well before the
   notebook gets there instead of failing every complete-backup route at once. */
const BACKUP_LIMIT_WARN_CHARACTERS = 20 * 1024 * 1024;
const BACKUP_LIMIT_REARM_CHARACTERS = 18 * 1024 * 1024;
let warnedAboutBackupLimit = false;

function warnWhenApproachingBackupLimit() {
  const estimatedSize = JSON.stringify(notesDocument).length;
  if (estimatedSize > BACKUP_LIMIT_WARN_CHARACTERS && !warnedAboutBackupLimit) {
    warnedAboutBackupLimit = true;
    setCommandFeedback(
      "This notebook is approaching the 25 MiB backup limit. Download large notes as text files or split the notebook soon.",
      { important: true },
    );
  } else if (estimatedSize < BACKUP_LIMIT_REARM_CHARACTERS) {
    warnedAboutBackupLimit = false;
  }
}

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
  writeRecoveryJournal();
  setCommandFeedback("");
  renderNotes();
  safetyCoordinator.markDirty();
  autosave.markDirty();
  return true;
}

titleInput.addEventListener("input", () => {
  if (updateActiveNote({ title: titleInput.value })) {
    dismissFirstUseGuide();
  }
});

note.addEventListener("input", () => {
  updateCounts();
  if (updateActiveNote({ content: note.value })) {
    dismissFirstUseGuide();
  }
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
  closeViewMenu();
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
  closeViewMenu();
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
  closeViewMenu();
  fileMenu.hidden = false;
  fileButton.setAttribute("aria-expanded", "true");
  fileMenu.querySelector('[role="menuitem"]').focus();
}

function openFirstUseBackupOptions() {
  const menu = compactToolbar.matches ? commandMenu : fileMenu;
  if (compactToolbar.matches) {
    openMenu();
  } else {
    openFileMenu();
  }

  const preferredAction = directSafetyFilesSupported
    ? "create-safety"
    : "download-safety";
  const preferredButton = menu.querySelector(
    `[data-file-action="${preferredAction}"]`,
  );
  preferredButton?.focus();
}

function openBackupGuide(trigger) {
  closeAllMenus();
  backupGuideReturnFocus = trigger;
  openBackupOptionsAfterGuide = false;
  backupGuideDialog.showModal();
  backupGuideClose.focus();
}

function closeBackupGuide({ showOptions = false } = {}) {
  openBackupOptionsAfterGuide = showOptions;
  if (backupGuideDialog.open) {
    backupGuideDialog.close();
  }
}

firstUseGuideClose.addEventListener("click", () => {
  dismissFirstUseGuide({ remember: true });
  note.focus();
});
firstUseBackupOptions.addEventListener("click", () => {
  openBackupGuide(firstUseBackupOptions);
});
backupHelp.addEventListener("click", () => openBackupGuide(backupHelp));
backupGuideClose.addEventListener("click", () => closeBackupGuide());
backupGuideNotNow.addEventListener("click", () => closeBackupGuide());
backupGuideShowOptions.addEventListener("click", () => {
  closeBackupGuide({ showOptions: true });
});
backupGuideDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeBackupGuide();
});
backupGuideDialog.addEventListener("close", () => {
  const returnFocus = backupGuideReturnFocus;
  const showOptions = openBackupOptionsAfterGuide;
  backupGuideReturnFocus = null;
  openBackupOptionsAfterGuide = false;
  if (showOptions) {
    openFirstUseBackupOptions();
  } else {
    returnFocus?.focus();
  }
});

function closeViewMenu({ returnFocus = false } = {}) {
  if (viewMenu.hidden) {
    return;
  }

  viewMenu.hidden = true;
  viewButton.setAttribute("aria-expanded", "false");

  if (returnFocus) {
    viewButton.focus();
  }
}

function openViewMenu() {
  closeMenu();
  closeInsertMenu();
  closeFileMenu();
  viewMenu.hidden = false;
  viewButton.setAttribute("aria-expanded", "true");
  viewMenu.querySelector('[role^="menuitem"]').focus();
}

function closeAllMenus() {
  closeMenu();
  closeInsertMenu();
  closeFileMenu();
  closeViewMenu();
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

viewButton.addEventListener("click", () => {
  if (viewMenu.hidden) {
    openViewMenu();
  } else {
    closeViewMenu({ returnFocus: true });
  }
});

function addMenuKeyboardHandling(menu, close) {
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll('[role^="menuitem"]')].filter(
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
addMenuKeyboardHandling(viewMenu, closeViewMenu);

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
  if (!viewMenu.hidden && !viewPopup.contains(event.target)) {
    closeViewMenu();
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
  // Revoking immediately can break the download in browsers that fetch the
  // object URL asynchronously; give the download a generous head start.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
      setCommandFeedback(`Could not open Safety File: ${error.message}`, {
        important: true,
      });
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
      `Created and verified unencrypted Safety File “${handle.name}”. Anyone with access to the file can read its note titles and content. Automatic updates are connected.`,
      { important: true },
    );
  } catch (error) {
    if (error?.name !== "AbortError") {
      setCommandFeedback(`Could not create Safety File: ${error.message}`, {
        important: true,
      });
    }
  }
}

async function downloadSafetyFile() {
  await autosave.flush();
  try {
    const value = createSafetyFile(notesDocument, {
      history: storageService.exportHistory(),
    });
    value.checksum = await safetyFileChecksum(value);
    const serialized = serializeSafetyFile(value);
    const filename = safetyFileFilename(value.createdAt);
    downloadFile(serialized, "application/json;charset=utf-8", filename);
    setCommandFeedback(
      `Prepared unencrypted Safety File download “${filename}”. Anyone with access to the file can read its note titles and content. This browser cannot verify that the downloaded file remains on disk.`,
      { important: true },
    );
  } catch (error) {
    setCommandFeedback(`Could not prepare Safety File: ${error.message}`, {
      important: true,
    });
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
        { important: true },
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
        setCommandFeedback(`Could not verify Safety File: ${error.message}`, {
          important: true,
        });
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
    setCommandFeedback(
      `Could not ${safetyFileInputMode === "verify" ? "verify" : "open"} Safety File: ${error.message}`,
      { important: true },
    );
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
    await storageService.restoreNotebook(candidate, {
      currentDocument: notesDocument,
      importedHistory: mode === "replace" ? read.value.history : null,
    });
    clearRecoveryJournal();

    textImportGeneration += 1;
    notesDocument = candidate;
    canSafelySave = true;
    storageIssue = null;
    historyIssue = null;
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
      // Even a replacement adds the local pre-restore checkpoint and may
      // upgrade a version 1 file, so write the verified local recovery bundle.
      safetyCoordinator.markDirty();
      safetyCoordinator.localSaveSettled(candidate);
      await safetyCoordinator.waitForIdle();
    }

    closeSafetyOpenDialog();
    if (
      selected.handle &&
      mode === "merge" &&
      safetyState.kind !== SAFETY_FILE_STATES.BACKED_UP
    ) {
      setCommandFeedback(
        `Merged “${read.fileName}” locally, but the Safety File was not updated: ${safetyState.error?.message ?? "check its backup status"}`,
        { important: true },
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
  if (safetyConflictDialog.open && !safetyOverwritePending) {
    safetyConflictDialog.close();
  }
}

function showSafetyConflictChoices({ focusOverwrite = false } = {}) {
  safetyConflictChoices.hidden = false;
  safetyConflictActions.hidden = false;
  safetyOverwriteConfirmation.hidden = true;
  safetyOverwriteActions.hidden = true;
  safetyOverwriteConfirmationTitle.textContent = "Overwrite the Safety File?";
  safetyOverwriteSummary.textContent = "";
  if (focusOverwrite) {
    safetyOverwriteFile.focus();
  }
}

function showSafetyOverwriteConfirmation() {
  const connection = safetyCoordinator.getConnection();
  if (!connection) {
    safetyConflictError.textContent =
      "The Safety File is no longer connected. Close this dialog and check the Safety File status.";
    safetyConflictError.hidden = false;
    return;
  }

  safetyConflictError.hidden = true;
  safetyConflictError.textContent = "";
  safetyConflictChoices.hidden = true;
  safetyConflictActions.hidden = true;
  safetyOverwriteConfirmation.hidden = false;
  safetyOverwriteActions.hidden = false;
  safetyOverwriteConfirmationTitle.textContent = `Overwrite “${connection.fileName}”?`;
  safetyOverwriteSummary.textContent =
    `The current content of “${connection.fileName}” will be removed.`;
  safetyOverwriteConfirmationTitle.focus();
}

function setSafetyOverwritePending(pending) {
  safetyOverwritePending = pending;
  safetyConflictClose.disabled = pending;
  safetyOverwriteBack.disabled = pending;
  safetyOverwriteCancel.disabled = pending;
  safetyOverwriteConfirm.disabled = pending;
  safetyOverwriteConfirm.textContent = pending
    ? "Overwriting…"
    : "Overwrite Safety File";
}

function resetSafetyConflictDialog() {
  setSafetyOverwritePending(false);
  safetyConflictError.hidden = true;
  safetyConflictError.textContent = "";
  showSafetyConflictChoices();
}

safetyConflictClose.addEventListener("click", closeSafetyConflictDialog);
safetyConflictCancel.addEventListener("click", closeSafetyConflictDialog);
safetyOverwriteCancel.addEventListener("click", closeSafetyConflictDialog);
safetyOverwriteBack.addEventListener("click", () => {
  showSafetyConflictChoices({ focusOverwrite: true });
});
safetyConflictDialog.addEventListener("cancel", (event) => {
  if (safetyOverwritePending) {
    event.preventDefault();
  }
});
safetyConflictDialog.addEventListener("close", resetSafetyConflictDialog);
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
    await storageService.restoreNotebook(read.value.document, {
      currentDocument: notesDocument,
      importedHistory: read.value.history,
    });
    clearRecoveryJournal();
    notesDocument = structuredClone(read.value.document);
    textImportGeneration += 1;
    canSafelySave = true;
    storageIssue = null;
    historyIssue = null;
    autosave.reset(SAVE_STATES.SAVED);
    saveState.textContent = `Local: ${SAVE_STATES.SAVED}`;
    searchInput.value = "";
    renderNotes();
    renderStorageStatus();
    showActiveNote({ focus: "body" });
    await safetyCoordinator.connectVerified(connection.handle, read, notesDocument);
    safetyCoordinator.markDirty();
    safetyCoordinator.localSaveSettled(notesDocument);
    await safetyCoordinator.waitForIdle();
    closeSafetyConflictDialog();
    setCommandFeedback(`Replaced the local notebook with Safety File “${connection.fileName}”.`);
  } catch (error) {
    safetyConflictError.textContent = `Could not use the Safety File: ${error.message}`;
    safetyConflictError.hidden = false;
  }
});
safetyOverwriteFile.addEventListener("click", () => {
  showSafetyOverwriteConfirmation();
});
safetyOverwriteConfirm.addEventListener("click", async () => {
  safetyConflictError.hidden = true;
  safetyConflictError.textContent = "";
  setSafetyOverwritePending(true);
  if (await safetyCoordinator.overwrite(structuredClone(notesDocument))) {
    setSafetyOverwritePending(false);
    closeSafetyConflictDialog();
    setCommandFeedback("Overwrote and verified the Safety File with the local notebook.");
  } else {
    setSafetyOverwritePending(false);
    safetyConflictError.textContent = safetyState.error?.message ?? "Could not overwrite the Safety File.";
    safetyConflictError.hidden = false;
    safetyOverwriteConfirm.focus();
  }
});

async function importTextFile(file, generation) {
  if (!/\.txt$/iu.test(file.name)) {
    throw new TypeError("Choose a file whose name ends in .txt.");
  }

  const content = decodeUtf8(await file.arrayBuffer());
  if (generation !== textImportGeneration || notebookTransitionPending) {
    return;
  }

  // Disable the editor for the whole transition so typing during a slow save
  // cannot apply stale field values to the imported note.
  setNotebookTransitionPending(true);
  let saved;
  try {
    await autosave.flush();
    notesDocument = addNote(notesDocument, {
      title: titleFromTextFilename(file.name),
      content,
    });
    searchInput.value = "";
    saved = await persistImmediately();
  } finally {
    setNotebookTransitionPending(false);
  }
  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
  showActiveNote({ focus: "body" });
  renderNotes();
  setCommandFeedback(
    saved
      ? `Imported “${file.name}” as a new note.`
      : `Imported “${file.name}” for this session, but browser storage is unavailable.`,
    { important: !saved },
  );
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
      setCommandFeedback(`Could not import text: ${error.message}`, {
        important: true,
      });
    }
  }
});

async function downloadActiveNote() {
  await autosave.flush();
  const savedNote = activeNote();
  const filename = sanitizeFilename(savedNote.title);
  downloadFile(savedNote.content, "text/plain;charset=utf-8", filename);
  setCommandFeedback(`Requested text download “${filename}”.`);
}

async function exportJsonBackup() {
  await autosave.flush();

  try {
    const backup = createBackup(notesDocument);
    backup.checksum = await notebookChecksum(backup.document);
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
        ? `Requested JSON backup download “${filename}”. Confirm the download finished and keep the file somewhere safe.`
        : `Requested JSON backup download “${filename}”, but this browser could not remember its date.`,
      { important: !metadataSaved },
    );
  } catch (error) {
    setCommandFeedback(`Could not create backup: ${error.message}`, {
      important: true,
    });
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
        { important: true },
      );
      break;
    case PERSISTENCE_STATES.UNSUPPORTED:
      setCommandFeedback(
        "This browser does not offer a persistent-storage request. Keep JSON backups somewhere safe.",
        { important: true },
      );
      break;
    default:
      setCommandFeedback(
        "JotKeep could not request persistent storage. Editing and browser saves still work.",
        { important: true },
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

  const parsed = parseBackup(text, { byteLength: file.size });
  await verifyBackupChecksum(parsed);
  return parsed;
}

async function rememberExternalBackup({ kind, identity, contentAt }) {
  const verification = {
    kind,
    identity,
    contentAt,
    verifiedAt: new Date().toISOString(),
  };
  try {
    externalBackupMetadata = await storageService.saveExternalBackupVerification(
      verification,
    );
    renderBackupStatus();
    return true;
  } catch (error) {
    reportStorageIssue(error);
    return false;
  }
}

async function reportTestedSafetyFile(read, label) {
  const remembered = await rememberExternalBackup({
    kind: "safety-file",
    identity: read.value.fileId,
    contentAt: read.value.updatedAt,
  });
  setCommandFeedback(
    `Test passed for “${label}”: ${pluralizedCount(read.value.document.notes.length, "note", "notes")} and ${pluralizedCount(read.value.history.snapshots.length, "restore point", "restore points")} are recoverable${remembered ? "." : ", but this browser could not remember the test date."}`,
    { important: !remembered },
  );
}

async function testConnectedBackup() {
  const connection = safetyCoordinator.getConnection();
  if (!connection) {
    chooseFile(backupTestFileInput);
    return;
  }
  try {
    const read = await readSafetyFileHandle(connection.handle);
    await reportTestedSafetyFile(read, connection.fileName);
    if (read.digest !== connection.fileDigest) {
      await safetyCoordinator.verify(notesDocument);
    }
  } catch (error) {
    setCommandFeedback(`Backup test failed: ${error.message}`, {
      important: true,
    });
  }
}

backupTestFileInput.addEventListener("change", async () => {
  const [file] = backupTestFileInput.files;
  backupTestFileInput.value = "";
  if (!file) {
    return;
  }
  try {
    if (/\.jotkeep$/iu.test(file.name)) {
      await reportTestedSafetyFile(await readSafetyFile(file), file.name);
      return;
    }
    if (/\.json$/iu.test(file.name)) {
      const backup = await readBackupFile(file);
      const identity = backup.checksum ?? await fingerprintText(JSON.stringify(backup));
      const remembered = await rememberExternalBackup({
        kind: "json-backup",
        identity,
        contentAt: backup.createdAt,
      });
      setCommandFeedback(
        `Test passed for “${file.name}”: ${pluralizedCount(backup.document.notes.length, "note", "notes")} are recoverable${remembered ? "." : ", but this browser could not remember the test date."}`,
        { important: !remembered },
      );
      return;
    }
    throw new TypeError("Choose a .jotkeep Safety File or a .json JotKeep backup.");
  } catch (error) {
    setCommandFeedback(`Backup test failed: ${error.message}`, {
      important: true,
    });
  }
});

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
    await storageService.restoreNotebook(candidate, {
      currentDocument: notesDocument,
    });
  } catch (error) {
    reportStorageIssue(error);
    restoreError.textContent =
      "JotKeep could not save the restored notebook. Check browser storage access or available space; no notes were changed.";
    restoreError.hidden = false;
    return;
  }

  clearRecoveryJournal();
  textImportGeneration += 1;
  notesDocument = candidate;
  canSafelySave = true;
  storageIssue = null;
  historyIssue = null;
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

function setHistoryActionsEnabled(enabled) {
  historyNoteSelect.disabled = !enabled;
  historyRestoreNote.disabled = !enabled;
  historyRestoreCopy.disabled = !enabled;
  historyRestoreNotebook.disabled = !enabled;
}

function renderHistoryPreview() {
  const savedNote = selectedHistoryDocument?.notes.find(
    (item) => item.id === historyNoteSelect.value,
  );
  historyPreviewTitle.textContent = savedNote ? displayNoteTitle(savedNote) : "";
  historyPreviewBody.value = savedNote?.content ?? "";
}

async function loadSelectedHistorySnapshot() {
  const snapshotId = historySnapshotSelect.value;
  const generation = ++historyReadGeneration;
  selectedHistoryDocument = null;
  setHistoryActionsEnabled(false);
  historyError.hidden = true;
  historyError.textContent = "";
  historySummary.textContent = "Validating restore point…";
  historyPreviewTitle.textContent = "";
  historyPreviewBody.value = "";
  historyNoteSelect.replaceChildren();

  if (!snapshotId) {
    historySummary.textContent = historyIssue
      ? "Notebook history is unavailable."
      : "History begins after changes to this notebook are saved.";
    if (historyIssue) {
      historyError.textContent = historyIssue.message;
      historyError.hidden = false;
    }
    return;
  }

  try {
    const documentAtTime = await storageService.loadSnapshot(snapshotId);
    if (generation !== historyReadGeneration || !historyDialog.open) {
      return;
    }
    selectedHistoryDocument = documentAtTime;
    const fragment = document.createDocumentFragment();
    for (const savedNote of documentAtTime.notes) {
      const option = document.createElement("option");
      option.value = savedNote.id;
      option.textContent = displayNoteTitle(savedNote);
      fragment.append(option);
    }
    historyNoteSelect.replaceChildren(fragment);
    historyNoteSelect.value = documentAtTime.activeNoteId;
    const snapshot = storageService.listSnapshots().find(
      (item) => item.id === snapshotId,
    );
    const reason = snapshot?.kind === SNAPSHOT_KINDS.PRE_RESTORE
      ? "Before a restore · "
      : snapshot?.kind === SNAPSHOT_KINDS.BEFORE_DELETE
        ? "Before a deletion · "
        : "";
    historySummary.textContent = `${pluralizedCount(documentAtTime.notes.length, "note", "notes")} · ${reason}${timestampFormatter.format(new Date(snapshot?.createdAt))}`;
    setHistoryActionsEnabled(true);
    renderHistoryPreview();
  } catch (error) {
    if (generation !== historyReadGeneration) {
      return;
    }
    historySummary.textContent = "This restore point cannot be previewed.";
    historyError.textContent = `History validation failed: ${error.message}`;
    historyError.hidden = false;
  }
}

function historyGroup(snapshot) {
  if (snapshot.kind === "pre-restore") {
    return "Before restores";
  }
  if (snapshot.kind === SNAPSHOT_KINDS.BEFORE_DELETE) {
    return "Before deletions";
  }
  const age = Math.max(0, Date.now() - new Date(snapshot.createdAt).getTime());
  if (age < 24 * 60 * 60 * 1000) {
    return "Recent";
  }
  if (age < 31 * 24 * 60 * 60 * 1000) {
    return "Daily";
  }
  return "Weekly";
}

async function openHistoryDialog(trigger) {
  closeAllMenus();
  historyReturnFocus = trigger;
  historyError.hidden = true;
  historyError.textContent = "";
  historySnapshotSelect.replaceChildren();
  selectedHistoryDocument = null;
  setHistoryActionsEnabled(false);

  let snapshots = [];
  try {
    snapshots = storageService.listSnapshots();
  } catch (error) {
    historyIssue = error;
  }
  const groups = new Map();
  for (const snapshot of snapshots) {
    const label = historyGroup(snapshot);
    if (!groups.has(label)) {
      const group = document.createElement("optgroup");
      group.label = label;
      groups.set(label, group);
      historySnapshotSelect.append(group);
    }
    const option = document.createElement("option");
    option.value = snapshot.id;
    option.textContent = timestampFormatter.format(new Date(snapshot.createdAt));
    groups.get(label).append(option);
  }

  historyDialog.showModal();
  await loadSelectedHistorySnapshot();
  historySnapshotSelect.focus();
}

function closeHistoryDialog() {
  if (historyDialog.open) {
    historyDialog.close();
  }
}

historyDialogClose.addEventListener("click", closeHistoryDialog);
historyCancel.addEventListener("click", closeHistoryDialog);
historyDialog.addEventListener("close", () => {
  historyReadGeneration += 1;
  selectedHistoryDocument = null;
  historyReturnFocus?.focus();
  historyReturnFocus = null;
});
historySnapshotSelect.addEventListener("change", () => {
  void loadSelectedHistorySnapshot();
});
historyNoteSelect.addEventListener("change", renderHistoryPreview);

async function applyHistoryRestore(mode) {
  if (!selectedHistoryDocument) {
    return;
  }
  const historicalNote = selectedHistoryDocument.notes.find(
    (item) => item.id === historyNoteSelect.value,
  );
  if (!historicalNote && mode !== "notebook") {
    return;
  }
  if (
    mode === "note" &&
    notesDocument.notes.some((item) => item.id === historicalNote.id) &&
    !window.confirm(`Replace the current “${displayNoteTitle(historicalNote)}” with this earlier version?`)
  ) {
    return;
  }
  if (
    mode === "notebook" &&
    !window.confirm("Restore this full notebook? JotKeep will first keep the current notebook as a recovery point.")
  ) {
    return;
  }

  const before = notesDocument;
  setNotebookTransitionPending(true);
  setHistoryActionsEnabled(false);
  historyError.hidden = true;
  await safetyCoordinator.suspend();
  try {
    if (!(await autosave.flush())) {
      throw new Error("Current edits could not be saved before the restore.");
    }
    await safetyCoordinator.waitForIdle();
    const candidate = mode === "notebook"
      ? structuredClone(selectedHistoryDocument)
      : restoreNoteFromSnapshot(
          notesDocument,
          selectedHistoryDocument,
          historicalNote.id,
          { asCopy: mode === "copy" },
        );
    await storageService.restoreNotebook(candidate, {
      currentDocument: notesDocument,
    });

    clearRecoveryJournal();
    textImportGeneration += 1;
    notesDocument = candidate;
    canSafelySave = true;
    storageIssue = null;
    historyIssue = null;
    autosave.reset(SAVE_STATES.SAVED);
    saveState.textContent = `Local: ${SAVE_STATES.SAVED}`;
    searchInput.value = "";
    renderNotes();
    renderStorageStatus();
    showActiveNote({ focus: "body" });
    safetyCoordinator.markDirty();
    safetyCoordinator.resume(candidate);
    closeHistoryDialog();
    setCommandFeedback(
      mode === "copy"
        ? `Restored “${displayNoteTitle(historicalNote)}” as a new copy.`
        : mode === "note"
          ? `Restored the earlier version of “${displayNoteTitle(historicalNote)}”.`
          : `Restored the full notebook. The previous state remains in history.`,
    );
  } catch (error) {
    notesDocument = before;
    safetyCoordinator.resume(before);
    historyError.textContent = `Restore failed: ${error.message}`;
    historyError.hidden = false;
    setHistoryActionsEnabled(selectedHistoryDocument !== null);
  } finally {
    setNotebookTransitionPending(false);
  }
}

historyRestoreNote.addEventListener("click", () => void applyHistoryRestore("note"));
historyRestoreCopy.addEventListener("click", () => void applyHistoryRestore("copy"));
historyRestoreNotebook.addEventListener("click", () => void applyHistoryRestore("notebook"));

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

  clearRecoveryJournal();
  resetFirstUseGuideDismissal();
  // Appearance is device-local rather than part of the notebook document,
  // but the dialog promises to remove every JotKeep preference in this browser.
  const clearedAppearance = appearanceStore.clear();
  appearance = clearedAppearance.preferences;
  applyAppearance();
  textImportGeneration += 1;
  autosave.reset(SAVE_STATES.CLEARED);
  canSafelySave = true;
  storageIssue = null;
  notesDocument = createNotesDocument();
  lastBackupMetadata = null;
  externalBackupMetadata = null;
  historyIssue = null;
  await safetyCoordinator.disconnect({ persist: false });
  searchInput.value = "";
  renderNotes();
  renderBackupStatus();
  renderStorageStatus();
  showActiveNote({ focus: "body" });
  firstUseGuide.hidden = false;
  closeClearDataDialog();
  setCommandFeedback(
    clearedAppearance.persisted
      ? "All JotKeep data was cleared from this browser."
      : "Notes were cleared, but this browser could not remove its stored appearance preference.",
    { important: !clearedAppearance.persisted },
  );
});

async function executeFileAction(action, trigger = null) {
  closeAllMenus();

  switch (action) {
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
      case "test-backup":
        await testConnectedBackup();
        break;
      case "grant-safety":
        if (await safetyCoordinator.grant(notesDocument)) {
          setCommandFeedback("Safety File access restored and the file was verified.");
        } else {
          setCommandFeedback(
            safetyState.error?.message ??
              "Safety File access was not granted. Local saves continue normally.",
            { important: true },
          );
        }
        break;
      case "resolve-safety":
        resetSafetyConflictDialog();
        safetyConflictDialog.showModal();
        break;
      case "disconnect-safety":
        if (await safetyCoordinator.disconnect()) {
          setCommandFeedback("Disconnected the Safety File. The external file was not changed.");
        } else {
          setCommandFeedback(safetyState.error.message, { important: true });
        }
        break;
      case "export-backup":
        await exportJsonBackup();
        break;
      case "restore-backup":
        restoreReturnFocus = trigger?.closest("#file-menu")
          ? fileButton
          : trigger?.closest("#command-menu")
            ? moreButton
            : trigger ?? fileButton;
        chooseFile(backupFileInput);
        break;
      case "browse-history":
        await openHistoryDialog(
          trigger?.closest("#file-menu")
            ? fileButton
            : trigger?.closest("#command-menu")
              ? moreButton
              : trigger ?? fileButton,
        );
        break;
      case "persist-storage":
        await requestBrowserPersistence();
        break;
      case "clear-data":
        openClearDataDialog(
          trigger?.closest("#file-menu")
            ? fileButton
            : trigger?.closest("#command-menu")
              ? moreButton
              : trigger ?? fileButton,
        );
        break;
  }
}

for (const button of document.querySelectorAll("[data-file-action]")) {
  button.addEventListener("click", async () => {
    await executeFileAction(button.dataset.fileAction, button);
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

let appearanceReturnFocus = null;

function openAppearanceDialog(trigger = null) {
  closeAllMenus();
  appearanceReturnFocus = trigger?.closest("#command-menu")
    ? moreButton
    : trigger?.closest("#view-menu")
      ? viewButton
      : trigger;
  syncAppearanceControls();
  if (!appearanceDialog.open) {
    appearanceDialog.showModal();
  }
  appearanceColorMode.focus();
}

function closeAppearanceDialog() {
  if (appearanceDialog.open) {
    appearanceDialog.close();
  }
}

appearanceClose.addEventListener("click", closeAppearanceDialog);
appearanceDone.addEventListener("click", closeAppearanceDialog);
appearanceDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAppearanceDialog();
});
appearanceDialog.addEventListener("close", () => {
  appearanceReturnFocus?.focus();
  appearanceReturnFocus = null;
});

appearanceColorMode.addEventListener("change", () => {
  updateAppearance({ colorMode: appearanceColorMode.value });
});
appearanceFontFamily.addEventListener("change", () => {
  updateAppearance({ fontFamily: appearanceFontFamily.value });
});
appearanceFontSize.addEventListener("change", () => {
  updateAppearance({ fontSize: Number(appearanceFontSize.value) });
});
appearanceFontWeight.addEventListener("change", () => {
  updateAppearance({ fontWeight: Number(appearanceFontWeight.value) });
});
appearanceFontStyle.addEventListener("change", () => {
  updateAppearance({ fontStyle: appearanceFontStyle.value });
});
appearanceLineSpacing.addEventListener("change", () => {
  updateAppearance({ lineSpacing: Number(appearanceLineSpacing.value) });
});

function resetAppearance() {
  const result = appearanceStore.reset();
  appearance = result.preferences;
  applyAppearance();
  setCommandFeedback(
    result.persisted
      ? "Appearance reset to the defaults."
      : "Appearance reset for this visit, but this browser could not save the preference.",
    { important: !result.persisted },
  );
}

function setFullscreenControls(active) {
  const label = active ? "Exit fullscreen" : "Enter fullscreen";
  fullscreenToggle.setAttribute("aria-label", label);
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.title = label;
  for (const button of document.querySelectorAll('[data-app-command="view.fullscreen"]')) {
    if (button === fullscreenToggle) {
      continue;
    }
    button.textContent = label;
  }
}

async function toggleFullscreen() {
  closeAllMenus();
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (typeof document.documentElement.requestFullscreen === "function") {
      await document.documentElement.requestFullscreen();
    } else {
      setCommandFeedback("Fullscreen is unavailable in this browser.", {
        important: true,
      });
    }
  } catch {
    setCommandFeedback("The browser did not allow JotKeep to enter fullscreen.", {
      important: true,
    });
  }
}

document.addEventListener("fullscreenchange", () => {
  setFullscreenControls(Boolean(document.fullscreenElement));
});
document.addEventListener("fullscreenerror", () => {
  setCommandFeedback("The browser could not change fullscreen mode.", {
    important: true,
  });
});
setFullscreenControls(Boolean(document.fullscreenElement));

function preparePrintView() {
  printTitle.textContent = titleInput.value.trim() || "Untitled Note";
  printBody.textContent = note.value;
  printView.setAttribute("aria-hidden", "false");
}

function clearPrintView() {
  printView.setAttribute("aria-hidden", "true");
  printTitle.textContent = "";
  printBody.textContent = "";
}

function printActiveNote() {
  closeAllMenus();
  preparePrintView();
  window.print();
}

window.addEventListener("beforeprint", preparePrintView);
window.addEventListener("afterprint", clearPrintView);

const FILE_COMMAND_ACTIONS = Object.freeze({
  "file.open-text": "open-text",
  "file.download-text": "download-text",
  "safety.create": "create-safety",
  "safety.open": "open-safety",
  "safety.download": "download-safety",
  "safety.verify": "verify-safety",
  "backup.test": "test-backup",
  "safety.grant": "grant-safety",
  "safety.resolve": "resolve-safety",
  "safety.disconnect": "disconnect-safety",
  "backup.export": "export-backup",
  "backup.restore": "restore-backup",
  "history.browse": "browse-history",
  "storage.persist": "persist-storage",
  "storage.clear": "clear-data",
});

function isCommandAvailable(command) {
  switch (command.id) {
    case "safety.create":
      return directSafetyFilesSupported;
    case "safety.grant":
      return safetyState?.kind === SAFETY_FILE_STATES.NEEDS_PERMISSION;
    case "safety.resolve":
      return safetyState?.kind === SAFETY_FILE_STATES.EXTERNAL_CHANGE;
    case "safety.disconnect":
      return safetyCoordinator.getConnection() !== null;
    default:
      return true;
  }
}

async function executeAppCommand(commandId, { trigger = null } = {}) {
  const command = commandById(commandId);
  if (!command || !isCommandAvailable(command)) {
    setCommandFeedback("That command is not available right now.", {
      important: true,
    });
    return false;
  }

  if (FILE_COMMAND_ACTIONS[commandId]) {
    await executeFileAction(FILE_COMMAND_ACTIONS[commandId], trigger);
    return true;
  }

  if (commandId.startsWith("edit.") && commandId !== "edit.clear") {
    closeAllMenus();
    await editorCommands.execute(commandId.slice("edit.".length));
    return true;
  }

  switch (commandId) {
    case "note.new":
      await createSavedNote();
      break;
    case "file.print":
      printActiveNote();
      break;
    case "edit.clear":
      clearActiveNote();
      break;
    case "find.open":
      openFindDialog(false);
      break;
    case "find.replace":
      openFindDialog(true);
      break;
    case "insert.date-time":
      closeAllMenus();
      editorCommands.insertText(formatCurrentDateTime());
      break;
    case "insert.symbols":
      openCharacterPicker("symbols");
      break;
    case "insert.emoji":
      openCharacterPicker("emoji");
      break;
    case "view.sidebar":
      setSidebarOpen(!sidebarOpen, {
        returnFocus: sidebarOpen,
        focusPanel: !sidebarOpen,
      });
      break;
    case "view.appearance":
      openAppearanceDialog(trigger);
      break;
    case "view.word-wrap":
      closeAllMenus();
      updateAppearance({ wordWrap: !appearance.wordWrap });
      break;
    case "view.status-bar":
      closeAllMenus();
      updateAppearance({ statusBar: !appearance.statusBar });
      break;
    case "view.fullscreen":
      await toggleFullscreen();
      break;
    case "appearance.reset":
      closeAllMenus();
      resetAppearance();
      break;
    case "theme.system":
    case "theme.light":
    case "theme.dark":
      updateAppearance({ colorMode: commandId.slice("theme.".length) });
      break;
    default:
      setCommandFeedback("That command is not available right now.", {
        important: true,
      });
      return false;
  }
  return true;
}

const isMac = /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
let paletteCommands = [];
let paletteSelection = 0;
let paletteReturnFocus = null;

function paletteCommandLabel(command) {
  if (command.id === "view.fullscreen") {
    return document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen";
  }
  return command.label;
}

function renderCommandPalette() {
  paletteCommands = searchCommands(commandPaletteSearch.value, {
    commands: COMMAND_CATALOG,
    isAvailable: isCommandAvailable,
    isMac,
  });
  paletteSelection = Math.max(
    0,
    Math.min(paletteSelection, paletteCommands.length - 1),
  );
  const fragment = document.createDocumentFragment();

  for (const [index, command] of paletteCommands.entries()) {
    const button = document.createElement("button");
    const label = document.createElement("span");
    const title = document.createElement("span");
    const category = document.createElement("span");
    const shortcut = document.createElement("span");
    button.type = "button";
    button.id = `command-palette-option-${index}`;
    button.className = "command-palette-option";
    button.dataset.commandId = command.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === paletteSelection));
    button.tabIndex = -1;
    label.className = "command-palette-label";
    title.textContent = paletteCommandLabel(command);
    category.className = "command-palette-category";
    category.textContent = command.category;
    shortcut.className = "command-palette-shortcut";
    shortcut.textContent = formatShortcut(command.shortcut, { isMac });
    label.append(title, category);
    button.append(label, shortcut);
    fragment.append(button);
  }

  if (paletteCommands.length === 0) {
    const empty = document.createElement("p");
    empty.className = "command-palette-empty";
    empty.textContent = "No matching commands.";
    fragment.append(empty);
    commandPaletteSearch.removeAttribute("aria-activedescendant");
  } else {
    commandPaletteSearch.setAttribute(
      "aria-activedescendant",
      `command-palette-option-${paletteSelection}`,
    );
  }

  commandPaletteResults.replaceChildren(fragment);
  commandPaletteStatus.textContent = `${paletteCommands.length} ${
    paletteCommands.length === 1 ? "command" : "commands"
  }`;
  commandPaletteResults
    .querySelector('[aria-selected="true"]')
    ?.scrollIntoView({ block: "nearest" });
}

function openCommandPalette(trigger = null) {
  closeAllMenus();
  const blockingDialog = document.querySelector("dialog[open]");
  if (blockingDialog && blockingDialog !== commandPaletteDialog) {
    setCommandFeedback("Close the open dialog before using the command palette.", {
      important: true,
    });
    return;
  }
  paletteReturnFocus = trigger?.closest?.("#command-menu")
    ? moreButton
    : trigger ?? document.activeElement;
  commandPaletteSearch.value = "";
  paletteSelection = 0;
  renderCommandPalette();
  if (!commandPaletteDialog.open) {
    commandPaletteDialog.showModal();
  }
  commandPaletteSearch.focus();
}

function closeCommandPalette() {
  if (commandPaletteDialog.open) {
    commandPaletteDialog.close();
  }
}

async function runPaletteCommand(commandId) {
  const returnFocus = paletteReturnFocus;
  closeCommandPalette();
  await executeAppCommand(commandId, { trigger: returnFocus });
}

commandPaletteSearch.addEventListener("input", () => {
  paletteSelection = 0;
  renderCommandPalette();
});
commandPaletteSearch.addEventListener("keydown", (event) => {
  if (paletteCommands.length === 0 && event.key !== "Escape") {
    return;
  }
  switch (event.key) {
    case "ArrowDown":
      paletteSelection = (paletteSelection + 1) % paletteCommands.length;
      break;
    case "ArrowUp":
      paletteSelection =
        (paletteSelection - 1 + paletteCommands.length) % paletteCommands.length;
      break;
    case "Home":
      paletteSelection = 0;
      break;
    case "End":
      paletteSelection = paletteCommands.length - 1;
      break;
    case "Enter":
      event.preventDefault();
      void runPaletteCommand(paletteCommands[paletteSelection].id);
      return;
    case "Escape":
      return;
    default:
      return;
  }
  event.preventDefault();
  renderCommandPalette();
});
commandPaletteResults.addEventListener("pointermove", (event) => {
  const option = event.target.closest("[data-command-id]");
  if (!option) return;
  const index = paletteCommands.findIndex(
    (command) => command.id === option.dataset.commandId,
  );
  if (index !== -1 && index !== paletteSelection) {
    paletteSelection = index;
    renderCommandPalette();
  }
});
commandPaletteResults.addEventListener("click", (event) => {
  const option = event.target.closest("[data-command-id]");
  if (option) {
    void runPaletteCommand(option.dataset.commandId);
  }
});
commandPaletteClose.addEventListener("click", closeCommandPalette);
commandPaletteDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCommandPalette();
});
commandPaletteDialog.addEventListener("close", () => {
  paletteReturnFocus?.focus();
  paletteReturnFocus = null;
});

for (const button of document.querySelectorAll("[data-open-command-palette]")) {
  button.addEventListener("click", () => openCommandPalette(button));
}

for (const button of document.querySelectorAll("[data-app-command]")) {
  button.addEventListener("click", () => {
    void executeAppCommand(button.dataset.appCommand, { trigger: button });
  });
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
    shortcutKey === "/"
  ) {
    event.preventDefault();
    openCommandPalette(document.activeElement);
    return;
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (shortcutKey === "n") {
      event.preventDefault();
      void executeAppCommand("note.new");
      return;
    }

    if (shortcutKey === "o") {
      event.preventDefault();
      void executeAppCommand("file.open-text");
      return;
    }

    if (shortcutKey === "s") {
      event.preventDefault();
      void executeAppCommand("file.download-text");
      return;
    }

    if (shortcutKey === "p") {
      event.preventDefault();
      void executeAppCommand("file.print");
      return;
    }

    if (shortcutKey === "f") {
      event.preventDefault();
      void executeAppCommand("find.open");
      return;
    }

    if (shortcutKey === "h") {
      event.preventDefault();
      void executeAppCommand("find.replace");
      return;
    }
  }

  if (
    event.key === "Escape" &&
    !document.fullscreenElement &&
    sidebarOpen &&
    narrowLayout.matches
  ) {
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
    // Close the drawer before focusing: while it is open the workspace is
    // inert and cannot receive focus.
    if (narrowLayout.matches) {
      setSidebarOpen(false);
    }
    showActiveNote({ focus: "body" });
    renderNotes();
  } else {
    if (narrowLayout.matches) {
      setSidebarOpen(false);
    }
    note.focus();
  }
}

async function createSavedNote() {
  closeAllMenus();
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
  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
  showActiveNote({ focus: "title" });
  renderNotes();
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
  let deleted = false;
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

    const candidate = deleteNote(notesDocument, noteId, { nextActiveNoteId });
    try {
      await storageService.restoreNotebook(candidate, {
        currentDocument: notesDocument,
        checkpointKind: SNAPSHOT_KINDS.BEFORE_DELETE,
      });
    } catch (error) {
      reportStorageIssue(error);
      setCommandFeedback(
        `Could not delete “${displayNoteTitle(savedNote)}” because a recovery checkpoint could not be saved.`,
        { important: true },
      );
      return;
    }
    notesDocument = candidate;
    deleted = true;
    clearRecoveryJournal();
    autosave.reset(SAVE_STATES.SAVED);
    saveState.textContent = `Local: ${SAVE_STATES.SAVED}`;
    safetyCoordinator.markDirty();
    safetyCoordinator.localSaveSettled(candidate);
  } finally {
    setNotebookTransitionPending(false);
  }
  if (!deleted) {
    return;
  }
  renderNotes();

  if (deletingActiveNote) {
    if (narrowLayout.matches) {
      setSidebarOpen(false);
    }
    showActiveNote({ focus: deletingOnlyNote ? "title" : "body" });
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

clearNoteSearchButton.addEventListener("click", () => {
  searchInput.value = "";
  renderNotes();
  searchInput.focus();
});

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

/* Service worker lifecycle: the worker never takes over running tabs on its
   own (no unsolicited skipWaiting). When an update is waiting, a status-bar
   button lets the user flush local edits and reload into the new version.
   Install failures are surfaced instead of silently losing offline support. */
const offlineStatus = document.querySelector("#offline-status");
const updateReadyButton = document.querySelector("#update-ready");

function setOfflineStatus(message) {
  offlineStatus.textContent = message;
  offlineStatus.title = message;
}

function offerServiceWorkerUpdate(registration) {
  if (!registration.waiting) {
    return;
  }
  updateReadyButton.hidden = false;
  updateReadyButton.onclick = async () => {
    updateReadyButton.disabled = true;
    await autosave.flush();
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true },
    );
    registration.waiting?.postMessage("SKIP_WAITING");
  };
}

function setupServiceWorker() {
  if (
    !("serviceWorker" in navigator) ||
    (window.location.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname))
  ) {
    return;
  }
  const register = async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none",
      });
    } catch {
      setOfflineStatus("Offline support unavailable; notes still save in this browser.");
      return;
    }

    if (registration.active) {
      setOfflineStatus("Offline ready");
    }
    offerServiceWorkerUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "activated") {
          setOfflineStatus("Offline ready");
        } else if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          // Only a real update gets the prompt; a first install passes
          // through "installed" briefly but has no controller yet.
          offerServiceWorkerUpdate(registration);
        } else if (installing.state === "redundant" && !registration.active) {
          setOfflineStatus(
            "Offline support could not be installed; reload to retry.",
          );
        }
      });
    });
  };

  // The module graph loads after a top-level await, so the window load event
  // may already be in the past.
  if (document.readyState === "complete") {
    void register();
  } else {
    window.addEventListener("load", () => void register(), { once: true });
  }
}

setupServiceWorker();

window.addEventListener("beforeunload", (event) => {
  if (autosave.isDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  void autosave.flush();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void autosave.flush();
  }
});
