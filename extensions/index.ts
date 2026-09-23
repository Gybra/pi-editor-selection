import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  matchesKey,
  sliceByColumn,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
// ponytail: wordWrapLine is an internal Pi API; use a public layout helper if Pi adds one.
import { wordWrapLine } from "@earendil-works/pi-tui/dist/components/editor.js";
import {
  cursorToOffset,
  extendSelection,
  removeRange,
  selectionOnSegment,
  selectionRange,
} from "../src/selection.js";

type Selection = { anchor: number; focus: number };
type VisualSegment = {
  text: string;
  start: number;
  end: number;
  line: number;
  lineStart: number;
  lineEnd: number;
  last: boolean;
};

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

class SelectionEditor extends CustomEditor {
  private readonly editorKeybindings: KeybindingsManager;
  private selection?: Selection;
  private renderedTextRows = 0;
  private renderedPaddingX = 0;
  private renderedSegments: VisualSegment[] = [];

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
    this.editorKeybindings = keybindings;
  }

  handleInput(data: string): void {
    if (this.isShowingAutocomplete()) {
      this.selection = undefined;
      super.handleInput(data);
      return;
    }

    const cursor = this.getCursor();
    const shiftedArrow = matchesKey(data, "shift+left")
      ? LEFT
      : matchesKey(data, "shift+right")
        ? RIGHT
        : matchesKey(data, "shift+up")
          ? UP
          : matchesKey(data, "shift+down")
            ? DOWN
            : undefined;

    if (shiftedArrow) {
      if (shiftedArrow === UP && cursor.line === 0 && cursor.col === 0) return;
      const previousOffset = cursorToOffset(this.getText(), cursor);
      super.handleInput(shiftedArrow);
      this.selection = extendSelection(
        this.selection,
        previousOffset,
        cursorToOffset(this.getText(), this.getCursor()),
      );
      return;
    }

    const range = this.selection
      ? selectionRange(this.selection.anchor, this.selection.focus)
      : undefined;
    if (
      range &&
      range.start < range.end &&
      (this.editorKeybindings.matches(data, "tui.editor.deleteCharBackward") ||
        this.editorKeybindings.matches(data, "tui.editor.deleteCharForward"))
    ) {
      const result = removeRange(this.getText(), range.start, range.end);
      this.selection = undefined;
      this.setText(result.text);
      let offset = cursorToOffset(this.getText(), this.getCursor());
      while (offset > result.cursor) {
        super.handleInput(LEFT);
        const nextOffset = cursorToOffset(this.getText(), this.getCursor());
        if (nextOffset >= offset) break;
        offset = nextOffset;
      }
      return;
    }

    this.selection = undefined;
    super.handleInput(data);
  }

  render(width: number): string[] {
    const rendered = super.render(width);
    if (this.isShowingAutocomplete()) {
      this.selection = undefined;
      this.renderedTextRows = 0;
      this.renderedSegments = [];
      return rendered;
    }

    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min(this.getPaddingX(), maxPadding);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    const segments: VisualSegment[] = [];
    const lines = this.getLines();
    let textOffset = 0;

    for (let line = 0; line < lines.length; line++) {
      const value = lines[line] ?? "";
      const chunks = wordWrapLine(value, layoutWidth);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex]!;
        segments.push({
          text: chunk.text,
          start: textOffset + chunk.startIndex,
          end: textOffset + chunk.endIndex,
          line,
          lineStart: chunk.startIndex,
          lineEnd: chunk.endIndex,
          last: chunkIndex === chunks.length - 1,
        });
      }
      textOffset += value.length + (line < lines.length - 1 ? 1 : 0);
    }

    const cursor = this.getCursor();
    const cursorSegment = segments.findIndex(
      (segment) =>
        segment.line === cursor.line &&
        cursor.col >= segment.lineStart &&
        (cursor.col < segment.lineEnd || (segment.last && cursor.col === segment.lineEnd)),
    );
    const cursorMarker = this.focused ? CURSOR_MARKER : "\x1b[7m";
    const cursorRenderIndex = rendered.findIndex(
      (line, index) => index > 0 && index < rendered.length - 1 && line.includes(cursorMarker),
    );
    const renderedCursorRow = cursorRenderIndex - 1;
    const viewportStart =
      cursorSegment >= 0 && renderedCursorRow >= 0 ? cursorSegment - renderedCursorRow : 0;
    this.renderedTextRows = Math.max(0, rendered.length - 2);
    this.renderedPaddingX = paddingX;
    this.renderedSegments = segments.slice(
      Math.max(0, viewportStart),
      Math.max(0, viewportStart) + this.renderedTextRows,
    );

    if (!this.selection) return rendered;
    const range = selectionRange(this.selection.anchor, this.selection.focus);
    if (range.start === range.end) return rendered;

    for (let row = 0; row < this.renderedSegments.length; row++) {
      const segment = this.renderedSegments[row]!;
      const localRange = selectionOnSegment(range, segment.start, segment.end);
      if (!localRange) continue;

      const startColumn = visibleWidth(segment.text.slice(0, localRange.start));
      const endColumn = visibleWidth(segment.text.slice(0, localRange.end));
      const start = paddingX + startColumn;
      const end = paddingX + endColumn;
      const line = rendered[row + 1]!;
      const selected = sliceByColumn(line, start, end - start, true);
      if (!selected) continue;

      const before = sliceByColumn(line, 0, start, true);
      const after = sliceByColumn(line, end, Math.max(0, width - end), true);
      rendered[row + 1] =
        before +
        "\x1b[7m" +
        selected.replaceAll("\x1b[0m", "\x1b[7m") +
        "\x1b[0m" +
        after;
    }

    return rendered;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new SelectionEditor(tui, theme, keybindings),
    );
  });
}
