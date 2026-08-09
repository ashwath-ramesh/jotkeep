export function countText(text) {
  const trimmedText = text.trim();

  return {
    words: trimmedText === "" ? 0 : trimmedText.split(/\s+/u).length,
    characters: text.length,
  };
}

export function graphemeRangeAt(text, offset) {
  const position = Math.max(0, Math.min(offset, text.length));

  if (position === text.length) {
    return { start: position, end: position };
  }

  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });

    for (const { segment, index } of segmenter.segment(text)) {
      const end = index + segment.length;

      if (position >= index && position < end) {
        return { start: index, end };
      }
    }
  }

  const nextCodePoint = Array.from(text.slice(position))[0] ?? "";
  return { start: position, end: position + nextCodePoint.length };
}

export function clearEditor({
  titleInput,
  textarea,
  confirmClear,
  onClear = () => {},
}) {
  if (titleInput.value === "" && textarea.value === "") {
    textarea.focus();
    return false;
  }

  if (!confirmClear()) {
    textarea.focus();
    return false;
  }

  titleInput.value = "";
  textarea.value = "";
  onClear();
  textarea.focus();
  return true;
}

export function createEditorCommands(
  textarea,
  {
    navigatorObject = globalThis.navigator,
    onFeedback = () => {},
  } = {},
) {
  const documentObject = textarea.ownerDocument;
  let savedSelection = readSelection();
  let commandGeneration = 0;

  function isCurrentCommand(generation) {
    return generation === commandGeneration;
  }

  function invalidatePendingCommands() {
    commandGeneration += 1;
  }

  function readSelection() {
    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction: textarea.selectionDirection || "none",
    };
  }

  function rememberSelection() {
    savedSelection = readSelection();
  }

  function restoreSelection(selection = savedSelection) {
    const length = textarea.value.length;
    const start = Math.min(selection.start, length);
    const end = Math.min(selection.end, length);

    textarea.focus();
    textarea.setSelectionRange(start, end, selection.direction);
    rememberSelection();
  }

  function dispatchInput() {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function runNativeCommand(command, value = null) {
    restoreSelection();
    const before = textarea.value;
    let sawInput = false;
    const noticeInput = () => {
      sawInput = true;
    };

    textarea.addEventListener("input", noticeInput);

    let succeeded = false;

    try {
      succeeded = documentObject.execCommand(command, false, value);
    } catch {
      succeeded = false;
    }

    textarea.removeEventListener("input", noticeInput);

    if (textarea.value !== before && !sawInput) {
      dispatchInput();
    }

    rememberSelection();
    return succeeded || textarea.value !== before;
  }

  function replaceRange(selection, replacement) {
    const before = textarea.value;
    const expected =
      before.slice(0, selection.start) + replacement + before.slice(selection.end);

    if (expected === before) {
      restoreSelection(selection);
      return false;
    }

    restoreSelection(selection);
    let sawInput = false;
    const noticeInput = () => {
      sawInput = true;
    };

    textarea.addEventListener("input", noticeInput);

    let inserted = false;

    try {
      inserted = documentObject.execCommand("insertText", false, replacement);
    } catch {
      inserted = false;
    }

    textarea.removeEventListener("input", noticeInput);

    if (!inserted || textarea.value === before) {
      textarea.setRangeText(
        replacement,
        selection.start,
        selection.end,
        "end",
      );
      dispatchInput();
    } else if (!sawInput) {
      dispatchInput();
    }

    rememberSelection();
    return textarea.value !== before;
  }

  function report(message) {
    onFeedback(message);
  }

  function execClipboardFallback(command, selection) {
    restoreSelection(selection);

    try {
      return documentObject.execCommand(command);
    } catch {
      return false;
    }
  }

  async function copySelection(selection, text, generation) {
    if (navigatorObject?.clipboard?.writeText) {
      try {
        await navigatorObject.clipboard.writeText(text);
        return true;
      } catch {
        if (!isCurrentCommand(generation)) {
          return false;
        }

        // Fall through to the browser's native command.
      }
    }

    if (!isCurrentCommand(generation)) {
      return false;
    }

    return execClipboardFallback("copy", selection);
  }

  async function copy(generation) {
    const selection = savedSelection;
    const selectedText = textarea.value.slice(selection.start, selection.end);

    if (selectedText === "") {
      report("Select text to copy.");
      restoreSelection(selection);
      return;
    }

    const copied = await copySelection(selection, selectedText, generation);

    if (!isCurrentCommand(generation)) {
      return;
    }

    if (!copied) {
      report("Clipboard access is unavailable.");
    }

    restoreSelection(selection);
  }

  async function cut(generation) {
    const selection = savedSelection;
    const originalValue = textarea.value;
    const selectedText = originalValue.slice(selection.start, selection.end);

    if (selectedText === "") {
      report("Select text to cut.");
      restoreSelection(selection);
      return;
    }

    const copied = await copySelection(selection, selectedText, generation);

    if (!isCurrentCommand(generation)) {
      return;
    }

    if (!copied) {
      report("Clipboard access is unavailable.");
      restoreSelection(selection);
      return;
    }

    if (textarea.value !== originalValue) {
      report("The note changed before the cut completed.");
      return;
    }

    replaceRange(selection, "");
  }

  async function paste(generation) {
    const selection = savedSelection;
    const originalValue = textarea.value;

    if (navigatorObject?.clipboard?.readText) {
      try {
        const clipboardText = await navigatorObject.clipboard.readText();

        if (!isCurrentCommand(generation)) {
          return;
        }

        if (textarea.value !== originalValue) {
          report("The note changed before the paste completed.");
          return;
        }

        replaceRange(selection, clipboardText);
        return;
      } catch {
        if (!isCurrentCommand(generation)) {
          return;
        }

        // Fall through to the browser's native command.
      }
    }

    if (!isCurrentCommand(generation)) {
      return;
    }

    if (!runNativeCommand("paste")) {
      report("Clipboard access is unavailable.");
    }
  }

  function deleteText() {
    const selection = { ...savedSelection };

    if (selection.start === selection.end && selection.start < textarea.value.length) {
      const grapheme = graphemeRangeAt(textarea.value, selection.start);
      selection.start = grapheme.start;
      selection.end = grapheme.end;
    }

    replaceRange(selection, "");
  }

  async function execute(command) {
    const generation = commandGeneration;
    report("");

    switch (command) {
      case "undo":
        if (!runNativeCommand("undo")) {
          report("Nothing to undo.");
        }
        break;
      case "redo":
        if (!runNativeCommand("redo")) {
          report("Nothing to redo.");
        }
        break;
      case "cut":
        await cut(generation);
        break;
      case "copy":
        await copy(generation);
        break;
      case "paste":
        await paste(generation);
        break;
      case "delete":
        deleteText();
        break;
      case "select-all":
        textarea.focus();
        textarea.select();
        rememberSelection();
        break;
      default:
        report("This editing command is unavailable.");
    }
  }

  for (const eventName of ["input", "select", "keyup", "pointerup", "focus"]) {
    textarea.addEventListener(eventName, rememberSelection);
  }

  return {
    execute,
    invalidatePendingCommands,
    rememberSelection,
  };
}
