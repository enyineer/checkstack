---
"@checkstack/frontend": minor
"@checkstack/dev-server": minor
---

Make `@checkstack/ui`'s Monaco `CodeEditor` render in standalone `bun run dev`, and share the Monaco editor Vite settings between `@checkstack/frontend` and `@checkstack/dev-server` so they cannot drift.

Two parts:

- **Shared config.** `@checkstack/frontend` now exports a `monacoViteConfig` helper (`@checkstack/frontend/vite-monaco`) with the editor settings the app's `vite.config.ts` already used - `worker.format: "es"` and the `vscode` resolve alias (so `require("vscode")` doesn't leak into the browser). Both the app config and the dev server consume it.
- **Pre-built workers (dev server).** In a standalone plugin, `@checkstack/ui` is a *pre-bundled npm dependency*, and Vite's dependency optimizer can't process the Monaco language workers it imports via `?worker&url` - the dev server used to crash (or, with `@checkstack/ui` served as source, its other deps lost CJS/ESM interop). The dev server now pre-builds the three Monaco workers (editor / TypeScript / JSON) into static ES-module bundles, serves them, and redirects the `?worker&url` imports to them via `resolve.alias` (which applies during pre-bundling). `@checkstack/ui` stays pre-bundled, the workers resolve, and the editor renders. Builds are content-addressed and cached under `node_modules/.cache/checkstack-dev-monaco` (concurrency-safe atomic promotion), so only the first run after a dependency change pays the build cost. React is deduped so the editor's hooks share the dev shell's React instance.
