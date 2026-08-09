import test from "node:test";
import assert from "node:assert/strict";

import {
  clearEditor,
  countText,
  createEditorCommands,
  graphemeRangeAt,
} from "../src/editor.js";

class FakeTextarea extends EventTarget {
  constructor(value, start, end = start) {
    super();
    this.value = value;
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = "none";
    this.focused = false;
    this.ownerDocument = {
      execCommand: () => false,
    };
  }

  focus() {
    this.focused = true;
    this.dispatchEvent(new Event("focus"));
  }

  setSelectionRange(start, end, direction = "none") {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }

  setRangeText(replacement, start, end) {
    this.value =
      this.value.slice(0, start) + replacement + this.value.slice(end);
    this.setSelectionRange(
      start + replacement.length,
      start + replacement.length,
    );
  }
}

test("countText reports zero for empty and whitespace-only text", () => {
  assert.deepEqual(countText(""), { words: 0, characters: 0 });
  assert.deepEqual(countText("  \n\t"), { words: 0, characters: 4 });
});

test("countText ignores surrounding and repeated whitespace between words", () => {
  assert.deepEqual(countText("  one   two\nthree\t"), {
    words: 3,
    characters: 18,
  });
});

test("countText includes spaces, line breaks, and UTF-16 code units", () => {
  assert.deepEqual(countText("hi \u{1F44B}\n"), {
    words: 2,
    characters: 6,
  });
});

test("graphemeRangeAt spans complete visible characters", () => {
  assert.deepEqual(graphemeRangeAt("Ae\u0301B", 1), { start: 1, end: 3 });
  assert.deepEqual(graphemeRangeAt("A🇺🇳B", 1), { start: 1, end: 5 });
  assert.deepEqual(graphemeRangeAt("A👨‍👩‍👧‍👦B", 1), { start: 1, end: 12 });
});

test("delete removes one complete grapheme cluster at the caret", async () => {
  for (const grapheme of ["e\u0301", "🇺🇳", "👨‍👩‍👧‍👦"]) {
    const textarea = new FakeTextarea(`A${grapheme}B`, 1);
    const commands = createEditorCommands(textarea);

    await commands.execute("delete");

    assert.equal(textarea.value, "AB");
    assert.equal(textarea.selectionStart, 1);
    assert.equal(textarea.selectionEnd, 1);
  }
});

test("successful clipboard copy restores focus and the saved selection", async () => {
  const textarea = new FakeTextarea("copy me", 0, 4);
  const writes = [];
  const commands = createEditorCommands(textarea, {
    navigatorObject: {
      clipboard: {
        async writeText(text) {
          writes.push(text);
        },
      },
    },
  });

  textarea.focused = false;
  textarea.setSelectionRange(7, 7);
  await commands.execute("copy");

  assert.deepEqual(writes, ["copy"]);
  assert.equal(textarea.focused, true);
  assert.equal(textarea.selectionStart, 0);
  assert.equal(textarea.selectionEnd, 4);

  await commands.execute("copy");
  assert.deepEqual(writes, ["copy", "copy"]);
});

test("cancelling clear preserves the note and restores editor focus", () => {
  const titleInput = { value: "Title" };
  const textarea = new FakeTextarea("Body", 0);
  let cleared = false;

  const result = clearEditor({
    titleInput,
    textarea,
    confirmClear: () => false,
    onClear: () => {
      cleared = true;
    },
  });

  assert.equal(result, false);
  assert.equal(titleInput.value, "Title");
  assert.equal(textarea.value, "Body");
  assert.equal(cleared, false);
  assert.equal(textarea.focused, true);
});
