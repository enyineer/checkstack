# @checkstack/secrets-frontend

## 0.4.0

### Minor Changes

- 56e5375: Migrate the frontend from react-router-dom v7 to react-router v8

  Resolves GHSA-qwww-vcr4-c8h2 (HIGH): React Router before 8.3.0 has an RSC-mode
  CSRF bypass that lets an action execute before the 400 response. Checkstack runs
  a client-side SPA (`<BrowserRouter>`) and does not use RSC mode, so the platform
  was not exploitable through it - but the advisory kept the dependency-graph
  security gate red on every pull request, and the fix is only available in the 8.x
  line, which the auto-remediation deliberately will not reach (it refuses major
  bumps).

  `react-router-dom` has no v8: it was folded into `react-router` in v7 and v8
  ships as `react-router` only. So this is a package swap rather than a range bump:

  - 31 packages now depend on `react-router@^8.3.0` instead of
    `react-router-dom@^7.16.0`, and 97 source files import from `react-router`.
  - The Module Federation host share, `optimizeDeps` and `dedupe` entries move to
    `react-router` (shared singleton `requiredVersion` `^8.0.0`). Remotes never
    shared the router, so the remote contract is unchanged.
  - The syncpack unified-range group tracks `react-router`, keeping the enforced
    single-range guarantee that a past four-range regression motivated.

  The API surface Checkstack uses is unchanged between v7 and v8 - `BrowserRouter`,
  `MemoryRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useLocation`,
  `useNavigate`, `useParams` and `useSearchParams` are all exported by v8 with the
  same signatures - so no routing code changed beyond the import specifier. v8
  requires React >= 19.2.7, which the workspace already pins.

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
  - @checkstack/common@0.24.0
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/secrets-common@0.3.4

## 0.3.17

### Patch Changes

- be74b01: Source every status tone from the one shared table

  Nineteen plugin modules each re-declared the tone-to-class table verbatim
  (`pill: "bg-status-ok/10 text-status-ok"`, `dot: "bg-status-ok"`, ...), some
  reproducing every field of the shared one. They now take those classes from
  `pillToneStyles` in `@checkstack/ui` while keeping their own domain mapping -
  which value means which tone - since that is real domain knowledge and is unit
  tested. A repo-wide search for a hand-written triad row now returns only the
  shared table.

  Several hand-rolled pills went with them, onto the shared `StatusPill`: the
  automation run pill, the satellite status badge, the notification channel pill,
  the SLO objective pill and both AI tool-card pills.

  Four rows are deliberately still local, each with a comment saying why, because
  they are NOT the shared tone despite looking like it:

  - The dashboard's `info` uses the `--info` token, a different hue from
    `--status-info` (light: `217 91% 60%` vs `214 90% 45%`).
  - Integrations' and notifications' `unknown`/`neutral` use the muted treatment -
    the ABSENCE of a tone - not the shared grey.
  - The queue's "processing" uses opacity-softened muted classes that match
    neither the shared table nor the pill's neutral.

  One genuine class divergence was found and NOT normalised: the system incident
  panel draws its borders at `/30` where the shared table uses `/20`. It is now a
  single documented map instead of a full private table.

  Pills whose geometry has no shared equivalent (the dependency canvas node with
  its animated halo, the incident panel's compact chips, the dashboard's
  non-triad signal tone) keep their markup and now only share the classes.

- Updated dependencies [be74b01]
- Updated dependencies [be5c907]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ui@1.30.0
  - @checkstack/frontend-api@0.17.0

## 0.3.16

### Patch Changes

