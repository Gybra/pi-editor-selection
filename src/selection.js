export function cursorToOffset(text, { line, col }) {
  const lines = text.split("\n");
  const lineIndex = Math.max(0, Math.min(Math.trunc(line) || 0, lines.length - 1));
  const column = Math.max(0, Math.min(Math.trunc(col) || 0, lines[lineIndex].length));
  return lines.slice(0, lineIndex).reduce((offset, value) => offset + value.length + 1, 0) + column;
}

export function offsetToCursor(text, offset) {
  const position = Math.max(0, Math.min(Math.trunc(offset) || 0, text.length));
  const before = text.slice(0, position).split("\n");
  return { line: before.length - 1, col: before.at(-1).length };
}

export function selectionRange(anchor, focus) {
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

export function removeRange(text, anchor, focus) {
  const { start, end } = selectionRange(anchor, focus);
  return { text: text.slice(0, start) + text.slice(end), cursor: start };
}
