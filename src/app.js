import { createAutosave, SAVE_STATES } from "./autosave.js";
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
import { loadNotesDocument, saveNotesDocument } from "./storage.js";

const AUTOSAVE_DELAY_MS = 500;
const MOBILE_BREAKPOINT = "(max-width: 48rem)";
const TOOLBAR_BREAKPOINT = "(max-width: 68rem)";

const titleInput = document.querySelector("#note-title");
const note = document.querySelector("#note");
const saveState = document.querySelector("#save-state");
const commandFeedback = document.querySelector("#command-feedback");
const wordCount = document.querySelector("#word-count");
const characterCount = document.querySelector("#character-count");
const moreButton = document.querySelector("#more-commands");
const commandMenu = document.querySelector("#command-menu");
const overflow = document.querySelector(".overflow");
const insertButton = document.querySelector("#insert-button");
const insertMenu = document.querySelector("#insert-menu");
const insertPopup = insertButton.closest(".toolbar-popup");
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
let editorCommands;
let sidebarOpen = !narrowLayout.matches;
let findReplaceMode = false;
let pickerSelection = null;
let ignoredFindCloseEvents = 0;
let ignoredPickerCloseEvents = 0;

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

const autosave = createAutosave({
  delay: AUTOSAVE_DELAY_MS,
  save: () => {
    if (!loadedNotes.canSave) {
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
  insertMenu.hidden = false;
  insertButton.setAttribute("aria-expanded", "true");
  insertMenu.querySelector('[role="menuitem"]').focus();
}

function closeAllMenus() {
  closeMenu();
  closeInsertMenu();
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

document.addEventListener("pointerdown", (event) => {
  if (!commandMenu.hidden && !overflow.contains(event.target)) {
    closeMenu();
  }
  if (!insertMenu.hidden && !insertPopup.contains(event.target)) {
    closeInsertMenu();
  }
});

for (const button of document.querySelectorAll("[data-command]")) {
  button.addEventListener("click", async () => {
    closeAllMenus();
    await editorCommands.execute(button.dataset.command);
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
