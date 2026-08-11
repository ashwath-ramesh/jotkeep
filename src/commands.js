export const COMMAND_CATALOG = Object.freeze([
  { id: "note.new", category: "Note", label: "New note", keywords: "create blank", shortcut: "mod+n" },
  { id: "file.open-text", category: "File", label: "Open text file…", keywords: "import txt", shortcut: "mod+o" },
  { id: "file.download-text", category: "File", label: "Download note", keywords: "save export txt", shortcut: "mod+s" },
  { id: "file.print", category: "File", label: "Print note…", keywords: "paper pdf save", shortcut: "mod+p" },
  { id: "safety.create", category: "Safety File", label: "Create Safety File…", keywords: "backup connected" },
  { id: "safety.open", category: "Safety File", label: "Open Safety File…", keywords: "restore notebook" },
  { id: "safety.download", category: "Safety File", label: "Download Safety File…", keywords: "backup notebook" },
  { id: "safety.verify", category: "Safety File", label: "Verify Safety File…", keywords: "check backup" },
  { id: "backup.test", category: "Backup", label: "Test my backup…", keywords: "verify json safety" },
  { id: "safety.grant", category: "Safety File", label: "Grant Safety File access…", keywords: "permission reconnect" },
  { id: "safety.resolve", category: "Safety File", label: "Resolve Safety File conflict…", keywords: "external change" },
  { id: "safety.disconnect", category: "Safety File", label: "Disconnect Safety File", keywords: "forget handle" },
  { id: "backup.export", category: "Backup", label: "Export JSON backup…", keywords: "download all notes" },
  { id: "backup.restore", category: "Backup", label: "Restore JSON backup…", keywords: "import replace merge" },
  { id: "history.browse", category: "History", label: "Browse history…", keywords: "restore recovery time machine" },
  { id: "storage.persist", category: "Storage", label: "Keep data on this device", keywords: "persistent browser" },
  { id: "storage.clear", category: "Storage", label: "Clear all local data…", keywords: "delete reset browser", dangerous: true },
  { id: "edit.undo", category: "Edit", label: "Undo", keywords: "reverse", shortcut: "mod+z" },
  { id: "edit.redo", category: "Edit", label: "Redo", keywords: "repeat", shortcut: "mod+shift+z" },
  { id: "edit.cut", category: "Edit", label: "Cut", keywords: "clipboard" },
  { id: "edit.copy", category: "Edit", label: "Copy", keywords: "clipboard" },
  { id: "edit.paste", category: "Edit", label: "Paste", keywords: "clipboard" },
  { id: "edit.delete", category: "Edit", label: "Delete selection", keywords: "remove text" },
  { id: "edit.select-all", category: "Edit", label: "Select all", keywords: "entire note", shortcut: "mod+a" },
  { id: "edit.clear", category: "Edit", label: "Clear note…", keywords: "erase title body", dangerous: true },
  { id: "find.open", category: "Edit", label: "Find", keywords: "search note", shortcut: "mod+f" },
  { id: "find.replace", category: "Edit", label: "Find and replace", keywords: "search change", shortcut: "mod+h" },
  { id: "insert.date-time", category: "Insert", label: "Insert date and time", keywords: "timestamp today now" },
  { id: "insert.symbols", category: "Insert", label: "Insert special character…", keywords: "symbol punctuation" },
  { id: "insert.emoji", category: "Insert", label: "Insert emoji…", keywords: "character face" },
  { id: "view.sidebar", category: "View", label: "Toggle notes panel", keywords: "sidebar show hide" },
  { id: "view.appearance", category: "View", label: "Appearance…", keywords: "font typography settings" },
  { id: "view.word-wrap", category: "View", label: "Word wrap", keywords: "long lines horizontal" },
  { id: "view.status-bar", category: "View", label: "Status bar", keywords: "save counts storage" },
  { id: "view.fullscreen", category: "View", label: "Enter fullscreen", keywords: "exit expand screen" },
  { id: "appearance.reset", category: "View", label: "Reset appearance", keywords: "defaults theme font wrap" },
  { id: "theme.system", category: "Theme", label: "Use system theme", keywords: "automatic color appearance" },
  { id: "theme.light", category: "Theme", label: "Use light theme", keywords: "color appearance" },
  { id: "theme.dark", category: "Theme", label: "Use dark theme", keywords: "color appearance" },
]);

const COMMAND_BY_ID = new Map(COMMAND_CATALOG.map((command) => [command.id, command]));

export function commandById(id) {
  return COMMAND_BY_ID.get(id) ?? null;
}

export function formatShortcut(shortcut, { isMac = false } = {}) {
  if (!shortcut) {
    return "";
  }
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "mod") return isMac ? "Command" : "Ctrl";
      if (part === "shift") return "Shift";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(" + ");
}

function searchableText(command, isMac) {
  return [
    command.label,
    command.category,
    command.keywords,
    formatShortcut(command.shortcut, { isMac }),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchCommands(
  query,
  { commands = COMMAND_CATALOG, isAvailable = () => true, isMac = false } = {},
) {
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return commands.filter(
    (command) =>
      isAvailable(command) &&
      tokens.every((token) => searchableText(command, isMac).includes(token)),
  );
}
