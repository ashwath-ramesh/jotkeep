export const SORT_OPTIONS = Object.freeze({
  TITLE: "title",
  CREATED_AT: "createdAt",
  UPDATED_AT: "updatedAt",
});

export const LIST_VIEWS = Object.freeze({
  COMPACT: "compact",
  DETAILED: "detailed",
});

export const UNTITLED_NOTE = "Untitled Note";

function timestampFrom(now) {
  const value = typeof now === "function" ? now() : now;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function createNoteId({
  cryptoObject = globalThis.crypto,
  now = Date.now,
  random = Math.random,
  existingIds = new Set(),
} = {}) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id =
      typeof cryptoObject?.randomUUID === "function"
        ? `note_${cryptoObject.randomUUID()}`
        : `note_${Number(now()).toString(36)}_${Math.floor(random() * 1e12).toString(36)}`;

    if (!existingIds.has(id)) {
      return id;
    }
  }

  throw new Error("Unable to generate a unique note ID.");
}

export function createNote(
  notes = [],
  {
    idFactory = createNoteId,
    now = () => new Date(),
    title = "",
    content = "",
  } = {},
) {
  const existingIds = new Set(notes.map((note) => note.id));
  const id = idFactory({ existingIds });
  const timestamp = timestampFrom(now);

  if (existingIds.has(id)) {
    throw new Error(`A note with ID "${id}" already exists.`);
  }

  return {
    id,
    title,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function displayNoteTitle(note) {
  const title = note.title.trim();
  return title === "" ? UNTITLED_NOTE : title;
}

export function notePreview(note) {
  const preview = note.content.replace(/\s+/gu, " ").trim();
  return preview === "" ? "No content" : preview;
}

export function updateNote(
  notesDocument,
  noteId,
  changes,
  { now = () => new Date() } = {},
) {
  const noteIndex = notesDocument.notes.findIndex((note) => note.id === noteId);

  if (noteIndex === -1) {
    throw new Error(`Unknown note ID "${noteId}".`);
  }

  const previousNote = notesDocument.notes[noteIndex];
  const title = changes.title ?? previousNote.title;
  const content = changes.content ?? previousNote.content;

  if (title === previousNote.title && content === previousNote.content) {
    return notesDocument;
  }

  const notes = [...notesDocument.notes];
  notes[noteIndex] = {
    ...previousNote,
    title,
    content,
    updatedAt: timestampFrom(now),
  };

  return { ...notesDocument, notes };
}

export function addNote(notesDocument, options = {}) {
  const note = createNote(notesDocument.notes, options);

  return {
    ...notesDocument,
    activeNoteId: note.id,
    notes: [...notesDocument.notes, note],
  };
}

export function setActiveNote(notesDocument, noteId) {
  if (!notesDocument.notes.some((note) => note.id === noteId)) {
    throw new Error(`Unknown note ID "${noteId}".`);
  }

  if (notesDocument.activeNoteId === noteId) {
    return notesDocument;
  }

  return { ...notesDocument, activeNoteId: noteId };
}

export function deleteNote(
  notesDocument,
  noteId,
  { nextActiveNoteId, idFactory = createNoteId, now = () => new Date() } = {},
) {
  if (!notesDocument.notes.some((note) => note.id === noteId)) {
    throw new Error(`Unknown note ID "${noteId}".`);
  }

  const remainingNotes = notesDocument.notes.filter((note) => note.id !== noteId);

  if (remainingNotes.length === 0) {
    const replacement = createNote([], { idFactory, now });
    return {
      ...notesDocument,
      activeNoteId: replacement.id,
      notes: [replacement],
    };
  }

  if (notesDocument.activeNoteId !== noteId) {
    return { ...notesDocument, notes: remainingNotes };
  }

  if (!remainingNotes.some((note) => note.id === nextActiveNoteId)) {
    throw new Error(
      "Deleting the active note requires a valid replacement note.",
    );
  }

  return {
    ...notesDocument,
    activeNoteId: nextActiveNoteId,
    notes: remainingNotes,
  };
}

export function chooseNeighborNoteId(noteId, orderedNoteIds) {
  const index = orderedNoteIds.indexOf(noteId);

  if (index === -1) {
    return null;
  }

  return orderedNoteIds[index + 1] ?? orderedNoteIds[index - 1] ?? null;
}

export function filterNotes(notes, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (normalizedQuery === "") {
    return [...notes];
  }

  return notes.filter((note) =>
    `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalizedQuery),
  );
}

function compareIds(left, right) {
  return left.id.localeCompare(right.id);
}

function compareCreatedAt(left, right) {
  return right.createdAt.localeCompare(left.createdAt) || compareIds(left, right);
}

export function sortNotes(notes, sortBy) {
  const sortedNotes = [...notes];

  sortedNotes.sort((left, right) => {
    switch (sortBy) {
      case SORT_OPTIONS.TITLE:
        return (
          displayNoteTitle(left).localeCompare(
            displayNoteTitle(right),
            undefined,
            { sensitivity: "base" },
          ) ||
          compareCreatedAt(left, right)
        );
      case SORT_OPTIONS.CREATED_AT:
        return compareCreatedAt(left, right);
      case SORT_OPTIONS.UPDATED_AT:
      default:
        return (
          right.updatedAt.localeCompare(left.updatedAt) ||
          compareCreatedAt(left, right)
        );
    }
  });

  return sortedNotes;
}

export function updatePreferences(notesDocument, changes) {
  const preferences = { ...notesDocument.preferences, ...changes };

  if (
    preferences.sortBy === notesDocument.preferences.sortBy &&
    preferences.listView === notesDocument.preferences.listView
  ) {
    return notesDocument;
  }

  return { ...notesDocument, preferences };
}
