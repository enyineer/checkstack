# Runtime frontend-plugin sharing contract

> **Status:** design for review (drafted 2026-06-06, not started)
> **Branch:** off `main` (discovered while building the external-plugin
> install E2E on `feat/external-plugin-install-e2e`)
> **Goal:** make an **installed** (runtime, non-monorepo) frontend plugin
> actually render in the host SPA. Today a packed frontend plugin cannot
> load at all: it is never built into a browser-loadable ESM, and even if
> it were, the host only shares React/router with runtime plugins — not the
> `@checkstack/*` framework, the UI kit, or the React Query client every
> real plugin depends on. Worse, the host **bundles its own React** and does
> not itself consume the import map, so a runtime plugin's React would be a
> *different instance* than the host's → hooks/context break.

Self-contained handoff. Every current-state claim carries a `file:line`
anchor verified against the tree at draft time.

---

## 1. Why (current state, anchored)

### 1a. Packed frontend plugins are never built

- `plugin-pack` only runs `bun pm pack` per package
  (`core/scripts/src/commands/plugin-pack.ts:342-349`); there is **no
  build step**. The scaffolded frontend package ships raw source —
  `package.json` `main` is `src/index.tsx`
  (`core/scripts/src/templates/frontend/package.json.hbs`), no `dist`, no
  `build` script (`...frontend/package.json.hbs` scripts block).
- The host serves runtime frontend plugins from
  `/assets/plugins/<name>/index.js` → `<plugin.path>/dist/index.js`
  (`core/backend/src/index.ts:611-633`). With no `dist/`, that path 404s,
  the browser `import(remoteUrl)` (`core/frontend/src/plugin-loader.ts:96`)
  fails, and the plugin's nav entry never appears.
- **Verified empirically:** a Vite library build of the installed
  `widget-frontend` (externalising the shared surface) compiles cleanly to
  ESM in ~35ms (20 modules → `index.js` + a lazy page chunk + a chunk
  holding the bundled intra-plugin `widget-common`). So the *build* is
  easy; it just does not exist yet.

### 1b. The host shares only React/router with runtime plugins

- The import map in `core/frontend/index.html:11-20` has exactly four
  entries: `react`, `react-dom`, `react-dom/client`, `react-router-dom`.
  It is copied verbatim into `dist/index.html` (Vite, `emptyOutDir: false`
  at `core/frontend/vite.config.ts:97`).
- The vendor bundles built by `core/frontend/vite.config.vendor.ts:20-31`
  cover only those same four packages. Served by the backend at
  `/vendor/*` → `dist/vendor/*` (`core/backend/src/index.ts:378-387`).
- The library build of `widget-frontend` (1a) leaves these bare imports
  unresolved for the browser — i.e. the host must provide them but does
  **not**: `react/jsx-runtime`, `@checkstack/frontend-api`,
  `@checkstack/ui`, `@checkstack/common`, `lucide-react`. (`@tanstack/
  react-query` is pulled in transitively via `@checkstack/frontend-api`'s
  query hooks.)

### 1c. Every real plugin needs host singletons, not duplicates

Plugins render **inside** the host's provider tree — plugin routes are
registered into `pluginRegistry` and mounted inside `<BrowserRouter>` /
`<Routes>` within the host providers (`core/frontend/src/App.tsx:154-263`,
routes mapped from `pluginRegistry.getAllRoutes()`). The provider stack the
plugin's components/hooks consume (`core/frontend/src/main.tsx:11-17`,
`core/frontend/src/App.tsx:374-402`):

