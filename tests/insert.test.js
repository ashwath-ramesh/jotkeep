import test from "node:test";
import assert from "node:assert/strict";

import {
  EMOJI,
  SPECIAL_CHARACTERS,
  formatCurrentDateTime,
} from "../src/insert.js";

test("insert palettes contain unique values and accessible labels", () => {
  for (const palette of [SPECIAL_CHARACTERS, EMOJI]) {
    assert.equal(new Set(palette.map(([value]) => value)).size, palette.length);
    assert.equal(
      palette.every(([value, label]) => value !== "" && label !== ""),
      true,
    );
  }
});

test("formatCurrentDateTime supports deterministic locale and timezone options", () => {
  assert.equal(
    formatCurrentDateTime(
      new Date("2026-08-09T12:34:00.000Z"),
      "en-US",
      { timeZone: "UTC" },
    ),
    "Aug 9, 2026, 12:34 PM",
  );
});
