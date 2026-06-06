# Runtime frontend-plugin sharing contract

> **RESOLUTION (2026-06-06): DONE via Module Federation 2.0.** The hand-rolled
> import-map externalisation below hit an unsolvable rolldown CJS-interop wall
> (externalising CJS React makes transitive CJS deps call a runtime
> `__require("react")` that throws). After a spike confirmed MF 2.0
> (`@module-federation/vite` + `@module-federation/runtime`) works on our Vite 8
> stack — its share scope hands separately-built remotes the host's React /
> Router / QueryClient / framework-api, and React.lazy/Monaco splitting is
> preserved — we adopted it. The host is an MF host (no static remotes; runtime
> `registerRemotes`/`loadRemote`); `@checkstack/ui` stays bundled-per-consumer
> with its contexts unified via a registered (globalThis-keyed) context;
> `plugin-pack` builds plugins as MF remotes. The full install E2E passes
> end-to-end. The §1–§4 design notes below are retained for history; the
> implemented mechanism is MF 2.0, not the import map.

> **Status:** DONE (MF 2.0). Original draft 2026-06-06.
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

## 4b. Phase 1 kickoff findings (2026-06-06, branch `feat/frontend-plugin-sharing`)

Hands-on investigation refined the plan with correctness subtleties:

- **The current vendor build may already be subtly wrong.**
  `vite.config.vendor.ts:20-31` builds `react` and `react-dom` as separate
  lib entries with **no externalisation**, so `react-dom.js` likely bundles
  its **own** copy of `react` — a second React instance even within
  `/vendor`. This was never caught because runtime frontend plugins have
  never actually run (§1d). Phase 1 must make every vendor bundle
  **externalise the other shared specifiers** (and reference them via the
  import map) so there is exactly one instance of each.
- **Entry resolution must not hardcode bun store paths.** Under bun's
  isolated store, real entries live at
  `node_modules/.bun/<pkg>@<ver>+<hash>/...` (hash changes on updates).
  Resolve via `require.resolve`/`createRequire` at config time, not literal
  paths. Note `@tanstack/react-query` and `lucide-react` resolve to **CJS**
  entries (Vite's commonjs interop handles this, but the vendor bundle must
  emit ESM).
- **`@orpc/*` probably should NOT be separate shared entries.** Plugins
  import `@checkstack/frontend-api`, not `@orpc/*` directly (verified in the
  §1a scout: with `frontend-api` externalised, `@orpc/*` never entered the
  plugin bundle). `@orpc/client` + `@orpc/tanstack-query` are internal to
  `frontend-api` and should be **bundled into the `frontend-api` vendor
  bundle** (whose `createRouterUtils`/client instance is the shared one).
  `@orpc/tanstack-query` isn't even resolvable from `core/frontend`
  (transitive-only). → **Drop `@orpc/client` + `@orpc/tanstack-query` from
  the shared import-map list**; keep them bundled inside `frontend-api`.
  (Revises the §4.3 lock: the import-map surface is the React ecosystem +
  `@tanstack/react-query` + the three `@checkstack/*` + `lucide-react`.)
- **`@checkstack/ui` is the hard one — it carries the whole Monaco/VS Code
  stack** (`@codingame/*`, `monaco-languageclient`, `@typefox/monaco-editor-
  react`, plus recharts/radix). It is deliberately code-split so Monaco
  stays lazy (PRs #236/#253). Vendoring it as one bundle would **re-ship
  Monaco eagerly** and undo that. The `@checkstack/ui` vendor bundle must
  therefore (a) preserve code-splitting (lazy Monaco chunks), (b) carry the
  Monaco worker setup + `vscode` alias (`monacoViteConfig`), and (c) emit
  its CSS for the host to serve. This is the bulk of Phase 1's risk and
  effort. **Open fork — see below.**

### RESOLVED by industry research (2026-06-06)

Researched how host↔plugin module sharing is normally done (Module
Federation; native import maps / single-spa / Native Federation). Findings:

- **Two mainstream patterns, and in BOTH the shared singletons are
  externalised from EVERYONE — including the host — and loaded once via a
  loader/import map.** Nobody re-exports the host's in-bundle copy through a
  shim. **→ Option A2 (host-facade) is dropped: it is non-standard, has no
  prior art, and the export-drift shim is a long-term liability.**
- **Chosen mechanism: native import maps (Option A1 family).** Externalise
  the shared set from the host's own bundle too (this is the *standard*
  practice, not exotic) and resolve via the browser import map to one copy.
  Plugin-author contract is simply "externalise this known list" — friendlier
  for third parties than Module Federation, which would force authors onto
  the `vite-plugin-federation` toolchain.
- **Standard guidance: share the MINIMAL singleton set, bundle the rest**
  (per-plugin duplication of stateless libs is fine and avoids version
  coupling). The "bundle the rest" advice targets *third-party,
  independently-versioned* libs — it does NOT really apply to our
  *first-party, version-locked* `@checkstack/*` packages.

