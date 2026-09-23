import assert from "node:assert/strict";
import test from "node:test";
import { KeybindingsManager, matchesKey, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import extension from "../extensions/index.ts";

function createEditor(mode = "fullscreen") {
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

  const tui = { mode, terminal: { rows: 24 }, requestRender() {} };
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

  assert.deepEqual(editor.handleMouse(mouse("press", 1, 1)), {
    handled: true, capture: true, focus: true,
  });
  assert.deepEqual(editor.handleMouse(mouse("drag", 4, 1)), { handled: true });
  assert.match(editor.render(20)[1], /\x1b\[7mbcd\x1b\[0m/);
  assert.deepEqual(editor.handleMouse(mouse("release", 4, 1)), {
    handled: true, focus: true,
  });

  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "aef");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
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
