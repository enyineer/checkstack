# Frontend bundle size — Monaco on the login page & eager plugin loading

> **Status:** planned (investigated 2026-05-31, not started)
> **Branch:** TBD (off `main`)
> **Original ask:** Opening Checkstack transfers ~50 MB on initial page load (dev server, Vite on `localhost:5173`, ~123 requests). It loads the Monaco code editor and plugins/components that aren't even visible on the login page. Figure out why lazy-loading isn't working and whether it's only the dev server, then plan fixes.

Self-contained handoff. A future session should be able to pick this up without prior chat context.

---

## 1. Root cause (verified in repo)

The 50 MB is **partly dev-mode inflation, but mostly a real architectural issue that also ships in the production build.** Two compounding causes:

### Cause A — every plugin is eager-loaded before first render
[core/frontend/src/plugin-loader.ts:26-36](../../core/frontend/src/plugin-loader.ts#L26-L36) uses:

```ts
const coreModules = import.meta.glob("../../*-frontend/src/index.tsx", { eager: true });
const pluginModules = import.meta.glob("../../../plugins/*-frontend/src/index.tsx", { eager: true });
```

`eager: true` statically imports and parses **all 26 `core/*-frontend` plugins** (`plugins/*-frontend` currently matches 0). [core/frontend/src/main.tsx:9](../../core/frontend/src/main.tsx#L9) does `await loadPlugins()` *before* React renders, and [App.tsx](../../core/frontend/src/App.tsx) builds the route table + nav from all registered plugins up front. So the login page cannot paint until the entire app's plugin graph is loaded. The only dynamic `import()` in the loader (lines ~96, ~173) is for *remote* plugins, not these.

### Cause B — the login page transitively imports Monaco via the `@checkstack/ui` barrel
Import chain:

```
LoginPage → @checkstack/ui (barrel) → CodeEditor → TypefoxEditor → Monaco stack
```

- [core/auth-frontend/src/components/LoginPage.tsx:40](../../core/auth-frontend/src/components/LoginPage.tsx#L40) imports primitives (`Button`, `Input`, …) from `@checkstack/ui`.
- The barrel [core/ui/src/index.ts:60](../../core/ui/src/index.ts#L60) does `export * from "./components/CodeEditor"`.
- **Monaco leaks through TWO exports of that subpackage, not one:**
  1. The **component** path: [TypefoxEditor.tsx](../../core/ui/src/components/CodeEditor/TypefoxEditor.tsx) statically imports `@codingame/monaco-vscode-*`, `@typefox/monaco-editor-react`, `monaco-languageclient` (lines ~36, 40, 44, 45, 80, 81).
  2. The **utility** path: [validateScripts.ts:18-26](../../core/ui/src/components/CodeEditor/validateScripts.ts#L18-L26) statically imports `@codingame/monaco-vscode-editor-api` + `@codingame/monaco-vscode-standalone-typescript-language-features` and pulls in [monacoTsService.ts](../../core/ui/src/components/CodeEditor/monacoTsService.ts) (also Monaco-static). `validateTypeScriptSources` is re-exported from the barrel.
- The other CodeEditor utilities are **clean** (pure string/type transforms, no Monaco): `generateTypeDefinitions.ts`, `scriptContext.ts`, `importSpecifiers.ts`.

Both Monaco edges (component + `validateScripts`) are statically reachable from `LoginPage`, so a static import in the reachable graph gets pulled in even though nothing on the login page renders an editor.

There is **no `React.lazy` anywhere** in the frontend, and **no `manualChunks`** in the Vite config.

### Is it only the dev server?
- The **50 MB figure** is inflated by dev mode: Vite serves unbundled, unminified native ESM as ~123 separate files, no tree-shaking, full sourcemaps.
- **The structural problem survives the production build.** Monaco is statically reachable from the login route, so the prod `dist/` still ships it in the initial load. Evidence from `core/frontend/dist/assets/`: `ts.worker-*.js` 6.7 MB, main `index-*.js` 3.9 MB, `stdlib-types-*.js` 3.1 MB, `standaloneServices-*.js` 1.8 MB, plus JSON/editor workers. The login page effectively downloads the TypeScript language server. Dev mode just makes it visually dramatic.

---

## 2. The three fixes (independent, by impact)

> Key principle for Fix 1: keep the `@checkstack/ui` barrel's **public API identical** and move laziness *behind* it. Done this way, **no consumer import statements change** — all edits stay inside `core/ui`.

### Fix 1 — sever the barrel → Monaco edge (HIGHEST IMPACT, contained)
**Goal:** Monaco no longer loads on the login page (or any page that doesn't mount an editor / call TS validation).

**Edits (all inside `core/ui`, ~2-3 files):**
1. **Component path:** wrap `TypefoxEditor` in `React.lazy` behind an internal `<Suspense>` in the `CodeEditor` wrapper ([CodeEditor.tsx:7](../../core/ui/src/components/CodeEditor/CodeEditor.tsx#L7)). Public `<CodeEditor .../>` renders the same and props pass through.
2. **Utility path:** `validateTypeScriptSources` is *already* `async` — replace the top-level `import * as monaco` and `./monacoTsService` imports in [validateScripts.ts](../../core/ui/src/components/CodeEditor/validateScripts.ts) with in-body `await import(...)`. Callers already await, so no caller changes.

**Gotcha (this is the part the first analysis pass missed):** lazy-wrapping ONLY the component leaves `validateScripts.ts` still dragging Monaco into the barrel — Monaco would still ship to the login page. **Both** edges must be cut.

**Blast radius:** 2-3 files, all internal to `@checkstack/ui`. **Consumer import changes: none.** The component/type consumers stay as-is:
- [core/automation-frontend/src/pages/RunDetailPage.tsx:33](../../core/automation-frontend/src/pages/RunDetailPage.tsx#L33)
- [core/automation-frontend/src/pages/AutomationEditPage.tsx:36](../../core/automation-frontend/src/pages/AutomationEditPage.tsx#L36)
- [core/automation-frontend/src/pages/TemplatePlaygroundPage.tsx:24](../../core/automation-frontend/src/pages/TemplatePlaygroundPage.tsx#L24)
- [core/gitops-frontend/src/pages/KindRegistryPage.tsx:15](../../core/gitops-frontend/src/pages/KindRegistryPage.tsx#L15)
- [core/automation-frontend/src/script-context.ts:41](../../core/automation-frontend/src/script-context.ts#L41) (direct subpath import of `generateTypeDefinitions` — clean, no Monaco, leave as-is)
- Internal `core/ui` consumers via subpath (`TemplateInput.tsx`, `ScriptTestPanel.tsx`, `DynamicForm/JsonField.tsx`, …) — no path change needed.

**Risk:** Low-medium. Watch for: editor mount flash (provide a sensible Suspense fallback matching existing skeletons), and any synchronous expectation that `validateTypeScriptSources`'s Monaco side-effects are already warm (they aren't anymore — but the function is async, so this is fine if callers await as they do today).

**Verification:** build prod (or inspect the dev network panel) on the login route and confirm no `@codingame`/`ts.worker`/`standaloneServices` chunks load until an editor mounts or TS validation runs.

### Fix 2 — lazy-load plugins (HIGH RISK, architectural)
**Goal:** plugins load on navigation instead of all 26 up front.

**The blocker is not imports — it's the shell contract.** Registration is synchronous at module-eval, and the route table + nav are built from all plugins before first render ([main.tsx:9](../../core/frontend/src/main.tsx#L9) → [plugin-loader.ts:26-36](../../core/frontend/src/plugin-loader.ts#L26-L36) → `App.tsx`). Each plugin `index.tsx` exports a `createFrontendPlugin({ routes, extensions, ... })` object literal at eval time (routes/extensions are NOT lazy). Flipping the glob to `eager: false` only parallelizes loading; real deferral requires decoupling "module loaded" from "routes registered" — e.g. per-route `React.lazy` + a manifest of routes/nav metadata known without evaluating each plugin's full module.

**Blast radius:** `plugin-loader.ts` + an `App.tsx` restructure (route table built lazily). The 26 plugin `index.tsx` files likely need a contract change to separate lightweight metadata/nav from heavy route component bodies. **Consumer-import surface is small, but the plugin contract changes — that is the cost.**

**Risk:** High. Defer until Fix 1 + Fix 3 are measured; may not be needed if Fix 1 + manualChunks get initial load acceptable.

### Fix 3 — `manualChunks` in Vite config (LOW RISK, additive)
**Goal:** better splitting/caching of vendor + Monaco + per-plugin chunks in the prod build.

**Edit:** add `build.rollupOptions.output.manualChunks` to [core/frontend/vite.config.ts](../../core/frontend/vite.config.ts#L98-L106). Current `build` block is `{ target: "esnext", sourcemap: true, emptyOutDir: false }`; there is **no existing `rollupOptions`**, so this is purely additive.

**Blast radius:** 1 file, no imports change.
**Risk:** Low. Note this only improves caching/splitting; it does **not** by itself stop Monaco from loading on the login page (that's Fix 1). Complementary, not a substitute.

---

## 3. Recommended order

1. **Fix 1** first — it's the only fix that actually removes Monaco from the login-page load, and it's contained to `@checkstack/ui` with zero consumer-import churn.
2. **Fix 3** next — cheap, additive, improves caching once chunks are split.
3. **Measure.** Re-check initial transfer on the login route (prefer a prod build for a realistic number; dev is inflated). If initial load is now acceptable, **stop**.
4. **Fix 2** only if still needed — it's the expensive, behavior-touching one (plugin contract + app shell).

---

## 4. Open questions / notes for implementer

- Confirm the Suspense fallback for the lazy `CodeEditor` matches the existing loading/skeleton look in the editor pages (perf rule: respect `isLowPower`, no heavy spinners).
- Decide `manualChunks` grouping strategy: at minimum isolate Monaco (`@codingame/*`, `@typefox/*`, `monaco-languageclient`) into its own chunk; optionally split React vendor and per-plugin chunks.
- Changeset: this is a perf improvement to `@checkstack/ui` (and `core/frontend` if Fix 2/3 land) — add one per the changesets rule (minor, BETA: no major bumps).
- Docs: if Fix 2 changes the frontend plugin contract, update the relevant page under `docs/src/content/docs/` in the same PR.
- Run `bun run lint` + `bun run typecheck` (root) after edits; if a workspace dep changes, run `bun run typecheck:references:generate`.