- 6c8b36b: Edit forms stay stable while you are typing. Previously, editing a system's
  description (and many other edit dialogs/settings pages) would reset the field
  mid-edit whenever a webhook update or realtime signal refetched the underlying
  query: the form re-seeded its local state from the fresh query result on every
  refetch. Forms now seed their local state ONCE - on the dialog's open
  transition, or once per record via a stable key - and ignore background
  refetches while you are editing.

  New shared primitive `useSeedFormOnOpen(open, onInit)` in `@checkstack/ui`
  (alongside the existing `useInitOnceForKey`) seeds a dialog form once per
  open transition, StrictMode-safe. Fixed surfaces include the catalog
  system/environment/group editors, the healthcheck platform-defaults dialog,
  the SLO / gitops-provider / telemetry-source / satellite / announcement /
  role edit dialogs, and the cache / queue / notification / secrets / anomaly /
  profile / strategies settings pages (query-seeded pages also drop their loader
  cache via `gcTime: 0` so a warm cache cannot race the one-shot seed).

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/ui@1.29.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/secrets-common@0.3.3

## 0.3.15

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/secrets-common@0.3.2

## 0.3.14

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1

## 0.3.13

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/common@0.22.0
  - @checkstack/secrets-common@0.3.2

## 0.3.12

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0

## 0.3.11

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2

## 0.3.10

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1

## 0.3.9

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/ui@1.25.1
  - @checkstack/secrets-common@0.3.2

## 0.3.8

### Patch Changes

- Updated dependencies [b218e3e]
  - @checkstack/ui@1.25.0

## 0.3.7

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/frontend-api@0.13.2
  - @checkstack/secrets-common@0.3.1

## 0.3.6

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/frontend-api@0.13.1

## 0.3.5

### Patch Changes

- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/secrets-common@0.2.8

## 0.3.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0

## 0.3.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/frontend-api@0.12.1
  - @checkstack/secrets-common@0.2.7

## 0.3.2

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/secrets-common@0.2.6
  - @checkstack/common@0.17.0

## 0.3.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0

## 0.3.0

### Minor Changes

- 8cad340: Improve sidebar navigation and information architecture:

  - Split the overloaded "Configuration" group into focused sections: "Settings"
    (Auth Settings, Teams, Secrets, Notification Settings), "Platform" (Plugins,
    GitOps, Integrations, Infrastructure), and "Developer" (Script Packages,
    Script Sandbox).
  - Unify nav active-state on a single shared `isNavRouteActive` helper so the
    sidebar rail and the shared `NavItem` both prefix-match section roots
    (child/detail routes now highlight the parent entry consistently).
  - Mark the external Docs entry with an external-link icon so it is clear which
    entries leave the app.
  - Add an "Expand all" affordance to recover from a fully-collapsed sidebar.
  - Flatten single-entry groups (e.g. Automation) into top-level items, skipping
    the redundant group header.
  - Add an in-drawer search entry to the mobile navigation (opens the Cmd+K
    palette) and auto-expand the group containing the active route when the
    drawer opens.

### Patch Changes

- 8cad340: Design-system rework: a premium, consistent UI language across the platform.

  Foundation (`@checkstack/ui` + the shared Tailwind preset):

  - A token system wired into the shared preset so it generates app-wide: a
    surface elevation ramp (`surface` / `surface-2` / `surface-inset`), the
    aurora gradient stops, a colorblind-safe `status` triad, and `grid-line`.
  - A density model (`comfortable` / `compact`) via `--d-*` vars + `DensityProvider`
    / `useDensity`, with a user-menu density toggle, plus the polished
    skeleton / empty / error state set.
  - Honest, token-driven chart primitives (`TimeSeriesChart`, `Sparkline`,
    `RadialGauge` / aurora hero, `RequestWaterfall`, `UptimeRibbon`).
  - A signature aurora moment per page: `PageHeader` paints its icon strokes with
    the aurora gradient and adds a hairline; `Card` gains soft layered depth.

  Shell + surfaces:

  - The app shell adopts the elevation ramp (header `surface-2`, sidebar
    `surface`, content on the ambient base).
  - The system-health dashboard, health-check latency / single-run views, and the
    SLO dashboard are reskinned onto the primitives (aurora confidence gauge,
    honest p50/p95 latency, request waterfall, number-led status cards).

  App-wide adoption + premium rework:

  - Every plugin frontend adopts the tokens, status triad, density, and elevation.
  - The highest-impact surfaces in each plugin are then redesigned to a premium
    bar: real depth, number-led hierarchy, multi-encoded status (pill + dot +
    accent stripe), and refined list/table density. Several plugins extract pure
    tone/label/format logic into unit-tested modules.

  Alerts:

  - Every alert/callout is unified onto a single premium `Alert` (depth surface +
    status-accent stripe + toned icon chip, variant-driven).

  BREAKING CHANGE: the duplicate `InfoBanner` component (and its sub-components)
  is removed; use `Alert` instead - it is a drop-in replacement with the same
  variants and composable parts.

