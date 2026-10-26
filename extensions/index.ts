import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  matchesKey,
  sliceByColumn,
  visibleWidth,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
// Pi's internal fake-cursor markers (converted to [7m/[27m by pi-tui resolveFakeCursors).
const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";

import {
  cursorToOffset,
  extendSelection,
  removeRange,
  selectionOnSegment,
  selectionRange,
} from "#src/selection";
import type { Selection } from "#src/types";
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
const AUTOSCROLL_INTERVAL_MS = 50;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function nextGraphemeOffset(text: string, offset: number): number {
  const grapheme = graphemeSegmenter.segment(text.slice(offset))[Symbol.iterator]().next().value?.segment;
  return grapheme && grapheme !== "\n" ? offset + grapheme.length : offset;
}

class SelectionEditor extends CustomEditor {
  private readonly editorKeybindings: KeybindingsManager;
  private selection?: Selection;
  private renderedTextRows = 0;
  private renderedSegments: VisualSegment[] = [];
  private mouseAnchor?: number;
  private mouseDragged = false;
  private lastPress?: { x: number; y: number; time: number };
  private mouseWordSelected = false;
  // Once a drag starts, the extension owns the selection: Pi's own one is tied to screen cells and cannot follow a scrolling prompt.
  private dragSelecting = false;
  private autoScroll?: { direction: 1 | -1; timer: ReturnType<typeof setInterval> };

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
    this.editorKeybindings = keybindings;
  }

  handleInput(data: string): void {
    this.stopDragSelection();
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
        this.editorKeybindings.matches(data, "tui.editor.deleteCharForward") ||
        matchesKey(data, "shift+space") ||
        decodeKittyPrintable(data) !== undefined ||
        (data.length > 0 && !/[\x00-\x1f\x7f-\x9f]/.test(data)))
    ) {
      const replacement = this.editorKeybindings.matches(data, "tui.editor.deleteCharBackward") ||
        this.editorKeybindings.matches(data, "tui.editor.deleteCharForward")
        ? ""
        : matchesKey(data, "shift+space") ? " " : decodeKittyPrintable(data) ?? data;
      const result = removeRange(this.getText(), range.start, range.end);
      result.text = result.text.slice(0, result.cursor) + replacement + result.text.slice(result.cursor);
      result.cursor += replacement.length;
      const pasteState = this as unknown as {
        pastes: Map<number, string>;
        pasteCounter: number;
      };
      const pastes = new Map(pasteState.pastes);
      const pasteCounter = pasteState.pasteCounter;
      this.selection = undefined;
      this.setText(result.text);
      // ponytail: Pi exposes no public way to clear fullscreen selection; remove this when it does.
      if (this.tui.mode === "fullscreen") {
        (this.tui as unknown as { clearTextSelection?: () => void }).clearTextSelection?.();
        this.tui.requestRender();
      }
      // ponytail: Pi's setText clears its private paste registry; preserve surviving IDs until Pi adds range edits.
      const remainingPasteIds = new Set(
        [...result.text.matchAll(/\[paste #(\d+)(?: \+\d+ lines| \d+ chars)?\]/g)].map(([, id]) => Number(id)),
      );
      pasteState.pastes = new Map([...pastes].filter(([id]) => remainingPasteIds.has(id)));
      pasteState.pasteCounter = pasteCounter;
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

  handleMouse(event: TuiMouseEvent) {
    if (this.tui.mode !== "fullscreen") return super.handleMouse(event);
    if (this.isShowingAutocomplete()) {
      this.selection = undefined;
      this.mouseAnchor = undefined;
      this.mouseDragged = false;
      return super.handleMouse(event);
    }

    if (event.type === "wheel") return this.scrollWithWheel(event.wheelDelta ?? 0);
    if (this.dragSelecting) return this.handleDragSelection(event);

    if (event.type === "release" && this.mouseAnchor !== undefined) {
      if (!this.mouseDragged && !this.mouseWordSelected) this.selection = undefined;
      this.mouseWordSelected = false;
      this.mouseAnchor = undefined;
      this.mouseDragged = false;
      return undefined;
    }

    // Before the bounds check: a first drag that lands on the border must already scroll.
    if (event.type === "drag" && event.button === "left" && this.mouseAnchor !== undefined) {
      this.lastPress = undefined;
      this.mouseWordSelected = false;
      this.clearScreenSelection();
      this.dragSelecting = true;
      return this.handleDragSelection(event);
    }

    if (event.button !== "left" || event.y <= 0 || event.y > this.renderedTextRows) {
      return super.handleMouse(event);
    }

    if (event.type === "press") {
      this.selection = undefined;
      this.mouseDragged = false;
      super.handleMouse({ ...event, type: "click" });
      const now = Date.now();
      this.mouseWordSelected = this.lastPress !== undefined &&
        now - this.lastPress.time < 500 && this.lastPress.x === event.x && this.lastPress.y === event.y;
      this.lastPress = this.mouseWordSelected ? undefined : { x: event.x, y: event.y, time: now };
      if (this.mouseWordSelected) {
        const { line, col } = this.getCursor();
        const word = [...wordSegmenter.segment(this.getLines()[line] ?? "")]
          .find((part) => part.index <= col && col < part.index + part.segment.length);
        if (word?.isWordLike) {
          const start = cursorToOffset(this.getText(), { line, col: word.index });
          this.selection = { anchor: start, focus: start + word.segment.length };
        }
      }
      this.mouseAnchor = cursorToOffset(this.getText(), this.getCursor());
      this.tui.setFocus(this);
      return undefined;
    }

    return super.handleMouse(event);
  }

  // Pi keeps the cursor row visible on every render, so scrolling the prompt means moving the cursor.
  private scrollWithWheel(delta: number): TuiMouseEventResult | undefined {
    if (this.visualLineCount() <= this.renderedTextRows) return undefined;
    // Like arrow navigation: an edit after scrolling must not hit the old, possibly off-screen, selection.
    this.clearSelection();
    this.moveCursorByVisualLines(delta);
    return { handled: true };
  }

  private clearSelection(): void {
    this.selection = undefined;
    this.clearScreenSelection();
  }

  private clearScreenSelection(): void {
    // ponytail: Pi exposes no public way to clear fullscreen selection; remove this when it does.
    (this.tui as unknown as { clearTextSelection?: () => void }).clearTextSelection?.();
    this.tui.requestRender();
  }

  private visualLines() {
    // ponytail: use Pi's private visual map until it exposes a public wrapped-line API.
    const editor = this as unknown as {
      buildVisualLineMap(width: number): { logicalLine: number; startCol: number; length: number }[];
      lastWidth: number;
    };
    return editor.buildVisualLineMap(editor.lastWidth);
  }

  private visualLineCount(): number {
    return this.visualLines().length;
  }

  private moveCursorByVisualLines(delta: number): void {
    const visualLines = this.visualLines();
    const cursor = this.getCursor();
    const current = Math.max(0, visualLines.findIndex(
      (visualLine, index) =>
        visualLine.logicalLine === cursor.line &&
        cursor.col >= visualLine.startCol &&
        (cursor.col < visualLine.startCol + visualLine.length ||
          visualLines[index + 1]?.logicalLine !== cursor.line),
    ));
    // Clamped: Up on the first row would open Pi's prompt history and replace the text.
    const steps = Math.max(0, Math.min(visualLines.length - 1, current + Math.round(delta))) - current;
    for (let step = 0; step < Math.abs(steps); step++) super.handleInput(steps > 0 ? DOWN : UP);
  }

  // Selects from the press point to the cursor, including the character under it.
  private extendMouseSelection(): void {
    if (this.mouseAnchor === undefined) return;
    const text = this.getText();
    const focus = cursorToOffset(text, this.getCursor());
    this.mouseDragged = focus !== this.mouseAnchor;
    if (this.mouseDragged) {
      const end = nextGraphemeOffset(text, Math.max(this.mouseAnchor, focus));
      this.selection = focus > this.mouseAnchor
        ? { anchor: this.mouseAnchor, focus: end }
        : { anchor: end, focus };
    } else {
      this.selection = undefined;
    }
  }

  // Captured drag: events keep coming when the pointer leaves the prompt, where they scroll it.
  private handleDragSelection(event: TuiMouseEvent): TuiMouseEventResult {
    if (event.type === "release") {
      this.finishDragSelection();
      return { handled: true };
    }
    if (event.type === "drag") {
      if (event.y < 1 || event.y > this.renderedTextRows) {
        // A fast drag can leave the prompt in one move: extend to the edge row now, or the
        // selection stays on the last row that happened to be inside it until autoscroll ticks.
        if (this.visualLineCount() <= this.renderedTextRows) {
          this.moveCursorByVisualLines(event.y < 1 ? -this.renderedTextRows : this.renderedTextRows);
          this.extendMouseSelection();
        }
        this.startAutoScroll(event.y < 1 ? -1 : 1);
      } else {
        this.stopAutoScroll();
        super.handleMouse({ ...event, type: "click" });
        this.extendMouseSelection();
      }
    }
    return { handled: true, capture: true };
  }

  private startAutoScroll(direction: 1 | -1): void {
    if (this.autoScroll?.direction === direction) return;
    this.stopAutoScroll();
    const timer = setInterval(() => {
      if (this.mouseAnchor === undefined) return this.stopAutoScroll();
      this.moveCursorByVisualLines(direction);
      this.extendMouseSelection();
      this.tui.requestRender();
    }, AUTOSCROLL_INTERVAL_MS);
    timer.unref();
    this.autoScroll = { direction, timer };
  }

  private stopAutoScroll(): void {
    if (this.autoScroll) clearInterval(this.autoScroll.timer);
    this.autoScroll = undefined;
  }

  private stopDragSelection(): void {
    this.stopAutoScroll();
    this.dragSelecting = false;
  }

  private finishDragSelection(): void {
    const range = this.selection && selectionRange(this.selection.anchor, this.selection.focus);
    this.stopDragSelection();
    this.mouseAnchor = undefined;
    this.mouseDragged = false;
    this.mouseWordSelected = false;
    if (!range || range.start === range.end) return;
    // ponytail: Pi's clipboard path (with its "Copied!" flash) is private; replace when it is public.
    const pi = this.tui as unknown as {
      getCopyOnSelect?: () => boolean;
      copyTextToClipboard?: (text: string) => Promise<unknown>;
    };
    if (pi.getCopyOnSelect?.() === true) void pi.copyTextToClipboard?.(this.getText().slice(range.start, range.end));
  }

  render(width: number): string[] {
    let rendered = super.render(width);
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
    const lineOffsets: number[] = [];
    let textOffset = 0;

    for (let line = 0; line < lines.length; line++) {
      lineOffsets[line] = textOffset;
      textOffset += (lines[line] ?? "").length + (line < lines.length - 1 ? 1 : 0);
    }

    // ponytail: use Pi's private visual map until it exposes a public wrapped-line API.
    const visualLines = (this as unknown as {
      buildVisualLineMap(width: number): { logicalLine: number; startCol: number; length: number }[];
    }).buildVisualLineMap(layoutWidth);
    for (let index = 0; index < visualLines.length; index++) {
      const visualLine = visualLines[index]!;
      const start = lineOffsets[visualLine.logicalLine] ?? 0;
      const line = lines[visualLine.logicalLine] ?? "";
      const endCol = visualLine.startCol + visualLine.length;
      segments.push({
        text: line.slice(visualLine.startCol, endCol),
        start: start + visualLine.startCol,
        end: start + endCol,
        line: visualLine.logicalLine,
        lineStart: visualLine.startCol,
        lineEnd: endCol,
        last: visualLines[index + 1]?.logicalLine !== visualLine.logicalLine,
      });
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
    this.renderedSegments = segments.slice(
      Math.max(0, viewportStart),
      Math.max(0, viewportStart) + this.renderedTextRows,
    );

    // Pi paints fullscreen mouse selections itself. Its selection slicer can carry the
    // editor's inverse-video cursor into the padding, so hide that cursor while selecting.
    // Pi can also report a selection it never paints, so it must not suppress ours.
    if ((this.tui as TUI & { hasActiveSelection?: () => boolean }).hasActiveSelection?.()) {
      rendered = rendered.map((line) => line.replace(
        `${CURSOR_MARKER}\x1b[7m`, CURSOR_MARKER,
      ));
    }
    if (!this.selection) return rendered;
    const range = selectionRange(this.selection.anchor, this.selection.focus);
    if (range.start === range.end) return rendered;

    // Pi turns its fake cursor markers into [7m/[27m after render; inside our reverse
    // span that [27m would close the highlight early, so drop them while selecting.
    rendered = rendered.map((line) =>
      line.replaceAll(FAKE_CURSOR_START, "").replaceAll(FAKE_CURSOR_END, ""));

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
