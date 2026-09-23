# pi-editor-selection

Add visible text selection to Pi's prompt editor and delete the selected text with Backspace or Delete.

## Features

- Select text with **Shift+Left/Right/Up/Down** in both regular and fullscreen TUI modes.
- Extend or shrink a selection in either direction; it stays active until another editor action changes or clears it.
- Delete the selected range with the configured Backspace or Delete keybinding. Pi's undo behavior is preserved.
- In fullscreen mode, select prompt text by dragging with the left mouse button. Pi copies the native screen selection on release when **Fullscreen copy on select** is enabled.
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
npm test
npm pack --dry-run --json
```

## Publishing checklist

Publishing is manual. Before publishing:

1. Run the tests and inspect the dry-run tarball.
2. Run `npm login` and confirm `pi-editor-selection` is still available on npm.
3. Publish explicitly with `npm publish`.

This repository does not publish or push automatically.
