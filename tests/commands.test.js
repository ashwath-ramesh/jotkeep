import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMAND_CATALOG,
  commandById,
  formatShortcut,
  searchCommands,
} from "../src/commands.js";

test("command identifiers are unique and resolve through the catalog", () => {
  const ids = COMMAND_CATALOG.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const command of COMMAND_CATALOG) {
    assert.equal(commandById(command.id), command);
  }
  assert.equal(commandById("missing"), null);
});

test("command search matches every token across labels, categories, and keywords", () => {
  assert.deepEqual(
    searchCommands("save pdf").map((command) => command.id),
    ["file.print"],
  );
  assert.deepEqual(
    searchCommands("SYSTEM COLOR").map((command) => command.id),
    ["theme.system"],
  );
  assert.equal(searchCommands("no-such-command").length, 0);
});

test("command search does not depend on locale-sensitive lowercasing", () => {
  const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = function useTurkishLowercase() {
    return originalToLocaleLowerCase.call(this, "tr");
  };

  try {
    assert.equal(
      searchCommands("insert").some(
        (command) => command.id === "insert.date-time",
      ),
      true,
    );
  } finally {
    String.prototype.toLocaleLowerCase = originalToLocaleLowerCase;
  }
});

test("command search preserves catalog order and excludes unavailable actions", () => {
  const available = searchCommands("safety", {
    isAvailable: (command) => command.id !== "safety.create",
  });
  assert.equal(available.some((command) => command.id === "safety.create"), false);
  assert.deepEqual(
    searchCommands("").map((command) => command.id),
    COMMAND_CATALOG.map((command) => command.id),
  );
});

test("shortcut labels follow the active platform convention", () => {
  assert.equal(formatShortcut("mod+shift+z"), "Ctrl + Shift + Z");
  assert.equal(
    formatShortcut("mod+shift+z", { isMac: true }),
    "Command + Shift + Z",
  );
  assert.equal(formatShortcut(undefined), "");
});
