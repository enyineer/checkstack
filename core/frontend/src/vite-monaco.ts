import { createRequire } from "node:module";
import path from "node:path";

/**
 * Shared Vite settings required to bundle the Monaco / VS Code editor stack
 * that `@checkstack/ui`'s `CodeEditor` pulls in (`@typefox/monaco-editor-react`
 * + `monaco-languageclient` + `@codingame/monaco-vscode-*`).
 *
 * Consumed by BOTH `@checkstack/frontend`'s own `vite.config.ts` and
 * `@checkstack/dev-server`'s standalone-plugin dev config, so the two can never
 * drift. (They previously did: the dev server hand-rolled a config without
 * these settings, so any plugin using `CodeEditor` failed to bundle the
 * language workers - `[UNLOADABLE_DEPENDENCY] ... ts.worker.js?worker&url`.)
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
 * - `optimizeDeps.exclude` of the editor packages - Vite's dep pre-bundling
 *   rewrites the `?worker&url` imports inside these packages to paths relative
 *   to the pre-bundle output, which do not resolve back to the real worker
 *   files when the packages live in separate `node_modules/.bun/*` store
 *   entries (the standalone-plugin layout). Keeping them un-pre-bundled lets
 *   the worker URLs resolve from their actual package dirs.
 */
export interface MonacoViteConfig {
  worker: { format: "es" };
  resolve: { alias: { vscode: string } };
  optimizeDeps: { exclude: string[] };
}

/**
 * The editor packages that carry `?worker&url` imports (or the `vscode` alias
 * target). They must not be pre-bundled - see `optimizeDeps.exclude` above.
 */
const MONACO_NO_PREBUNDLE = [
  "@codingame/monaco-vscode-editor-api",
  "@codingame/monaco-vscode-extension-api",
  "@codingame/monaco-vscode-standalone-languages",
  "@codingame/monaco-vscode-standalone-typescript-language-features",
  "@codingame/monaco-vscode-standalone-json-language-features",
  "@typefox/monaco-editor-react",
  "monaco-languageclient",
];

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
    optimizeDeps: { exclude: [...MONACO_NO_PREBUNDLE] },
  };
}
