---
"@checkstack/ui": minor
"@checkstack/frontend": minor
---

Stop shipping the Monaco editor on pages that never mount an editor (e.g. the login page).

The `@checkstack/ui` barrel transitively pulled the entire `@codingame/*` / `monaco-languageclient` stack into the initial load via three static edges from the `CodeEditor` subpackage. All three are now cut, with no change to the public `@checkstack/ui` API:

- `CodeEditor` lazy-loads its Monaco-backed `TypefoxEditor` behind `React.lazy` + an internal `Suspense` (skeleton fallback that respects `usePerformance`).
- `validateTypeScriptSources` now imports the Monaco editor API, the standalone TS worker, and `monacoTsService` via in-body `await import(...)` instead of at module scope.
- The "monaco-vscode services ready" signal (`markVscodeServicesReady` / `areVscodeServicesReady` / `onVscodeServicesReady`) moved to a new Monaco-free `vscodeServicesSignal` module, so the barrel re-export no longer drags Monaco in.

The Monaco editor body (~10 MB) now loads on demand only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was also added in `@checkstack/frontend` for stable vendor caching.