**Final shared (import-map) surface — LOCKED, revises §4.3:**
`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`,
`react-router-dom`, `@tanstack/react-query`, `@checkstack/frontend-api`,
`@checkstack/ui`. **Bundled per-plugin (removed from shared):**
`lucide-react` (tree-shaken to the few icons used — cheap), `@checkstack/
common` (stateless utils/types — safe to duplicate), `@orpc/*` (internal to
`frontend-api`, bundled inside its vendor bundle), and anything else a
plugin adds.

**`@checkstack/ui` sub-decision — share WHOLE (was leaning split).** On
deeper analysis, splitting `@checkstack/ui` into a shared context entry vs
bundled components creates a fragile invariant (every component using a
context hook must import it from the shared subpath, or plugins silently get
the wrong context). Because `@checkstack/ui` is *first-party and
version-locked to the host* (host-wins is already accepted, §4.2), sharing
it WHOLE as one singleton vendor bundle is simpler and removes that
fragility. The only cost — Monaco in the vendor bundle — is handled by a
**code-split-preserving** vendor build (Monaco stays in lazy chunks, as
today). Worker setup + `vscode` alias come from `monacoViteConfig`; the
bundle emits its CSS for the host to serve.

### (superseded) Fork that was to be confirmed before touching the host build

How to vendor `@checkstack/ui` (and the other `@checkstack/*` source
packages, which have no prebuilt `dist` in-repo):

- **Option A1 (recommended): per-package vendor bundles with code-splitting
  preserved.** Build `@checkstack/ui` → `/vendor/checkstack-ui.js` (+ lazy
  Monaco chunks + css), externalising react/react-query/etc.; host
  externalises `@checkstack/ui` too. Preserves lazy Monaco and shares one
  instance. Most work, cleanest result.
- **Option A2: host-exposed module facade.** Keep the host bundling
  `@checkstack/ui` (with its existing splitting) and expose its module via a
  tiny host-served shim the import map points at (`/vendor/checkstack-ui.js`
  re-exports `window.__checkstackShared["@checkstack/ui"]`, populated by the
  host at boot). Avoids re-building Monaco machinery in a vendor pass and
  avoids touching the host's `@checkstack/ui` bundling; the import map still
  gives plugins the host's instance. Less standard, but far less risk to the
  carefully-tuned Monaco lazy-loading.

`react` / `react-dom` / `react-router-dom` / `@tanstack/react-query` /
`react/jsx-runtime` / `lucide-react` are mechanical either way (true vendor
bundles, cross-externalised). The fork is only about the heavy
`@checkstack/*` source packages.

## 4c. Phase 1 implementation progress (2026-06-06, branch `feat/frontend-plugin-sharing`)

**Vendor build (`core/frontend/vite.config.vendor.ts`) — DONE & verified for
the React ecosystem + frontend-api.** Key correctness learnings (these are
load-bearing — do not regress):

- **Never mark the React-cluster `external` in the vendor build.** React 18 is
  CJS; rolldown turns an externalised `require("react")` into a runtime
  `__require("react")` that THROWS in the browser (import maps rewrite ESM
  `import`s only). Instead build all React packages together with **no
  externals** so rolldown emits ONE shared `react-*` chunk that every entry
  (`react.js`, `react-dom.js`, `react-router-dom.js`, `react-query.js`,
  `frontend-api.js`, later `checkstack-ui.js`) imports as real ESM. Verified:
  a single `react-*` core chunk shared by all; zero throwing `__require`.
- **A package that is BOTH an entry AND an internal dep of another entry must
  be forced into a shared chunk via `output.manualChunks`** — otherwise
  rolldown leaves it inline in its own entry and re-bundles a SECOND copy into
  the other entry. Hit this with `@tanstack/react-query` (was duplicated into
  `frontend-api`). Fixed with `manualChunks: id.includes("/@tanstack/") ->
  "tanstack-query"`. Verified: `QueryClient` class defined in exactly one
  chunk; both `react-query.js` and `frontend-api.js` import it.
- Entries resolved via `createRequire(import.meta.url).resolve(...)` (never
  hardcoded bun-store paths).

