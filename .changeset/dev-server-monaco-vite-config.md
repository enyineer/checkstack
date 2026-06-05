---
"@checkstack/frontend": minor
"@checkstack/dev-server": patch
---

Share the Monaco / VS Code editor Vite settings between `@checkstack/frontend` and `@checkstack/dev-server` so they cannot drift.

`@checkstack/dev-server` hand-rolled its Vite config and was missing the editor settings that `@checkstack/frontend`'s own `vite.config.ts` carries, so a standalone plugin whose frontend uses `@checkstack/ui`'s `CodeEditor` leaked a runtime `require("vscode")` into the browser (and the configs could silently diverge again on any future change).

`@checkstack/frontend` now exports a shared `monacoViteConfig` helper (`@checkstack/frontend/vite-monaco`) providing the two required settings - `worker.format: "es"` (the `@codingame` language workers are ES-module workers) and the `vscode` resolve alias (resolves `"vscode": "npm:@codingame/monaco-vscode-extension-api"` so `require("vscode")` doesn't leak). Both `vite.config.ts` and the dev server now consume it. The dev server resolves it from the plugin's installed `@checkstack/frontend`/`@checkstack/ui` and degrades gracefully when the editor stack is absent.