- 8cad340: Cross-cutting UX consistency sweep for GitOps, Secrets, and Notification frontends.

  Formatting: inline date and relative-time formatting now routes through the
  shared `@checkstack/ui` helpers so timestamps agree across the app. GitOps
  secret and provider lists use `formatDateTime`; the notification collapsed-group
  timeline and notifications page use `formatRelativeTime` (replacing a bespoke
  `Intl.RelativeTimeFormat` engine and hand-rolled "5m ago" math).

  Semantic colors: success-semantic palette literals now use design tokens. The
  secrets backend test-connection result uses `text-success` (was
  `text-emerald-600`) and the notification user-channel card active border uses
  `border-success/30` (was `border-green-500/30`). The decorative kind-registry
  icon uses `text-info` (was `text-blue-500`).

  Toasts: error- and success-bearing mutation toasts now use the canonical
  `toastError(toast, action, error)` / `toastSuccess(toast, action)` helpers for
  consistent voice and 100-char truncation across GitOps provenance actions and
  the notification subscription, settings, and notifications surfaces.

  No behavior change beyond formatting/voice and theme-token correctness.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ui@1.17.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/secrets-common@0.2.5

## 0.2.8

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/ui@1.16.2

## 0.2.7

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
  - @checkstack/common@0.16.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/secrets-common@0.2.4

## 0.2.6

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0

## 0.2.5

### Patch Changes

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/secrets-common@0.2.3

## 0.2.4

### Patch Changes

