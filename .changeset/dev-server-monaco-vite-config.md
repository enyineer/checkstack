---
"@checkstack/frontend": minor
"@checkstack/dev-server": patch
---

Fix the Monaco / VS Code `CodeEditor` (`@checkstack/ui`) failing to bundle in a standalone plugin's dev server.

`@checkstack/dev-server` hand-rolled its Vite config and was missing the Monaco settings that `@checkstack/frontend`'s own `vite.config.ts` carries, so any scaffolded plugin whose frontend pulls in `@checkstack/ui`'s `CodeEditor` failed with `[UNLOADABLE_DEPENDENCY] ... ts.worker.js?worker&url`. Three settings are required, and were drifting:

- `worker.format: "es"` - the `@codingame` language workers are ES-module workers.
- `resolve.alias.vscode` - resolves the `"vscode": "npm:@codingame/monaco-vscode-extension-api"` alias so `require("vscode")` does not leak into the browser.
- `optimizeDeps.exclude` of the editor packages - Vite's pre-bundling rewrites their `?worker&url` imports to paths that do not resolve back to the real worker files under bun's isolated `node_modules/.bun/*` store (the standalone-plugin layout).

`@checkstack/frontend` now exports these as a shared `monacoViteConfig` helper (`@checkstack/frontend/vite-monaco`), consumed by BOTH its own `vite.config.ts` and the dev server, so the two configs can no longer drift. The dev server resolves and applies it from the plugin's installed `@checkstack/frontend`/`@checkstack/ui`, degrading gracefully (dev server still starts) when the editor stack is absent.
