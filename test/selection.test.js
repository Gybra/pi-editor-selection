import assert from "node:assert/strict";
import test from "node:test";
import {
  cursorToOffset,
  offsetToCursor,
  removeRange,
  selectionRange,
} from "../src/selection.js";

test("converts cursor positions across lines to text offsets", () => {
  assert.equal(cursorToOffset("one\ntwo", { line: 1, col: 2 }), 6);
  assert.deepEqual(offsetToCursor("one\ntwo", 6), { line: 1, col: 2 });
});

test("normalizes forward, reversed, and collapsed selections", () => {
  assert.deepEqual(selectionRange(2, 5), { start: 2, end: 5 });
  assert.deepEqual(selectionRange(5, 2), { start: 2, end: 5 });
  assert.deepEqual(selectionRange(4, 4), { start: 4, end: 4 });
  assert.deepEqual(removeRange("abcdef", 5, 2), { text: "abf", cursor: 2 });
});

test("deletes a complete emoji without changing surrounding text", () => {
  assert.deepEqual(removeRange("a🙂b", 1, 3), { text: "ab", cursor: 1 });
});

test("deletes across a newline and leaves the cursor at the range start", () => {
  assert.deepEqual(removeRange("first\nsecond", 4, 7), {
    text: "firsecond", cursor: 4,
  });
});
