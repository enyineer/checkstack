import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { monacoViteConfig } from "./vite-monaco";

// `@typefox/monaco-editor-react` + the `vscode` npm-alias live in
// `@checkstack/ui`'s dependencies (this package's root).
const UI_DIR = path.resolve(import.meta.dir, "..");

describe("monacoViteConfig", () => {
  it("returns the ES-module worker format the @codingame workers require", () => {
    const config = monacoViteConfig({ resolveFrom: [UI_DIR] });
    expect(config.worker.format).toBe("es");
  });

  it("resolves the `vscode` alias to the real @codingame package dir", () => {
    const config = monacoViteConfig({ resolveFrom: [UI_DIR] });
    const vscodeDir = config.resolve.alias.vscode;
    // The alias must point at @codingame/monaco-vscode-extension-api on disk
    // (the package `require("vscode")` actually resolves to), not the bare
    // `vscode` specifier that leaks a runtime require into the browser.
    expect(vscodeDir).toContain("monaco-vscode");
    expect(path.isAbsolute(vscodeDir)).toBe(true);
    expect(existsSync(vscodeDir)).toBe(true);
  });
});
