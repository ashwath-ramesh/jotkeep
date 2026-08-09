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
  clearPlainJotData,
  createNotesDocument,
  loadLastBackupMetadata,
  loadNotesDocument,
  saveLastBackupMetadata,
  saveNotesDocument,
} from "./storage.js";

const AUTOSAVE_DELAY_MS = 500;
const MOBILE_BREAKPOINT = "(max-width: 48rem)";
const TOOLBAR_BREAKPOINT = "(max-width: 68rem)";

const titleInput = document.querySelector("#note-title");
const note = document.querySelector("#note");
const saveState = document.querySelector("#save-state");
const commandFeedback = document.querySelector("#command-feedback");
const wordCount = document.querySelector("#word-count");
const characterCount = document.querySelector("#character-count");
const backupStatus = document.querySelector("#backup-status");
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
const narrowLayout = window.matchMedia(MOBILE_BREAKPOINT);
const compactToolbar = window.matchMedia(TOOLBAR_BREAKPOINT);
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

let browserStorage;

try {
  browserStorage = window.localStorage;
} catch {
  browserStorage = null;
}

const loadedNotes = loadNotesDocument(browserStorage);
let notesDocument = loadedNotes.document;
let canSafelySave = loadedNotes.canSave;
let lastBackupMetadata = loadLastBackupMetadata(browserStorage);
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
  selectButton.setAttribute("aria-label", `Open ${displayTitle}`);
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

const autosave = createAutosave({
  delay: AUTOSAVE_DELAY_MS,
  save: () => {
    if (!canSafelySave) {
      throw new Error("Stored notes cannot be safely replaced.");
    }
    saveNotesDocument(browserStorage, notesDocument);
  },
  onStateChange: (state) => {
    saveState.textContent = state;
  },
});

autosave.setState(
  loadedNotes.storageAvailable ? SAVE_STATES.SAVED : SAVE_STATES.UNAVAILABLE,
);

function persistImmediately() {
  autosave.markDirty();
  return autosave.flush();
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
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
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

async function importTextFile(file, generation) {
  if (!/\.txt$/iu.test(file.name)) {
    throw new TypeError("Choose a file whose name ends in .txt.");
  }

  const content = decodeUtf8(await file.arrayBuffer());
  if (generation !== textImportGeneration) {
    return;
  }

  autosave.flush();
  notesDocument = addNote(notesDocument, {
    title: titleFromTextFilename(file.name),
    content,
  });
  searchInput.value = "";
  const saved = persistImmediately();
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

function downloadActiveNote() {
  autosave.flush();
  const savedNote = activeNote();
  const filename = sanitizeFilename(savedNote.title);
  downloadFile(savedNote.content, "text/plain;charset=utf-8", filename);
  setCommandFeedback(`Created text download “${filename}”.`);
}

function exportJsonBackup() {
  autosave.flush();

  try {
    const backup = createBackup(notesDocument);
    const serialized = serializeBackup(backup);
    parseBackup(serialized);
    const filename = backupFilename(backup.createdAt);
    downloadFile(serialized, "application/json;charset=utf-8", filename);

    lastBackupMetadata = { version: 1, createdAt: backup.createdAt };
    let metadataSaved = true;
    try {
      saveLastBackupMetadata(browserStorage, backup.createdAt);
    } catch {
      metadataSaved = false;
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
    autosave.flush();
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

restoreConfirm.addEventListener("click", () => {
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
  } catch {
    restoreError.textContent =
      "PlainJot could not prepare this restore without creating duplicate note IDs. No notes were changed.";
    restoreError.hidden = false;
    return;
  }

  try {
    saveNotesDocument(browserStorage, candidate);
  } catch {
    restoreError.textContent =
      "PlainJot could not save the restored notebook. Check browser storage access or available space; no notes were changed.";
    restoreError.hidden = false;
    return;
  }

  textImportGeneration += 1;
  notesDocument = candidate;
  canSafelySave = true;
  autosave.reset(SAVE_STATES.SAVED);
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

clearDataConfirm.addEventListener("click", () => {
  try {
    clearPlainJotData(browserStorage);
  } catch {
    clearDataError.textContent =
      "PlainJot could not clear browser storage. Your current notes remain open.";
    clearDataError.hidden = false;
    return;
  }

  textImportGeneration += 1;
  autosave.reset(SAVE_STATES.CLEARED);
  canSafelySave = true;
  notesDocument = createNotesDocument();
  lastBackupMetadata = null;
  searchInput.value = "";
  renderNotes();
  renderBackupStatus();
  showActiveNote({ focus: "body" });
  closeClearDataDialog();
  setCommandFeedback("All PlainJot data was cleared from this browser.");
});

for (const button of document.querySelectorAll("[data-file-action]")) {
  button.addEventListener("click", () => {
    closeAllMenus();

    switch (button.dataset.fileAction) {
      case "open-text":
        chooseFile(textFileInput);
        break;
      case "download-text":
        downloadActiveNote();
        break;
      case "export-backup":
        exportJsonBackup();
        break;
      case "restore-backup":
        restoreReturnFocus = button.closest("#file-menu") ? fileButton : moreButton;
        chooseFile(backupFileInput);
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
      : `${currentIndex + 1} of ${matches.length}`,
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

function selectSavedNote(noteId) {
  if (noteId !== notesDocument.activeNoteId) {
    autosave.flush();
    notesDocument = setActiveNote(notesDocument, noteId);
    persistImmediately();
    showActiveNote({ focus: "body" });
    renderNotes();
  } else {
    note.focus();
  }

  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
}

function createSavedNote() {
  autosave.flush();
  notesDocument = addNote(notesDocument);
  searchInput.value = "";
  persistImmediately();
  showActiveNote({ focus: "title" });
  renderNotes();

  if (narrowLayout.matches) {
    setSidebarOpen(false);
  }
}

function deleteSavedNote(noteId, trigger) {
  const savedNote = notesDocument.notes.find((item) => item.id === noteId);

  if (!window.confirm(`Delete “${displayNoteTitle(savedNote)}”?`)) {
    trigger.focus();
    return;
  }

  autosave.flush();
  const deletingActiveNote = noteId === notesDocument.activeNoteId;
  const deletingOnlyNote = notesDocument.notes.length === 1;
  let nextActiveNoteId;

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
  persistImmediately();
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

newNoteButton.addEventListener("click", createSavedNote);

notesList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-note-id]");
  if (deleteButton) {
    deleteSavedNote(deleteButton.dataset.deleteNoteId, deleteButton);
    return;
  }

  const selectButton = event.target.closest("[data-note-id]");
  if (selectButton) {
    selectSavedNote(selectButton.dataset.noteId);
  }
});

searchInput.addEventListener("input", renderNotes);

sortSelect.addEventListener("change", () => {
  notesDocument = updatePreferences(notesDocument, { sortBy: sortSelect.value });
  renderNotes();
  persistImmediately();
});

listViewSelect.addEventListener("change", () => {
  notesDocument = updatePreferences(notesDocument, {
    listView: listViewSelect.value,
  });
  renderNotes();
  persistImmediately();
});

window.addEventListener("pagehide", () => autosave.flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    autosave.flush();
  }
});