| Provider | Package | Context that MUST be the host's instance |
|---|---|---|
| `QueryClientProvider` (`App.tsx:54-85` creates the client) | `@tanstack/react-query` | the cache; `usePluginClient().useQuery` calls `useQueryClient()` (`core/frontend-api/src/orpc-query.tsx:17,350`) |
| `ApiProvider` + `OrpcQueryProvider` | `@checkstack/frontend-api` | `pluginRegistry`, API registry, oRPC↔RQ bridge |
| `BrowserRouter` | `react-router-dom` | location/navigate |
| `ThemeProvider` | `@checkstack/ui` (`ThemeProvider.tsx:32`) | theme class on root |
| `ToastProvider` → `PerformanceProvider` | `@checkstack/ui` (`ToastProvider.tsx:29`, `PerformanceProvider.tsx:20`; perf depends on toast) | `useToast`, `usePerformance` (8+ UI components call `usePerformance`) |
| `SessionProvider`, `SignalProvider` | auth/signal-frontend | session, live signals |

A plugin that **bundles its own** copy of any context-bearing package gets
a *second* React-context identity, and `useContext` returns the default
(throws/empty) — the classic "two instances" failure.

### 1d. The host itself does not use the import map → two React instances

This is the load-bearing problem. The host's own bundle **bundles React**
and relies on `resolve.dedupe` at build time
(`core/frontend/vite.config.ts:149-159`, strategy comment at `:57-72`); the
built host lands React in `dist/assets/react-vendor-*.js`. The import map
only affects **runtime** `import()`s, which the host never makes for React.
So a runtime plugin's `react` → `/vendor/react.js` is a **different module
instance** than the host's bundled React. Hooks rely on a single React
dispatcher; two instances break every hook the moment a plugin renders.

> **Conclusion:** runtime (installed) frontend plugins have never worked
> end-to-end in production. Only (a) **bundled monorepo** plugins (compiled
> into the host graph, deduped) and (b) the **dev-server**, which aliases
> the plugin INTO the host app as one Vite graph
> (`core/dev-server/src/dev-frontend.ts`), actually work. The packed/
> installed path is unfinished on both the pack side AND the host side.

---

## 2. The contract to build

A runtime plugin ESM imports a fixed set of **bare specifiers** that the
host resolves to its OWN already-evaluated module instances. Two buckets:

**Shared singletons (host must provide the one true instance):**
`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`,
`react-router-dom`, `@tanstack/react-query`, `@orpc/client`,
`@orpc/tanstack-query`, `@checkstack/frontend-api`, `@checkstack/ui`,
`@checkstack/common`.

**Stateless, safe to duplicate (but cheaper to share):** `lucide-react`,
`zod`. Recommend sharing `lucide-react` (large) and letting plugins bundle
arbitrary other libs.

Plugins **bundle** their own intra-plugin code (their `*-common` sibling,
their pages) — confirmed working in the 1a prototype.

---

## 3. Design decision: expand vendor + import map (Option A)

**Recommend Option A — host vendor bundles + an expanded import map that
the HOST ALSO consumes — over Option B (a runtime module registry the host
exposes on `window`).**

Rationale:
- Plugins already render inside the host tree (§1c); they need the *real*
  React/RQ/router/context instances, not facades. A registry still has to
  hand back those exact instances, so it buys nothing over an import map
  and adds a bespoke API surface.
- Import maps are the standard, zero-runtime mechanism and are already half
  wired (§1b).

**The non-obvious requirement that makes it correct:** the host's own app
bundle must **stop bundling** the shared set and instead import it from the
import map too (externalise it in `core/frontend/vite.config.ts`), so host
and plugins resolve to the *same* `/vendor/*` modules. Without this, §1d's
two-instance bug persists. This is the single biggest change and the main
risk surface (it alters how the host app itself loads React/RQ/UI).

### Phased plan

**Phase 1 — host sharing contract (the hard part).**
1. Add vendor entries for the full shared set in
   `core/frontend/vite.config.vendor.ts` (react/jsx-runtime,
   @tanstack/react-query, @orpc/client, @orpc/tanstack-query,
   @checkstack/frontend-api, @checkstack/ui, @checkstack/common,
   lucide-react). `@checkstack/*` entries point at each package's built ESM
   entry; ensure those packages are built first (workspace build ordering).
