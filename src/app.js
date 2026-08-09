import { createAutosave, SAVE_STATES } from "./autosave.js";
import { clearEditor, countText, createEditorCommands } from "./editor.js";
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

const titleInput = document.querySelector("#note-title");
const note = document.querySelector("#note");
const saveState = document.querySelector("#save-state");
const commandFeedback = document.querySelector("#command-feedback");
const wordCount = document.querySelector("#word-count");
const characterCount = document.querySelector("#character-count");
const moreButton = document.querySelector("#more-commands");
const commandMenu = document.querySelector("#command-menu");
const overflow = document.querySelector(".overflow");
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
const narrowLayout = window.matchMedia(MOBILE_BREAKPOINT);
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
  commandMenu.hidden = false;
  moreButton.setAttribute("aria-expanded", "true");
  commandMenu.querySelector('[role="menuitem"]').focus();
}

moreButton.addEventListener("click", () => {
  if (commandMenu.hidden) {
    openMenu();
  } else {
    closeMenu({ returnFocus: true });
  }
});

commandMenu.addEventListener("keydown", (event) => {
  const items = [...commandMenu.querySelectorAll('[role="menuitem"]')];
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
      closeMenu({ returnFocus: true });
      return;
    case "Tab":
      closeMenu();
      return;
    default:
      return;
  }

  event.preventDefault();
  items[nextIndex].focus();
});

document.addEventListener("pointerdown", (event) => {
  if (!commandMenu.hidden && !overflow.contains(event.target)) {
    closeMenu();
  }
});

for (const button of document.querySelectorAll("[data-command]")) {
  button.addEventListener("click", async () => {
    closeMenu();
    await editorCommands.execute(button.dataset.command);
  });
}

function clearActiveNote() {
  closeMenu();
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
  if (event.key === "Escape" && sidebarOpen && narrowLayout.matches) {
    event.preventDefault();
    setSidebarOpen(false, { returnFocus: true });
  }
});

narrowLayout.addEventListener("change", (event) => {
  closeMenu();
  setSidebarOpen(!event.matches);
});

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
