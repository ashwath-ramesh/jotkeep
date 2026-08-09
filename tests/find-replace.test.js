import test from "node:test";
import assert from "node:assert/strict";

import {
  currentMatchIndex,
  findAdjacentMatch,
  findMatches,
  replaceAllLiteral,
} from "../src/find-replace.js";

test("findMatches treats its query literally and supports multiline text", () => {
  assert.deepEqual(findMatches("a.*b a.*b", ".*"), [
    { start: 1, end: 3 },
    { start: 6, end: 8 },
  ]);
  assert.deepEqual(findMatches("one\ntwo\none\ntwo", "one\ntwo"), [
    { start: 0, end: 7 },
    { start: 8, end: 15 },
  ]);
  assert.deepEqual(findMatches("anything", ""), []);

  for (const query of [
    "[",
    "]",
    "\\",
    "^",
    "$",
    "(",
    ")",
    "{",
    "}",
    "?",
    "+",
    "*",
    ".",
    "|",
  ]) {
    assert.equal(findMatches(`x${query}y`, query).length, 1);
  }
});

test("findMatches supports case-sensitive and Unicode whole-word matching", () => {
  const text = "Cat cat scatter cat_ café caféine café —cat—";

  assert.equal(findMatches(text, "cat").length, 5);
  assert.deepEqual(findMatches(text, "Cat", { matchCase: true }), [
    { start: 0, end: 3 },
  ]);
  assert.deepEqual(findMatches(text, "cat", { wholeWord: true }), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 40, end: 43 },
  ]);
  assert.deepEqual(findMatches(text, "café", { wholeWord: true }), [
    { start: 21, end: 25 },
    { start: 34, end: 38 },
  ]);
});

test("findAdjacentMatch moves in either direction and wraps", () => {
  const matches = findMatches("one two one", "one");

  assert.deepEqual(findAdjacentMatch(matches, { start: 0, end: 0 }), {
    match: { start: 0, end: 3 },
    index: 0,
    wrapped: false,
  });
  assert.deepEqual(findAdjacentMatch(matches, { start: 0, end: 3 }, "next"), {
    match: { start: 8, end: 11 },
    index: 1,
    wrapped: false,
  });
  assert.equal(
    findAdjacentMatch(matches, { start: 8, end: 11 }, "next").wrapped,
    true,
  );
  assert.equal(
    findAdjacentMatch(matches, { start: 0, end: 3 }, "previous").index,
    1,
  );
  assert.equal(currentMatchIndex(matches, { start: 8, end: 11 }), 1);
  assert.equal(currentMatchIndex(matches, { start: 2, end: 2 }), -1);
});

test("replaceAllLiteral performs one pass and treats replacement syntax literally", () => {
  assert.deepEqual(replaceAllLiteral("aaaa", "aa", "aaa"), {
    text: "aaaaaa",
    count: 2,
    caret: 6,
  });
  assert.deepEqual(replaceAllLiteral("a.a", ".", "$&"), {
    text: "a$&a",
    count: 1,
    caret: 3,
  });
  assert.deepEqual(replaceAllLiteral("no match", "missing", "value"), {
    text: "no match",
    count: 0,
    caret: null,
  });
});
