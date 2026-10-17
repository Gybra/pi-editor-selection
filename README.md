# pi-editor-selection

Add visible text selection to Pi's prompt editor. Delete it with Backspace or Delete, or replace it by typing.

## Features

- Select text with **Shift+Left/Right/Up/Down** in both regular and fullscreen TUI modes.
- Extend or shrink a selection in either direction; it stays active until another editor action changes or clears it.
- Delete the selected range with the configured Backspace or Delete keybinding. Pi's undo behavior is preserved.
- In fullscreen mode, select prompt text by dragging or double-clicking a word with the left mouse button. Pi copies the native screen selection on release when **Fullscreen copy on select** is enabled.
- In fullscreen mode, scroll a long prompt with the mouse wheel. The wheel moves the cursor line by line, like the arrow keys, and stops at the first and last line. Prompts that fit on screen leave the wheel to Pi.
- In fullscreen mode, keep dragging above or below the prompt to scroll it and extend the selection; the whole selected text is copied on release when **Fullscreen copy on select** is enabled.
- No Ctrl/Cmd+A, Ctrl/Cmd+C, or Ctrl/Cmd+X selection bindings are added.

The extension does not change Pi's TUI mode. Keyboard selection works in either mode; mouse selection is available only in fullscreen mode. Switch modes in Pi's settings, or start Pi with `--tui-mode fullscreen`.

## Install

After this package is published to npm:

```sh
pi install npm:pi-editor-selection
```

To load it from a local checkout:

```sh
pi --extension ./extensions/index.ts
```

Or load the package manifest from the repository root:

```sh
pi -e .
```

## Test and package check

```sh
npm install --no-package-lock
npm run typecheck
npm test
npm pack --dry-run --json
```

## Publishing checklist

Publishing is manual. Before publishing:

1. Run the tests and inspect the dry-run tarball.
2. Run `npm login` and confirm `pi-editor-selection` is still available on npm.
3. Publish explicitly with `npm publish`.

This repository does not publish or push automatically.