- fb705df: Upgrade React 18 to React 19 across the platform.

  **BREAKING (runtime frontend plugins):** React is shared as a Module Federation
  singleton, so the host now provides **React 19** to every runtime plugin.
  Frontend plugins built against React 18 must be rebuilt against React 19
  (`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
  `requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
  to a single version across the workspace via syncpack so the singleton can never
  skew (react and react-dom must match exactly).

  The React 19 removed-API surface was audited - the codebase used only no-arg
  `useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
  legacy context, string refs, or function-component `defaultProps`. This also
  clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
  `React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

  The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
  receive only the mechanical `react` dependency bump (`patch`); the framework
  packages carrying the shared-singleton change are bumped `minor`.

- Updated dependencies [9d8961c]
- Updated dependencies [fb705df]
  - @checkstack/ui@1.15.0
  - @checkstack/frontend-api@0.8.0
  - @checkstack/common@0.14.1
  - @checkstack/secrets-common@0.2.2

## 0.2.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/secrets-common@0.2.2

## 0.2.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/secrets-common@0.2.2
  - @checkstack/ui@1.13.2

## 0.2.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/frontend-api@0.7.1
  - @checkstack/secrets-common@0.2.1
  - @checkstack/ui@1.13.1

## 0.2.0

### Minor Changes

- 9dcc848: Cut initial-load JS: lazy plugin contributions, a hardened lazy-by-default contribution contract, on-demand Monaco, and a lighter icon/chart load.

  - Lazy plugin route pages: each plugin's route `element` references a `React.lazy`-wrapped page rendered inside a shared `<Suspense>` boundary. Plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are available on first paint. This moves ~37 route-page chunks (~600 KB) out of the entry; the entry chunk drops from ~2.4 MB to ~190 KB. Auth flow pages stay eager. The `@checkstack/scripts` scaffold template generates lazy route pages too.
  - Hardened contribution contract (BREAKING, frontend plugin contract): plugins declare contributions lazily and let the framework own code-splitting, Suspense, and per-plugin error isolation. Routes use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />` (`element` is still accepted for the rare page that must paint without a chunk fetch; provide exactly one). Slot extensions accept either an eager `component` or a lazy `load`; new `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind. This also fixes runtime-installed plugins: `ExtensionSlot` subscribes to the plugin registry, and the API registry rebuilds when the plugin set changes (`getPlugins()` returns an immutable snapshot via `useSyncExternalStore`). A per-plugin error boundary contains a bad contribution.
  - On-demand Monaco: the `@checkstack/ui` barrel no longer pulls the `@codingame/*` / `monaco-languageclient` stack into the initial load. `CodeEditor` lazy-loads its Monaco-backed editor behind `React.lazy` + Suspense, `validateTypeScriptSources` imports the editor API via in-body `await import(...)`, and the "vscode services ready" signal moved to a Monaco-free module. The ~10 MB editor body loads only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was added for stable vendor caching.
  - lucide-react 1.x + lighter icons/charts (BREAKING for icon consumers): lucide-react unified from three drifting ranges to `^1.17.0`. lucide v1 removed brand icons, so the GitHub/GitLab marks are vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`); a new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is canonical, accepted by `AuthStrategy.icon` and the card components, so data-driven brand names keep working. `DynamicIcon` no longer eagerly imports lucide's ~1600-icon map (~1 MB) - it lives in a `React.lazy` `iconRegistry` chunk fetched on first data-driven render, while statically named-imported icons tree-shake normally. The recharts-backed health-check charts (~300 KB) and the `HealthCheckSystemOverview` drawer leave the initial load.

  BREAKING CHANGES:

  - Frontend plugin contract: routes/slot contributions are lazy-by-default (`load` instead of `element`/eager elements) as described above.
  - Any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/secrets-common@0.2.0

## 0.1.0

### Minor Changes

- 270ef29: Add the Secrets platform (Phase 1): a central, plugin-agnostic secret manager with a pluggable backend extension point, a cross-plugin resolver service, and a universal Jenkins-style masking layer.

  - New packages: `secrets-common` (schemas, contract, `secrets.read`/`secrets.manage`, masking utils), `secrets-backend` (`SecretBackend` extension point, `secretResolverRef`/`secretAdminRef` services, run-scoped masking context, RPC router), `secrets-backend-local` (default AES-256-GCM backend, owns the `secrets` table promoted from gitops), `secrets-frontend` (admin Settings page).
  - Resolution machinery (`resolveSecretsBySchema`, `SecretStore`, `${{ secrets.NAME }}` / `x-secret`) is promoted out of `gitops-backend` into `secrets-backend`. GitOps now resolves and manages secrets through the platform's service refs (single source of truth); its secret table is migrated without loss.
  - Universal masking seam wired at the central script-output boundaries: automation `run_script` / `run_shell` artifacts and the in-UI test panel redact run-scoped secret values from `result`/`stdout`/`stderr`/`error` before persist/return. Phase 1 resolves no run-scoped secrets yet, so masking is a no-op until Phase 2; the seam guarantees the boundary exists.
  - No endpoint returns a secret value to a browser: DTOs expose only name/metadata/`hasValue`.

  BREAKING CHANGES: `gitops-backend` now depends on `secrets-backend` and resolves/manages secrets through it. The `secrets` table is owned by `secrets-backend-local`; the gitops `secrets` table is retained as a migration source but is no longer the source of truth.

- 270ef29: Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

  - Script consumers declare a least-privilege `secretEnv` allowlist
    (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
    `run_shell` actions resolve ONLY the declared secrets via
    `secretResolverRef.resolveForRun`, inject them into the runner env for
    that run (memory-only; the ESM runner gained a per-run `env` option), and
    mask their values out of stdout/stderr/result/error via the run-scoped
    masking context. A missing required secret fails the run clearly. No
    ambient secret access.
  - Test panel: `testScript` / `testCollectorScript` inject named
    `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
    overrides; real production values are never resolved in the test path,
    and overrides are masked out of the result.
  - Healthcheck collectors carry the `secretEnv` field for authoring +
    the test panel; runtime injection on satellites lands in Phase 3.
  - Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
    record fields with `${{ secrets.* }}` name autocomplete (from
    `listSecretNames`), wired into the automation action editor and the
    healthcheck collector editor. New `withConfigMeta` helper +
    `x-secret-env` config-meta key in `@checkstack/backend-api`.

- 270ef29: Secrets platform Phase 4: HashiCorp Vault backend + backend selection.

  - New `@checkstack/secrets-backend-vault`: a read-through `SecretBackend`
    against Vault. Token, AppRole, and OIDC/JWT auth (session cached to the
    lease TTL, capped); KV v2 reads mapped via the backend's own
    `secret_index` table (name → path/key); read-through value cache with a
    capped TTL (rotated values re-read). `list()` returns metadata only,
    never values. Minimal typed HTTP client (no extra dependency), injectable
    fetch for testing.
  - Backend selection: the active backend is persisted via `ConfigService`
    and switchable in Settings → Secrets; switching re-routes resolution.
    New `setBackendConfig` / `testBackend` RPCs (manage-gated, status-only)
    and `getBackendConfig` now returns Vault connection metadata
    (`hasCredential`, never the credential). `SecretBackend` gains optional
    `test` / `configure` / `getConfigMeta`.
  - The Vault auth credential is stored as an `x-secret` config field
    (encrypted at rest with the AES-GCM master key, redacted on read) —
    bootstrapping it WITHOUT putting it in Vault. It is write-only over the
    API and never logged.
  - Admin UI: backend selector + Vault connection form + "Test connection".

  Satellite-direct-Vault (a satellite reading Vault itself) is deferred to a
  follow-up; core-mediated delivery already routes through the Vault backend.

- b995afb: Hide secret write controls when the active backend is read-through.

  When a read-through backend (e.g. Vault) was active, the Secrets admin page still showed the "Add a secret", Rotate, and Delete controls even though the backend correctly rejects writes (`set` / `delete` are intentionally unimplemented), so every attempt errored.

  The active backend now reports a capability flag and the UI gates its write affordances on it instead of any hardcoded backend id, so other read-through backends are handled the same way.

  Changes:

  - `@checkstack/secrets-common`: add a `writable: boolean` field to `BackendConfigDto` (returned by `getBackendConfig`). It carries no sensitive data - a capability boolean only.
  - `@checkstack/secrets-backend`: populate `writable` in the `getBackendConfig` handler by inspecting the resolved active backend (true only when it implements both `set` and `delete`; `false` for read-through backends or an unresolved active id). Exposes a small `isBackendWritable` helper.
  - `@checkstack/secrets-frontend`: hide the create form, per-row Rotate / Delete buttons, and adjust the empty-state and helper text when the active backend is not writable, plus show a short "read-through" explainer. The local backend stays fully writable.

  State & scale: `writable` is derived on read from the resolved active backend's capabilities (durable config selects the backend), so every pod computes the same answer; no new state is introduced.

### Patch Changes

- b995afb: Tidy the user menu: move "Script packages" and "Secrets" into the **Configuration** group (the now-empty **Administration** group is gone), and display the user-menu groups in alphabetical order instead of a hardcoded canonical order.
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0
  - @checkstack/secrets-common@0.1.0
