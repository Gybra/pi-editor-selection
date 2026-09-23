import assert from "node:assert/strict";
import test from "node:test";
import * as selection from "../src/selection.js";
import {
  cursorToOffset,
  offsetToCursor,
  removeRange,
  selectionRange,
} from "../src/selection.js";

test("extension retains its anchor as the focus moves in either direction", () => {
  assert.equal(typeof selection.extendSelection, "function");
  const first = selection.extendSelection(undefined, 2, 5);
  assert.deepEqual(first, { anchor: 2, focus: 5 });
  assert.deepEqual(selection.extendSelection(first, 5, 3), {
    anchor: 2, focus: 3,
  });
});

test("clips a selection to the visible portion of a wrapped segment", () => {
  assert.equal(typeof selection.selectionOnSegment, "function");
  const range = selection.selectionRange(9, 4);
  assert.deepEqual(selection.selectionOnSegment(range, 6, 10), {
    start: 0, end: 3,
  });
  assert.equal(selection.selectionOnSegment(range, 10, 14), undefined);
});

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
