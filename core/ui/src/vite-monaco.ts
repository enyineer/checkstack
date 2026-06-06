import { createRequire } from "node:module";
import path from "node:path";

/**
 * Shared Vite settings required to bundle the Monaco / VS Code editor stack
 * that `@checkstack/ui`'s `CodeEditor` pulls in (`@typefox/monaco-editor-react`
 * + `monaco-languageclient` + `@codingame/monaco-vscode-*`).
 *
 * Lives here in `@checkstack/ui` (which owns `CodeEditor` and the editor
 * dependencies) so every consumer can share one source instead of drifting:
 * `@checkstack/frontend`'s `vite.config.ts`, `@checkstack/dev-server`'s
 * standalone-plugin dev config, and `@checkstack/ui`'s own Storybook config.
 *
 * Two settings are required:
 *
 * - `worker.format: "es"` - the `@codingame` language-feature workers are ES
 *   modules; the default (iife) worker format cannot bundle them.
 * - `resolve.alias.vscode` - `@typefox/monaco-editor-react` and
 *   `monaco-languageclient` declare `"vscode": "npm:@codingame/monaco-vscode-extension-api"`,
 *   but the package that actually does `require("vscode")` at runtime
 *   (`@codingame/monaco-vscode-api`) has no `vscode` in its own scope under
 *   bun's isolated `node_modules`. Aliasing every `vscode` specifier to the
 *   real package dir resolves it (otherwise a runtime `require` leaks into the
 *   browser).
 */
export interface MonacoViteConfig {
  worker: { format: "es" };
  resolve: { alias: { vscode: string } };
}

/**
 * Build the Monaco-related Vite settings, resolving the `vscode` npm-alias to
 * an absolute path so Vite can alias it.
 *
 * `resolveFrom` are candidate base dirs from which
 * `@typefox/monaco-editor-react` (and, through it, the `vscode` alias) can be
 * resolved: `core/ui` in the monorepo, or the plugin's installed
 * `@checkstack/ui` location in a standalone scaffold. The path follows bun's
 * store layout on any machine rather than being hardcoded.
 *
 * Throws if the editor stack cannot be resolved (e.g. `@checkstack/ui` is not
 * installed). Callers that must degrade gracefully should wrap the call.
 */
export function monacoViteConfig({
  resolveFrom,
}: {
  resolveFrom: string[];
}): MonacoViteConfig {
  const req = createRequire(import.meta.url);
  const typefoxDir = path.dirname(
    req.resolve("@typefox/monaco-editor-react", { paths: resolveFrom }),
  );
  const vscodeApiDir = path.dirname(
    req.resolve("vscode", { paths: [typefoxDir] }),
  );
  return {
    worker: { format: "es" },
    resolve: { alias: { vscode: vscodeApiDir } },
  };
}