2. Expand the import map in `core/frontend/index.html` to match, 1:1 with
   the vendor file names. Add `react/jsx-runtime` (subpath key).
3. Externalise the shared set in the host's main build
   (`core/frontend/vite.config.ts`) so the host loads them via the import
   map — host + plugins now share one instance. Verify the host SPA still
   boots (this is where regressions will surface).
4. Decide CSS: `@checkstack/ui`'s styles + the plugin's own CSS. The loader
   already pulls `/assets/plugins/<name>/index.css`
   (`core/frontend/src/plugin-loader.ts:80`); confirm Tailwind layer/token
   collisions are handled (host ships the design tokens; plugin CSS should
   be utility-only).

**Phase 2 — build frontend plugins in `plugin-pack`.**
- Add a frontend build (Vite lib mode, proven in §1a) that externalises the
  exact Phase-1 shared set and bundles everything else, emitting
  `dist/index.js` (+ lazy chunks) and `dist/index.css`. Wire it into
  `core/scripts/src/commands/plugin-pack.ts` for `type: "frontend"`
  packages (and per-sibling within `--bundle`).
- Reuse `monacoViteConfig` from `@checkstack/ui` only if the plugin uses the
  editor; otherwise keep the externals list minimal.

**Phase 3 — scaffold ships `dist`.**
- `core/scripts/src/templates/frontend/package.json.hbs`: add a `build`
  script, set `files`/`exports`/`main` to ship `dist/index.js` +
  `dist/index.css`, and make `pack` run the build first.

**Phase 4 — prove + document.**
- Re-enable the frontend assertions in
  `core/create-checkstack-plugin/src/external-plugin-install.e2e.it.test.ts`
  (Widget nav link visible, page renders, no error boundary).
- Document the runtime frontend-plugin contract under
  `docs/src/content/docs/frontend/` (the shared-singleton list is the
  public contract third-party authors must externalise against).

---

## 4. Decisions (signed off 2026-06-06)

1. **Host build change blast radius — DECIDED: full externalise (Option A,
   Phase 1.3).** Externalise React/RQ/UI/frontend-api from the host's own
   bundle so host + plugins share one instance via the import map. **Must be
   re-tested afterwards** — externalising the shared set changes how the
   primary SPA loads; verify the host app boots and behaves identically
   (login, navigation, a data-heavy page, theme/toast/perf) before relying
   on it. No hybrid `window` shim.
2. **Version skew — DECIDED (provisional): host-wins, assume compatible.**
   The import map hands plugins the host's version unconditionally; for now
   assume versions are compatible and ship no frontend compatibility gate.
   **Flagged for review soon** — once external plugins exist in the wild,
   revisit whether a frontend compatibility gate is needed (mirror
   `core/backend/src/services/compatibility-checker.ts:85-94`).
3. **Shared-vs-bundled package list — LOCKED.**
   Host provides (plugins externalise): `react`, `react-dom`,
   `react-dom/client`, `react/jsx-runtime`, `react-router-dom`,
   `@tanstack/react-query`, `@orpc/client`, `@orpc/tanstack-query`,
   `@checkstack/frontend-api`, `@checkstack/ui`, `@checkstack/common`,
   `lucide-react`. Everything else: plugins bundle. `lucide-react` is shared
   despite being stateless (large; host-wins on icon availability is an
   accepted cosmetic risk). This is the third-party build contract — keep it
   stable.
4. **CSS/token strategy** for `@checkstack/ui` + plugin Tailwind (Phase 1.4)
   — still open; resolve during Phase 1.

---

## 5. What is already done (context)

The backend/install half is fixed and verified on
`feat/external-plugin-install-e2e` (separate from this plan): plugin-manager
access-rule ordering + admin wildcard; bundle intra-dep co-install; primary
inner-tarball; backend-only runtime load; runtime backend migrations +
scoped DB. The install-via-UI → backend-loads → core-plugins-coload path
passes E2E. This plan covers only the remaining **frontend** half.
