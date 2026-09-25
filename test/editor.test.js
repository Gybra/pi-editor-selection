import assert from "node:assert/strict";
import test from "node:test";
import {
  KeybindingsManager,
  matchesKey,
  setKeybindings,
  TUI_KEYBINDINGS,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import extension from "../extensions/index.ts";

function createEditor(mode = "fullscreen", tuiOverride) {
  let onSessionStart;
  extension({
    on(event, handler) {
      if (event === "session_start") onSessionStart = handler;
    },
  });

  let createComponent;
  onSessionStart({}, {
    mode: "tui",
    ui: { setEditorComponent: (factory) => { createComponent = factory; } },
  });

  const tui = tuiOverride ?? { mode, terminal: { rows: 24 }, requestRender() {}, setFocus() {} };
  const theme = { borderColor: (value) => value, selectList: {} };
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  setKeybindings(keybindings);

  return { editor: createComponent(tui, theme, keybindings), tui };
}

function mouse(type, x, y, button = "left") {
  return {
    type, button, x, y, screenX: x, screenY: y,
    width: 20, height: 24, shift: false, alt: false, ctrl: false,
  };
}

test("fullscreen drag selects prompt text that Backspace removes", () => {
  const { editor } = createEditor();
  editor.setText("abcdef");
  editor.render(20);

  assert.equal(editor.handleMouse(mouse("press", 1, 1)), undefined);
  assert.equal(editor.handleMouse(mouse("drag", 4, 1)), undefined);
  assert.equal(editor.handleMouse(mouse("release", 4, 1)), undefined);

  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "af");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
});

test("fullscreen mouse selection copies through Pi and remains deletable", async () => {
  let input;
  let copied;
  const terminal = {
    columns: 20,
    rows: 24,
    kittyProtocolActive: false,
    start(onInput) { input = onInput; },
    stop() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  };
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
    assert.equal(tui.hasActiveSelection(), true);
    tui.renderNow();
    assert.doesNotMatch(tui.previousScreen[1], /\x1b\[7mf\s+\x1b\[0m/);
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

test("real fullscreen double click replaces word on typing", () => {
  let input;
  const terminal = {
    columns: 20, rows: 24, kittyProtocolActive: false,
    start(onInput) { input = onInput; }, stop() {}, write() {}, moveBy() {},
    hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
    clearScreen() {}, setTitle() {}, setProgress() {},
  };
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
    assert.doesNotMatch(tui.previousScreen[1], /\x1b\[7m!\s+\x1b\[0m/);
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