**Update (2026-06-06, later): `@checkstack/ui` decision changed — NOT shared.**
Building `@checkstack/ui` as a vendor bundle made a ~2 MB EAGER entry (a lib
entry exports its whole public API, so it can't be tree-shaken), regressing
the optimised login path. Industry norm ("eager-load only true singletons;
bundle the rest") + the `@indeedeng/react-singleton-context` pattern give the
right answer: **`@checkstack/ui` is bundled per consumer (tree-shaken); its
three React contexts (Theme/Toast/Performance) use a registered, globalThis-
keyed context** so they stay single-instance across the bundled copies.
DONE & tested: `core/ui/src/utils/registered-context.ts` (+ test) and the
three providers converted. Shared set shrank to React-ecosystem +
@tanstack/react-query + @checkstack/frontend-api.

**Vendor build correctness (DONE & verified).** Three more latent issues
fixed, all confirmed in the emitted bundles:
- **Named exports for CJS packages.** `export *` (and lib-mode auto-facades)
  emit DEFAULT-ONLY for CJS React 18 — `import { useState } from "react"` was
  `undefined`. Fix: explicit ESM wrapper entries (`core/frontend/vendor-
  entries/*.ts`). React/react-dom/jsx-runtime (CJS) destructure their named
  API off the default object; react-router-dom / @tanstack/react-query /
  frontend-api (ESM) `export *`. Verified `react.js` exports `useState` +
  `default`, `react-query.js` exports `useQuery`, etc.
- **`process is not defined`.** The lib build did not replace
  `process.env.NODE_ENV` in the bundled CJS, so React referenced `process` in
  the browser. Fixed with `define: { "process.env.NODE_ENV": '"production"' }`.
- **Single instances.** `manualChunks` pins react/react-dom/scheduler →
  `react-core` and @tanstack → `tanstack-query`; every entry imports those
  shared chunks (verified one react-core chunk; QueryClient defined once).

**REMAINING BLOCKER — host externalisation triggers a CJS `require("react")`.**
Adding the shared set to `build.rollupOptions.external` in
`core/frontend/vite.config.ts` makes the host load `/vendor/*` (verified: host
entry emits bare `import … from "react"`, React no longer in `/assets`). BUT
the host then throws at load: **"Calling `require` for \"react\" in an
environment that doesn't expose `require`"** — a CJS dependency bundled into
the host does `require("react")`, and once `react` is external rolldown leaves
it as the throwing `__require("react")` shim instead of converting it to an
ESM import. (This step is reverted on the branch so the host build/runtime is
sound.) Next debug step: capture the browser stack (a transient Postgres
connect-timeout flake blocked the last attempt) to identify the offending CJS
dep, then either make rolldown's commonjs transform convert that `require` to
an external ESM import, pre-convert the dep, or provide a `require` shim that
delegates to the import-mapped modules.

**BLOCKER INVESTIGATION RESULT (2026-06-06): host externalisation is blocked
by rolldown-vite CJS interop — two fixes attempted, both failed.**
Root cause: with React external, rolldown emits a runtime `__require("react")`
for any bundled CJS dep that does `require("react")`. In the host that dep is
`use-sync-external-store` (pulled transitively by `recharts` via
`@checkstack/ui`), and it evaluates EAGERLY at the very start of load.
- **rolldown `esmExternalRequirePlugin`** (the documented fix): no effect via
  rolldown-vite, in either `build.rollupOptions.plugins` or the top-level Vite
  `plugins` array (identical output hash → not applied). Reverted; `rolldown`
  dep removed.
- **Global `require` shim** (`src/require-shim.ts`, imported first in the
  entry): the `use-sync-external-store` `require("react")` fires BEFORE the
  shim body runs — its `__SHIM_MARK` log never appears before the error.
  rolldown's chunk-evaluation order can't be controlled enough to guarantee
  the shim installs before such an early-evaluating CJS dep. Reverted.
This is a fundamental rolldown-vite limitation for the hand-rolled import-map
approach, and it will recur for ANY CJS dep (host or plugin) that requires an
externalised package — not just recharts. **Strategic options:** (a) adopt
`vite-plugin-federation` (Module Federation handles shared-dep CJS interop +
singleton negotiation internally, at the cost of plugin authors using the MF
plugin); (b) a build pre-pass that converts all CJS deps to ESM before
externalisation; (c) eliminate the CJS culprits (fragile, whack-a-mole).
Awaiting a decision before proceeding. The vendor build + registered UI
contexts (committed) are sound and independent of this decision.

**Still TODO in Phase 1 (after the blocker is resolved):**
- Add `@checkstack/ui` to the vendor build (the heavy one — Monaco). Needs
  `monacoViteConfig` (worker format + `vscode` alias), code-splitting
  preserved so Monaco stays lazy, and CSS emitted/served. Will likely need a
  `manualChunks` entry for `@checkstack/ui` too (entry + dep of nothing here,
  but its own internal deps must not duplicate the shared react/query/api).
- Expand the import map in `core/frontend/index.html`: add `react/jsx-runtime`
  -> `/vendor/react-jsx-runtime.js`, `@tanstack/react-query` ->
  `/vendor/react-query.js`, `@checkstack/frontend-api` ->
  `/vendor/frontend-api.js`, `@checkstack/ui` -> `/vendor/checkstack-ui.js`.
- Externalise the shared set in the HOST build (`core/frontend/vite.config.ts`)
  so host + plugins share the same `/vendor/*` instance. **Risky step — full
  host build + boot re-test required (decision §4.1).**
- `plugin-pack` frontend build (externalise the shared set; bundle the rest)
  + scaffold ships `dist`.
- Re-enable the E2E frontend assertions.

## 5. What is already done (context)

The backend/install half is fixed and verified on
`feat/external-plugin-install-e2e` (separate from this plan): plugin-manager
access-rule ordering + admin wildcard; bundle intra-dep co-install; primary
inner-tarball; backend-only runtime load; runtime backend migrations +
scoped DB. The install-via-UI → backend-loads → core-plugins-coload path
passes E2E. This plan covers only the remaining **frontend** half.
