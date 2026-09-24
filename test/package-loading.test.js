import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Pi loads the extension with host-provided peer modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-editor-selection-"));
  const piDist = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));

  try {
    await mkdir(join(root, "extensions"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await cp(new URL("../extensions/index.ts", import.meta.url), join(root, "extensions/index.ts"));
    await cp(new URL("../src/selection.js", import.meta.url), join(root, "src/selection.js"));

    const { loadExtensions } = await import(new URL("core/extensions/loader.js", piDist));
    const result = await loadExtensions([join(root, "extensions/index.ts")], root);

    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    assert.equal(result.extensions.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
