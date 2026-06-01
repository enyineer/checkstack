# Frontend bundle size — Monaco on the login page & eager plugin loading

> **Status:** Fix 1 + Fix 3 + Fix 2 (Strategy 1) DONE (2026-06-01, verified against prod build). Measured result + remaining levers in the progress log.
> **Branch:** TBD (off `main`)
> **Original ask:** Opening Checkstack transfers ~50 MB on initial page load (dev server, Vite on `localhost:5173`, ~123 requests). It loads the Monaco code editor and plugins/components that aren't even visible on the login page. Figure out why lazy-loading isn't working and whether it's only the dev server, then plan fixes.

## Progress log

- **Fix 1 (Monaco off the barrel) — DONE.** All THREE static Monaco edges from the `@checkstack/ui` barrel were cut (the original analysis only spotted two):
  1. Component path: `TypefoxEditor` is now `React.lazy` + `Suspense` inside `CodeEditor.tsx` (skeleton fallback honoring `usePerformance`).
  2. Utility path: `validateScripts.ts` now `await import(...)`s the Monaco editor API, the standalone TS worker, and `monacoTsService` in-body.
  3. **Signal path (missed originally):** the barrel re-exported `onVscodeServicesReady`/`areVscodeServicesReady` from the Monaco-heavy `monacoTsService`, which alone re-shipped the whole stack. Extracted to a new Monaco-free `core/ui/src/components/CodeEditor/vscodeServicesSignal.ts`; updated `monacoTsService.ts`, `TypefoxEditor.tsx`, `validateScripts.ts`, and `CodeEditor/index.ts` to source it from there.
- **Fix 3 (Vite chunking) — DONE, but Monaco grouping deliberately omitted.** Added a `react-vendor` `manualChunks` split only. A hand-rolled `monaco` chunk was tried and REVERTED: a tiny `@codingame/*` module is an *eager* transitive dep of non-editor code, so folding it into one chunk with the lazy editor body made the whole ~10 MB chunk a static dependency of the entry, re-shipping Monaco to the login page. Rollup's natural splitting already isolates the editor behind the lazy boundaries — leave it alone. This is documented in `core/frontend/vite.config.ts` so nobody re-adds it.
- **Verified (clean prod build):** initial-load HTML preloads only `index`, `react-vendor`, `browser`, `rolldown-runtime`, `preload-helper` — **zero** Monaco/stdlib/typefox/codingame. The ~10 MB monaco chunk + 3.3 MB `stdlib-types` + `TypefoxEditor` are now lazy chunks fetched only when an editor mounts. `typecheck` + `lint` clean; `core/ui` (126) and `automation-frontend` (128) tests pass. Changeset added (`.changeset/lazy-monaco-editor-bundle.md`).
- **Fix 2 (Strategy 1 — per-route `React.lazy`) — DONE.** Converted all route-page imports in 18 plugins (auth-frontend kept fully eager per decision) to `lazy(() => import(...).then(m => ({ default: m.X })))`, and wrapped the rendered route element in one shared `<Suspense>` in `App.tsx`. No change to `FrontendPlugin`, `plugin-registry.ts`, `plugin-loader.ts`, or `main.tsx`. Changeset: `.changeset/lazy-load-plugin-route-pages.md`. `typecheck` + `lint` clean; `automation-frontend` tests (128) pass; other edited plugins are config-only (no tests).
- **Fix 2 measured result (clean prod build):**
  - Entry chunk `index-*.js`: **2,455 KB → 189 KB** (gzip 655 KB → 52 KB).
  - **Total initial-load JS (entry + all modulepreloaded chunks): ~810 KB → ~679 KB gzip (~16% / ~130 KB).** 37 route-page chunks (~600 KB raw, e.g. `AutomationEditPage` 83 KB) are now lazy and fetched on navigation. No page bodies and no Monaco in the initial preload set (verified).
  - **Honest takeaway:** the headline "189 KB entry" overstates the win — the bytes redistributed into ~80 eagerly-preloaded chunks. Strategy 1 deferred *route pages*, which improves post-login navigation TTI, but the initial load is now dominated by **eager plugin registration + extension (slot) components + shared vendor**, not pages.
