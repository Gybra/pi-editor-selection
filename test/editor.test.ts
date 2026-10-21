import assert from "node:assert/strict";
import test from "node:test";
import {
  KeybindingsManager,
  matchesKey,
  setKeybindings,
  TUI_KEYBINDINGS,
  TuiAltScreen,
  type EditorTheme,
  type Terminal,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { CustomEditor, type ExtensionAPI, type ExtensionUIContext, type KeybindingsManager as PiKeybindingsManager } from "@earendil-works/pi-coding-agent";
import extension from "#extension";

function createEditor(mode: "fullscreen" | "regular" = "fullscreen", tuiOverride?: TUI) {
  let onSessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
  extension({
    on(event: string, handler: (event: unknown, ctx: unknown) => void) {
      if (event === "session_start") onSessionStart = handler;
      return () => {};
    },
  } as unknown as ExtensionAPI);

  let createComponent: Parameters<ExtensionUIContext["setEditorComponent"]>[0];
  assert.ok(onSessionStart);
  onSessionStart({}, {
    mode: "tui",
    ui: { setEditorComponent: (factory: typeof createComponent) => { createComponent = factory; } },
  });

  const tui = tuiOverride ?? ({ mode, terminal: { rows: 24 }, requestRender() {}, setFocus() {} } as unknown as TUI);
  const theme = { borderColor: (value: string) => value, selectList: {} } as EditorTheme;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  setKeybindings(keybindings);

  assert.ok(createComponent);
  return { editor: createComponent(tui, theme, keybindings as unknown as PiKeybindingsManager) as CustomEditor, tui };
}

function mouse(type: TuiMouseEvent["type"], x: number, y: number, button: TuiMouseEvent["button"] = "left"): TuiMouseEvent {
  return {
    type, button, x, y, screenX: x, screenY: y,
    width: 20, height: 24, shift: false, alt: false, ctrl: false,
  };
}

// Minimal terminal for driving a real TuiAltScreen with raw input sequences.
function fakeTerminal(kittyProtocolActive = false) {
  let onInput!: (data: string) => void;
  const terminal: Terminal = {
    columns: 20, rows: 24, kittyProtocolActive,
    start(handler) { onInput = handler; }, stop() {}, async drainInput() {}, write() {}, moveBy() {},
    hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
    clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  return { terminal, input: (data: string) => onInput(data) };
}

test("fullscreen drag selects prompt text that Backspace removes", () => {
  const { editor } = createEditor();
  editor.setText("abcdef");
  editor.render(20);

  assert.equal(editor.handleMouse(mouse("press", 1, 1)), undefined);
  assert.deepEqual(editor.handleMouse(mouse("drag", 4, 1)), { handled: true, capture: true });
  assert.deepEqual(editor.handleMouse(mouse("release", 4, 1)), { handled: true });

  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "af");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
});

test("fullscreen mouse selection copies through Pi and remains deletable", async () => {
  const { terminal, input } = fakeTerminal();
  let copied: string | undefined;
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copySelection: async (text) => { copied = text; return true; },
  });
  const { editor } = createEditor("fullscreen", tui);
  editor.setText("abcdef");
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();

  try {
    input("\x1b[<0;2;2M");
    assert.equal(tui.getFocusedComponent(), editor);
    input("\x1b[<32;5;2M");
    input("\x1b[<0;5;2m");
    await Promise.resolve();

    assert.equal(copied, "bcde");
    // The extension owns the selection after the first drag, so Pi's screen selection is cleared.
    assert.equal(tui.hasActiveSelection(), false);
    tui.renderNow();
    assert.match((tui as unknown as { previousScreen: string[] }).previousScreen[1], /\x1b\[7mbcd/);
    assert.doesNotMatch((tui as unknown as { previousScreen: string[] }).previousScreen[1], /\x1b\[7mf\s+\x1b\[0m/);
    editor.handleInput("\x7f");
    assert.equal(editor.getText(), "af");
    assert.equal(tui.hasActiveSelection(), false);
  } finally {
    tui.stop();
  }
});

test("typing replaces a keyboard selection but navigation does not", () => {
  const { editor } = createEditor();
  editor.setText("hello");
  editor.handleInput("\x1b[1;2D");
  editor.handleInput("Z");
  assert.equal(editor.getText(), "hellZ");
});

test("keyboard selection is painted even when Pi reports a screen selection", () => {
  const tui = {
    mode: "fullscreen", terminal: { rows: 24 }, requestRender() {}, setFocus() {}, hasActiveSelection: () => true,
  } as unknown as TUI;
  const { editor } = createEditor("fullscreen", tui);
  editor.setText("abcdef");
  editor.render(20);
  editor.handleInput("\x1b[1;2D");
  editor.handleInput("\x1b[1;2D");

  const span = editor.render(20)[1]!.match(/\x1b\[7m([\s\S]*?)\x1b\[0m/)?.[1] ?? "";
  assert.ok(span.includes("e") && span.includes("f"), "selected text is painted in reverse video");
});


test("kitty cursor markers do not swallow the keyboard highlight", () => {
  const { terminal, input } = fakeTerminal(true);
  const tui = new TuiAltScreen(terminal);
  const { editor } = createEditor("fullscreen", tui);
  editor.setText("ciao a tutti");
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();
  try {
    editor.handleInput("\x1b[1;2D");
    editor.handleInput("\x1b[1;2D");
    tui.renderNow();
    const screen = (tui as unknown as { previousScreen: string[] }).previousScreen;
    const line = screen.find((entry) => entry.includes("ciao")) ?? "";
    const span = line.match(/\x1b\[7m([\s\S]*?)\x1b\[0m/)?.[1] ?? "";
    assert.ok(span.includes("t") && span.includes("i"), `selected text painted: ${JSON.stringify(line)}`);
    assert.ok(!span.includes("\x1b[27m"), `highlight cut short: ${JSON.stringify(line)}`);
    assert.doesNotMatch(line, /\x1b\[7m\s*$/, `reverse video leaks into the padding: ${JSON.stringify(line)}`);
  } finally {
    tui.stop();
  }
});

test("real fullscreen double click replaces word on typing", () => {
  const { terminal, input } = fakeTerminal();
  const tui = new TuiAltScreen(terminal);
  const { editor } = createEditor("fullscreen", tui);
  editor.setText("hello world!");
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();
  try {
    for (let i = 0; i < 2; i++) {
      input("\x1b[<0;8;2M");
      input("\x1b[<0;8;2m");
    }
    tui.renderNow();
    assert.doesNotMatch((tui as unknown as { previousScreen: string[] }).previousScreen[1], /\x1b\[7m!\s+\x1b\[0m/);
    input("X");
    assert.equal(editor.getText(), "hello X!");
    input("\x1f");
    assert.equal(editor.getText(), "hello world!");
  } finally {
    tui.stop();
  }
});

test("reverse fullscreen drag also includes both endpoint characters", () => {
  const { editor } = createEditor();
  editor.setText("abcdef");
  editor.render(20);

  editor.handleMouse(mouse("press", 4, 1));
  editor.handleMouse(mouse("drag", 1, 1));
  editor.handleMouse(mouse("release", 1, 1));
  editor.handleInput("\x7f");

  assert.equal(editor.getText(), "af");
});

test("mouse selection extends through a complete emoji grapheme", () => {
  const { editor } = createEditor();
  editor.setText("a🙂b");
  editor.render(20);

  editor.handleMouse(mouse("press", 1, 1));
  editor.handleMouse(mouse("drag", 3, 1));
  editor.handleMouse(mouse("release", 3, 1));
  editor.handleInput("\x7f");

  assert.equal(editor.getText(), "a");
});

test("deleting text preserves an unselected large paste", () => {
  const { editor } = createEditor();
  const pasted = "x".repeat(1100);
  editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
  editor.handleInput(" tail");
  for (let i = 0; i < 5; i++) editor.handleInput("\x1b[1;2D");
  editor.handleInput("\x7f");

  assert.equal(editor.getText(), "[paste #1 1100 chars]");
  assert.equal(editor.getExpandedText(), pasted);

  editor.handleInput("\x1f");
  assert.equal(editor.getText(), "[paste #1 1100 chars] tail");
  assert.equal(editor.getExpandedText(), `${pasted} tail`);
});

test("deleting one large paste preserves another paste payload", () => {
  const { editor } = createEditor();
  const first = "a".repeat(1100);
  const second = "b".repeat(1100);
  editor.handleInput(`\x1b[200~${first}\x1b[201~`);
  editor.handleInput(" ");
  editor.handleInput(`\x1b[200~${second}\x1b[201~`);
  editor.handleInput("\x1b[1;2D");
  editor.handleInput("\x7f");

  assert.equal(editor.getText(), "[paste #1 1100 chars] ");
  assert.equal(editor.getExpandedText(), `${first} `);
});

test("fullscreen click moves the cursor without retaining a selection", () => {
  const { editor } = createEditor();
  editor.setText("abcdef");
  editor.render(20);

  editor.handleMouse(mouse("press", 2, 1));
  editor.handleMouse(mouse("release", 2, 1));
  editor.handleMouse(mouse("click", 2, 1));

  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
  assert.equal(editor.render(20)[1].includes("\x1b[7m\x1b[7mc"), false);
});

test("regular mode and non-text or non-left presses are not captured", () => {
  const regular = createEditor("regular").editor;
  regular.setText("abc");
  regular.render(20);
  assert.equal(regular.handleMouse(mouse("press", 1, 1)), undefined);

  const fullscreen = createEditor().editor;
  fullscreen.setText("abc");
  fullscreen.render(20);
  assert.equal(fullscreen.handleMouse(mouse("press", 1, 1, "middle")), undefined);
  assert.equal(fullscreen.handleMouse(mouse("press", 1, 0)), undefined);
});

function wheel(delta: number, y = 2): TuiMouseEvent {
  return { ...mouse("wheel", 1, y, "none"), wheelDelta: delta };
}

test("wheel over an overflowing prompt moves the cursor and is handled", () => {
  const { editor } = createEditor();
  editor.setText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  editor.render(20);
  assert.equal(editor.getCursor().line, 29);

  assert.deepEqual(editor.handleMouse(wheel(-3)), { handled: true });
  assert.equal(editor.getCursor().line, 26);
  editor.handleMouse(wheel(2));
  assert.equal(editor.getCursor().line, 28);
});

test("wheel stops at the prompt edges instead of browsing history", () => {
  const { editor } = createEditor();
  const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  editor.setText(text);
  editor.render(20);

  editor.handleMouse(wheel(-100));
  assert.equal(editor.getCursor().line, 0);
  assert.equal(editor.getText(), text);
  editor.handleMouse(wheel(-1));
  assert.equal(editor.getText(), text);
  editor.handleMouse(wheel(100));
  assert.equal(editor.getCursor().line, 29);
});

test("wheel scrolls a single long line that wraps and stops at both ends", () => {
  const { editor } = createEditor();
  const text = "word ".repeat(60).trim();
  editor.setText(text);
  editor.render(20);
  assert.deepEqual(editor.getCursor(), { line: 0, col: text.length });

  editor.handleMouse(wheel(-3));
  const up = editor.getCursor();
  assert.ok(up.col > 0 && up.col < text.length - 40, `moved up about 3 wrapped rows, got col ${up.col}`);

  // The column is kept while moving, so the top stop is the first wrapped row, not column 0.
  editor.handleMouse(wheel(-100));
  const top = editor.getCursor();
  assert.ok(top.col < 20, `first wrapped row, got col ${top.col}`);
  editor.handleMouse(wheel(-1));
  assert.deepEqual(editor.getCursor(), top);
  assert.equal(editor.getText(), text);
  editor.handleMouse(wheel(100));
  assert.equal(editor.getCursor().col > text.length - 20, true);
  assert.equal(editor.getText(), text);
});

test("scrolling with the wheel drops the old selection so typing edits at the cursor", () => {
  const { editor } = createEditor();
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
  editor.setText(lines.join("\n"));
  editor.render(20);
  editor.handleInput("\x1b[1;2D"); // shift+left selects the last character
  editor.handleMouse(wheel(-3));
  editor.handleInput("X");

  // Typing lands at the cursor three rows up; the old selection (last character) is untouched.
  assert.deepEqual(editor.getText().split("\n"), [...lines.slice(0, 26), "line 2X6", ...lines.slice(27)]);
});

test("wheel is left to Pi when the prompt fits", () => {
  const { editor } = createEditor();
  editor.setText("one\ntwo");
  editor.render(20);
  assert.equal(editor.handleMouse(wheel(-1)), undefined);
  assert.deepEqual(editor.getCursor(), { line: 1, col: 3 });
});

test("a real wheel event reaches the editor through the fullscreen renderer", () => {
  const { terminal, input } = fakeTerminal();
  const tui = new TuiAltScreen(terminal, false);
  const { editor } = createEditor("fullscreen", tui);
  editor.setText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();

  try {
    input("\x1b[<64;3;2M"); // wheel up over the prompt text
    assert.equal(editor.getCursor().line, 28);
    input("\x1b[<65;3;2M"); // wheel down
    assert.equal(editor.getCursor().line, 29);
  } finally {
    tui.stop();
  }
});

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(condition(), "condition not reached in time");
}

test("dragging out of the prompt scrolls it, extends the selection and copies the scrolled-off text", async () => {
  const { terminal, input } = fakeTerminal();
  let copied: string | undefined;
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copySelection: async (text) => { copied = text; return true; },
  });
  const { editor } = createEditor("fullscreen", tui);
  const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  editor.setText(text);
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();
  // 7 rows are visible: lines 23..29. Press on the last one, then drag past the top edge.
  assert.equal(editor.getCursor().line, 29);

  try {
    input("\x1b[<0;3;8M"); // press line 29, column 2
    input("\x1b[<32;3;6M"); // drag inside the prompt
    input("\x1b[<32;3;1M"); // drag onto the top border: auto-scroll up
    await until(() => editor.getCursor().line < 23);
    input("\x1b[<0;3;1m"); // release
    await Promise.resolve();

    const cursor = editor.getCursor();
    const lines = text.split("\n");
    assert.equal(cursor.col, 2);
    // From the cursor (scrolled above the first visible line) to the pressed character, inclusive.
    assert.equal(copied, [lines[cursor.line]!.slice(2), ...lines.slice(cursor.line + 1, 29), lines[29]!.slice(0, 3)].join("\n"));
    assert.equal(tui.hasActiveSelection(), false);

    const stopped = editor.getCursor().line;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(editor.getCursor().line, stopped, "auto-scroll stops on release");
  } finally {
    tui.stop();
  }
});

test("a drag copies nothing when Fullscreen copy on select is off", async () => {
  let copied: string | undefined;
  const { terminal, input } = fakeTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copyOnSelect: false,
    copySelection: async (text) => { copied = text; return true; },
  });
  const { editor } = createEditor("fullscreen", tui);
  editor.setText("abcdef");
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();

  try {
    input("\x1b[<0;2;2M");
    input("\x1b[<32;5;2M");
    input("\x1b[<0;5;2m");
    await Promise.resolve();
    assert.equal(copied, undefined);
  } finally {
    tui.stop();
  }
});

test("a first drag straight onto the border already scrolls the prompt", async () => {
  const { terminal, input } = fakeTerminal();
  const tui = new TuiAltScreen(terminal, false);
  const { editor } = createEditor("fullscreen", tui);
  editor.setText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  tui.setLayoutRoot(editor);
  tui.start();
  tui.renderNow();

  try {
    input("\x1b[<0;3;2M"); // press on the first visible line (23)
    input("\x1b[<32;3;1M"); // first drag event is already on the top border
    await until(() => editor.getCursor().line < 23);
    input("\x1b[<0;3;1m");
  } finally {
    tui.stop();
  }
});
