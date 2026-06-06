---
"@checkstack/ui": minor
"@checkstack/frontend": patch
"@checkstack/dev-server": minor
---

Make `@checkstack/ui`'s Monaco `CodeEditor` render in standalone `bun run dev`, and consolidate the Monaco editor Vite settings into one shared helper so they can't drift.

- **Shared config (now in `@checkstack/ui`).** `@checkstack/ui` exports a `monacoViteConfig` helper (`@checkstack/ui/src/vite-monaco`) with the editor's Vite settings - `worker.format: "es"` and the `vscode` resolve alias (so `require("vscode")` doesn't leak into the browser). `@checkstack/ui` owns `CodeEditor` and the editor dependencies, so all three consumers now share one source: the app's `vite.config.ts`, `@checkstack/dev-server`, and `@checkstack/ui`'s own Storybook config (each previously hand-rolled its own copy).
- **Pre-built workers (dev server).** In a standalone plugin, `@checkstack/ui` is a *pre-bundled npm dependency*, and Vite's dependency optimizer can't process the Monaco language workers it imports via `?worker&url` - the dev server used to crash (and serving `@checkstack/ui` as source instead broke the CJS/ESM interop of its other deps). The dev server now pre-builds the three Monaco workers (editor / TypeScript / JSON) into static ES-module bundles, serves them, and redirects the `?worker&url` imports to them via `resolve.alias` (which applies during pre-bundling). `@checkstack/ui` stays pre-bundled and the workers resolve, so the editor renders. Builds are content-addressed and cached under `node_modules/.cache/checkstack-dev-monaco` (concurrency-safe atomic promotion), so only the first run after a dependency change pays the build cost. React is deduped so the editor's hooks share the dev shell's React instance.