- **Next levers — DONE (2026-06-01):**
  1. **lucide-react v1 migration + icon bloat — DONE.** The eager `src` chunk was dominated by lucide's full `icons` map (~1 MB), imported by `DynamicIcon`. Also unified lucide from 5 drifting versions to `^1.17.0` (major bump; v1 removed brand icons → vendored GitHub/GitLab in `@checkstack/ui`, added `IconName` type in common). `DynamicIcon` now lazy-loads the icon set via a `React.lazy` `iconRegistry` chunk (fetched on first data-driven icon, not initial paint); statically named-imported icons tree-shake normally. Changeset: `.changeset/lucide-v1-and-icon-chart-perf.md`. **Stale-cache gotcha:** the lucide bump's icon-rename/removal errors only surfaced after `bun run typecheck:clean` — incremental `tsgo -b` reported 0 errors against stale `.tsbuild`.
  2. `react-vendor` 375 KB — left as-is (unavoidable React runtime, its own cached chunk).
  3. **recharts chart extensions — DONE.** The recharts chunk (~312 KB) + `auto-charts` (~92 KB) were eager via two paths, both now cut: the auto-chart slot extension lazy-loads `AutoChartGrid` (and healthcheck's index imports the extension directly, not via the `./auto-charts` barrel that re-exports chart components), and `HealthCheckSystemOverview` lazy-loads its on-demand `HealthCheckDrawer`.
  4. **Plugin template — DONE.** `core/scripts/src/templates/frontend/src/index.tsx.hbs` now scaffolds new plugins with a `React.lazy` route page, so generated plugins follow the lazy-loading strategy by default.
  5. **Strategy 2** (defer entire plugin module eval) — still NOT done; the only lever that removes eager *registration* cost, and still the high-risk app-shell redesign described below. Defer to its own effort.

- **Final measured initial-load JS (gzip), clean prod build:** Fix 1+3 ~810 KB → Fix 2 (route lazy) ~679 KB → lucide+DynamicIcon ~559 KB → chart lazy **~445 KB**. The remaining initial load is shared vendor (date-fns, markdown/ajv, react-day-picker in one ~650 KB-raw `src` chunk), `react-vendor`, and the app shell — no Monaco, no full icon set, no recharts, no route-page bodies.

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

### Fix 2 — lazy-load plugin route pages (detailed plan, not started)
**Goal:** stop the ~2.4 MB entry from statically pulling in all 52 plugin route-page component bodies. Defer each page to a per-route chunk fetched on navigation, so the initial load carries only plugin registration + nav/slot widgets.

**Verified facts (read 2026-06-01):**
- `core/frontend/src/main.tsx:9` does `await loadPlugins()` before React renders.
- `plugin-loader.ts:26-36` eager-globs all 29 `core/*-frontend/src/index.tsx` (`plugins/*-frontend` matches 0 today). Registration is synchronous at module-eval.
- Each plugin `index.tsx` statically imports its page components and declares `routes: [{ route, element: <SomePage />, title, accessRule }]`. **All 52 route elements across all plugins are bare `<Foo />`** — no props, no provider wrapping, no reuse of a page as an extension component. (Confirmed by grep: zero non-bare elements.)
- `App.tsx:178-188` renders `pluginRegistry.getAllRoutes()` into `<Route element={<RouteGuard …>{route.element}</RouteGuard>} />`. `RouteGuard` already shows a `<LoadingSpinner/>` while access loads, so a Suspense fallback has a precedent.
- The `FrontendPlugin` contract (`core/frontend-api/src/plugin.ts`): `routes[].element?: React.ReactNode`, `extensions[].component: React.ComponentType`, `apis[].factory`, `foreignSignals`. The registry stores `element` as-is.
- Route **metadata** (path, id, accessRule) lives in the `*-common` packages (e.g. `incidentRoutes`, `pluginMetadata` from `@checkstack/incident-common`) — already importable without the frontend module. Nav/slot **components** (UserMenu items, badges, dashboard cards) live in the frontend module and are React components, so they cannot move to `-common`.

#### Chosen approach: Strategy 1 — per-route `React.lazy`, contract-preserving (RECOMMENDED)

Keep each plugin module eagerly registered (so routes, nav extensions, API factories, and `foreignSignals` are all known synchronously at startup — no loader/registry/contract change), but make each route's `element` a lazy component so the heavy page **body** moves to its own chunk.

**Per-plugin edit (mechanical, 52 elements across ~25 plugins):**
```tsx
// before
import { IncidentConfigPage } from "./pages/IncidentConfigPage";
// ...
{ route: incidentRoutes.routes.config, element: <IncidentConfigPage />, title: "Incidents", accessRule: incidentAccess.incident.manage },

// after
import { lazy } from "react";
const IncidentConfigPage = lazy(() =>
  import("./pages/IncidentConfigPage").then((m) => ({ default: m.IncidentConfigPage })),
);
// ...
{ route: incidentRoutes.routes.config, element: <IncidentConfigPage />, title: "Incidents", accessRule: incidentAccess.incident.manage },
```
The `.then((m) => ({ default: m.X }))` shim is needed because pages are **named** exports and `React.lazy` wants a default. The route literal is otherwise unchanged.

**Single shell edit (`App.tsx`):** wrap the rendered route element in one `<Suspense>` so every lazy page shares one fallback:
```tsx
element={
  <RouteGuard accessRule={route.accessRule}>
    <Suspense fallback={<div className="h-full flex items-center justify-center p-8"><LoadingSpinner /></div>}>
      {route.element}
    </Suspense>
  </RouteGuard>
}
```
(`LoadingSpinner` is already imported and `usePerformance`-aware; matches the existing `RouteGuard` loading look.) The `DashboardSlot` on `/` renders extensions, not lazy pages, so it needs no Suspense unless we also lazy extensions (see optional phase).

**What stays eager (intentionally):** the 29 `index.tsx` modules themselves, their small nav/slot extension components, API factories, and `foreignSignals`. These must be synchronous for nav, slots, command palette, and query-invalidation wiring to work on first paint. They are lightweight relative to the page bodies (tables, editors, charts, forms).

**Decision point — the auth pages.** `LoginPage`/`RegisterPage`/`ForgotPasswordPage`/`ResetPasswordPage` are the *first* thing an unauthenticated user hits. Lazy-loading `LoginPage` adds one extra chunk fetch + a Suspense flash on the most critical path. **Recommendation: leave the auth route pages eager** (they are small) and lazy only the post-login plugin pages. Revisit if the auth chunk turns out heavy.

**Blast radius (Strategy 1):** ~25 plugin `index.tsx` files (swap static page import → `lazy()`), plus 1 `App.tsx` Suspense wrap. **No change to `FrontendPlugin`, `plugin-registry.ts`, `plugin-loader.ts`, or `main.tsx`.** Remote-plugin path untouched.

**Risk (Strategy 1):** Low-medium.
- Watch for any page that is *also* used as an extension component (grep confirmed none today, but re-check before editing each plugin).
- A page that reads route/search params still works (lazy only defers the module, not routing).
- Suspense flash on navigation — acceptable; mirrors `RouteGuard`'s existing access-loading spinner. Optionally add hover/intent preloading later (additive).
- `gcTime: 0` editor-loader rule (CLAUDE.md) is unaffected — that's query config, not bundling.

#### Escalation: Strategy 2 — full module deferral (HIGH RISK, only if Strategy 1 isn't enough)

If, after Strategy 1 + measurement, the eager graph (29 modules + their extension components + shared deps) is still too large, defer entire plugin modules:
- Flip the glob to `eager: false`, await the importers in `loadPlugins`, OR introduce a manifest contract: each plugin exports lightweight metadata (route paths + nav declarations as data, not components) consumed synchronously, plus a `() => import()` module loader invoked on navigation.
- **Cost:** changes the `FrontendPlugin` contract, `plugin-loader.ts`, `plugin-registry.ts`, and `App.tsx`; nav/slot widgets (currently React components in the frontend module) need either a metadata-only nav declaration or to stay eager anyway. This is a genuine app-shell redesign and must ship docs updates (`docs/src/content/docs/frontend/…`) in the same PR.
- **Do not start Strategy 2 without a fresh plan + measurement showing Strategy 1 was insufficient.**

#### Verification (either strategy)
1. `bun run build` in `core/frontend`; `rm -rf dist` first (note `emptyOutDir: false` — stale chunks accumulate and will mislead grep).
2. Confirm `dist/index.html` modulepreloads do NOT include the heavy plugin page chunks; confirm per-page chunks exist and are referenced only via the dynamic-import manifest (`__vite__mapDeps`), not as top-level entry imports.
3. Smoke-test navigation to several plugin routes; confirm pages load behind the Suspense fallback and render correctly.
4. `bun run typecheck` + `bun run lint` (root). No workspace dep changes expected, so the references generator should not be needed.
5. Changeset: perf improvement to `@checkstack/frontend` (and any plugin packages touched) — minor, BETA (no major bumps).

### Fix 3 — `manualChunks` in Vite config (LOW RISK, additive)
**Goal:** better splitting/caching of vendor + Monaco + per-plugin chunks in the prod build.

**Edit:** add `build.rollupOptions.output.manualChunks` to [core/frontend/vite.config.ts](../../core/frontend/vite.config.ts#L98-L106). Current `build` block is `{ target: "esnext", sourcemap: true, emptyOutDir: false }`; there is **no existing `rollupOptions`**, so this is purely additive.

**Blast radius:** 1 file, no imports change.
**Risk:** Low. Note this only improves caching/splitting; it does **not** by itself stop Monaco from loading on the login page (that's Fix 1). Complementary, not a substitute.

---

## 3. Recommended order

1. ~~**Fix 1**~~ — DONE.
2. ~~**Fix 3**~~ — DONE (react-vendor split only; Monaco grouping intentionally omitted, see progress log).
3. **Measure.** Re-check initial transfer on the login route with a prod build (`rm -rf dist && bun run build`; dev is inflated). Monaco is already gone; the remaining weight is the ~2.4 MB entry from eager plugin pages. If acceptable, **stop**.
4. **Fix 2** — start with **Strategy 1** (per-route `React.lazy`, contract-preserving). Measure again. Escalate to **Strategy 2** only if Strategy 1 leaves the eager graph too large.

---

## 4. Open questions / notes for implementer

- Confirm the Suspense fallback for the lazy `CodeEditor` matches the existing loading/skeleton look in the editor pages (perf rule: respect `isLowPower`, no heavy spinners).
- Decide `manualChunks` grouping strategy: at minimum isolate Monaco (`@codingame/*`, `@typefox/*`, `monaco-languageclient`) into its own chunk; optionally split React vendor and per-plugin chunks.
- Changeset: this is a perf improvement to `@checkstack/ui` (and `core/frontend` if Fix 2/3 land) — add one per the changesets rule (minor, BETA: no major bumps).
- Docs: if Fix 2 changes the frontend plugin contract, update the relevant page under `docs/src/content/docs/` in the same PR.
- Run `bun run lint` + `bun run typecheck` (root) after edits; if a workspace dep changes, run `bun run typecheck:references:generate`.
