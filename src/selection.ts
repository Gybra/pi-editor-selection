export type Selection = { anchor: number; focus: number };

export function cursorToOffset(text: string, { line, col }: { line: number; col: number }): number {
  const lines = text.split("\n");
  const lineIndex = Math.max(0, Math.min(Math.trunc(line) || 0, lines.length - 1));
  const column = Math.max(0, Math.min(Math.trunc(col) || 0, lines[lineIndex].length));
  return lines.slice(0, lineIndex).reduce((offset, value) => offset + value.length + 1, 0) + column;
}

export function offsetToCursor(text: string, offset: number): { line: number; col: number } {
  const position = Math.max(0, Math.min(Math.trunc(offset) || 0, text.length));
  const before = text.slice(0, position).split("\n");
  return { line: before.length - 1, col: before.at(-1)!.length };
}

export function selectionRange(anchor: number, focus: number): { start: number; end: number } {
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

export function removeRange(text: string, anchor: number, focus: number): { text: string; cursor: number } {
  const { start, end } = selectionRange(anchor, focus);
  return { text: text.slice(0, start) + text.slice(end), cursor: start };
}

export function extendSelection(selection: Selection | undefined, previousOffset: number, nextOffset: number): Selection {
  return { anchor: selection?.anchor ?? previousOffset, focus: nextOffset };
}

export function selectionOnSegment(range: { start: number; end: number }, segmentStart: number, segmentEnd: number): { start: number; end: number } | undefined {
  const start = Math.max(range.start, segmentStart);
  const end = Math.min(range.end, segmentEnd);
  return start < end ? { start: start - segmentStart, end: end - segmentStart } : undefined;
}
