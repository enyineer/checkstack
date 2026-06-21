# @checkstack/dependency-frontend

## 0.6.0

### Minor Changes

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

### Patch Changes

- 8cad340: Improve form quality and accessibility of the dependency editor.

  The "Depends on (upstream)" system picker and the impact-type select are now
  associated with proper `<Label htmlFor>`/`id` pairings, so clicking a label
  focuses its control and assistive tech announces the field name. Both mandatory
  fields carry the `required` affordance (visible `*` plus screen-reader
  "(required)"). Opening the add-dependency panel now autofocuses the system
  picker so keyboard users can start selecting immediately. No behavioral change
  beyond focus, labeling, and the required marker.

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

- 8cad340: Make the dependency map overlay panels responsive on small screens. The edge
  editor and legend panels now cap their width to the viewport
  (`w-[calc(100vw-2rem)] sm:w-72` / `max-w-[calc(100vw-2rem)] sm:max-w-64`) and the
  top-right action buttons wrap instead of overflowing, so the chrome no longer
  covers the canvas on phones. No behavior change on desktop.
- 8cad340: Adopt the canonical `toastError` helper from `@checkstack/ui` for error toasts.

  Error toasts that previously called `toast.error(extractErrorMessage(error, "Failed to X"))`
  (or interpolated `Failed to X: ${extractErrorMessage(error)}` strings) now use
  `toastError(toast, "Failed to X", error)`. This centralizes the
  "Failed to <action>: <message>" voice and applies the shared 100-character
  truncation. Error toasts that did not previously prefix the action now gain the
  canonical prefix; success toasts and terse validation one-liners are unchanged.

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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ui@1.17.0
  - @checkstack/dashboard-frontend@0.9.0
  - @checkstack/gitops-frontend@0.6.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/dependency-common@1.4.2
  - @checkstack/gitops-common@0.6.5
  - @checkstack/signal-frontend@0.2.6

## 0.5.12

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1
  - @checkstack/dashboard-frontend@0.8.11
  - @checkstack/dependency-common@1.4.1
  - @checkstack/gitops-frontend@0.5.9
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/ui@1.16.2

## 0.5.11

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/dependency-common@1.4.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/dashboard-frontend@0.8.10
  - @checkstack/gitops-common@0.6.4
  - @checkstack/gitops-frontend@0.5.8
  - @checkstack/signal-frontend@0.2.5

## 0.5.10

### Patch Changes

- @checkstack/dashboard-frontend@0.8.9

## 0.5.9

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/dashboard-frontend@0.8.8
  - @checkstack/gitops-frontend@0.5.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/dependency-common@1.3.2
  - @checkstack/healthcheck-common@1.6.2

## 0.5.8

### Patch Changes

- @checkstack/catalog-common@2.3.5
- @checkstack/dashboard-frontend@0.8.7
- @checkstack/dependency-common@1.3.1
- @checkstack/healthcheck-common@1.6.1
- @checkstack/gitops-frontend@0.5.6

## 0.5.7

### Patch Changes

- 0b6f01b: feat(dependency): contribute dependency warnings to the backend system.issues aggregator

  The dependency plugin now registers a `system.issues` contributor (sourceId
  `dependency`) from its backend `init`, so the AI assistant surfaces upstream
  dependency problems alongside incidents, SLOs, health checks, and anomalies.

  The contributor enforces its own `dependency.read` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users are
  trusted), then evaluates dependency warnings for every system that participates
  in a dependency edge by reading the shared, durable `dependencies` table. The
  answer is therefore identical on every pod. Only systems with an actual warning
  appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveDependencySignals` deriver in
  `@checkstack/dependency-common`, shared by both the backend contributor and the
  frontend `DependencySignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/dependency-common@1.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/dashboard-frontend@0.8.6

## 0.5.6

### Patch Changes

- f9cfdae: fix(dependency): gate the dependency map behind its own non-public access rule

  Anonymous users could see the "Dependency Map" nav entry and open the page
  (which then rendered empty) because the map was gated by `dependency.read`,
  which is public so that dependency _warning_ badges stay visible on the
  catalog and dashboard.

  The full topology map is now gated by a dedicated `dependency.map` access
  rule that is granted to authenticated users by default but is NOT public, so
  anonymous visitors no longer see the nav entry or reach the page. The
  `getAllDependencies`, `getNodePositions`, and `saveNodePositions` endpoints
  move to this rule too, and the dashboard dependency signal now renders as
  plain text (not a map link) for users without map access. Per-system
  dependency warnings stay on the public `dependency.read` rule, so warning
  badges/alerts/signals remain visible to everyone as before.

  Admins can still grant `dependency.map` to the anonymous role to make the
  map public again.

  Note: the default-rule sync is add-only, so on existing deployments the
  anonymous role keeps any rules already granted. Since `dependency.map` is a
  brand-new rule the anonymous role never had it, so the map is hidden from
  anonymous users immediately after upgrade with no admin action required.

- Updated dependencies [f9cfdae]
  - @checkstack/dependency-common@1.2.5

## 0.5.5

### Patch Changes

- 56e7c75: Hide navigation, actions and links that the current user cannot use, so anonymous
  and read-only users no longer see entries that lead to "Access Denied" or to
  actions the server would reject.

  - **Sidebar**: a nav entry can now declare a dynamic `nav.isVisible({ accessRules, isAuthenticated })` predicate (in addition to the static `accessRule`). A group whose every entry is filtered out is no longer rendered. The filtering/grouping logic is extracted to a pure, unit-tested helper.
  - **Infrastructure**: its sidebar entry is shown only when the user can READ at least one contributed tab (queue, cache, …), instead of always (it previously had no static rule because tabs are contributed at runtime).
  - **Notification Settings**: hidden from anonymous users - notifications are per-user, so an anonymous visitor can't have any.
  - **Anomaly Mute / Suppress**: the "Mute" / "Mute all" controls (a per-user preference) are hidden from anonymous visitors; the "Suppress" control is gated on `anomalyAccess.feed.manage`. Both were previously always visible.
  - **Dashboard**: the "Open Catalog" actions (which open the manage-only Catalog config page) are hidden from users without `catalogAccess.system.manage`, and the "View catalog" link is gated on `catalogAccess.system.read`.
  - **Dashboard status signals**: the per-system status rows contributed by plugins (`SystemSignalsSlot`) now render as a LINK only when the user can open the target, and as plain text otherwise. `SystemSignal` gains an optional `accessRule`; the healthcheck, anomaly, and dependency fillers set it for their gated targets (check-history / assignments / dependency-map). Signals pointing at ungated pages (incident / maintenance / SLO detail) stay links.
  - **Plugin Manager**: the "Install plugin" button (which opens the install-gated page) is hidden from users with only `plugin` view access.
  - **Satellites**: the page is entirely manage-gated, but its route/sidebar entry was gated on `read`, so read-only users saw the nav item and hit "Access Denied" on click. The route and nav entry now require `satellite.manage`.

  The `@checkstack/ai-backend` bump is only the regenerated bundled docs index
  (the frontend routing guide gained the `nav.isVisible` section); no code change.

  **BREAKING (`@checkstack/frontend-api`):** the `AccessApi` interface gains a
  required `useIsAuthenticated()` method. Custom `AccessApi` implementations must
  add it (it returns `{ loading, isAuthenticated }`). The built-in auth
  implementation and the no-auth fallback already do. `NavEntry` also gains an
  optional `isVisible` predicate (purely additive).

- Updated dependencies [460ffd6]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/dashboard-frontend@0.8.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/dependency-common@1.2.4
  - @checkstack/gitops-common@0.6.3
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/gitops-frontend@0.5.5
  - @checkstack/signal-frontend@0.2.4

## 0.5.4

### Patch Changes

- 50123c7: Fix the dependency map page's scrolling and make its header consistent with the
  rest of the app. The page sized its canvas with a fixed `calc(100vh - 12rem)`,
  which could overshoot the available space (double-scroll) depending on viewport
  chrome, and it used a bespoke `<h1>` header with no icon. It now renders through
  `PageLayout` (with the `GitBranch` nav icon and `fillHeight`), so the React Flow
  canvas fills the app shell's bounded flex content area and only it scrolls/pans -
  the page itself never scrolls.
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
  - @checkstack/dashboard-frontend@0.8.4
  - @checkstack/gitops-frontend@0.5.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/dependency-common@1.2.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.3

## 0.5.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/dashboard-frontend@0.8.3
  - @checkstack/gitops-frontend@0.5.3
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/dependency-common@1.2.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/dashboard-frontend@0.8.2
  - @checkstack/dependency-common@1.2.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/gitops-frontend@0.5.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/catalog-common@2.3.1
  - @checkstack/dashboard-frontend@0.8.1
  - @checkstack/dependency-common@1.2.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/gitops-frontend@0.5.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.5.0

### Minor Changes

- 9dcc848: Redesign the dashboard as an extensible "needs attention" overview, and normalize system state badges.

  The dashboard now surfaces ONLY systems that need attention (degraded, unhealthy, breaching/at-risk SLO, under an incident or active maintenance, anomalous, or with a dependency problem) and hides everything healthy. A compact header summarises fleet health and filters by severity; each problem renders as an elevated card with one row per issue that deep-links to where the issue originates. A calm "all clear" state shows when nothing needs attention, a live "recent activity" feed sits below, and a "View catalog" link replaces the duplicated system list.

  New platform contract `SystemSignalsSlot` (`@checkstack/catalog-common`): a headless, render-once slot where any plugin bulk-fetches and reports structured `SystemSignal[]` per system via `onSignals(sourceId, map)`. The dashboard aggregates every source agnostic to which plugins contribute; each core reliability plugin (healthcheck, incident, SLO, maintenance, anomaly, dependency) ships a filler, and third-party plugins add new per-system state the same way with no dashboard change. Signals carry an `iconName` rendered via `DynamicIcon` so the contract stays React-free. The dashboard's old summary tiles and overview sheets are removed, so it no longer depends on those plugins' packages. The group "subscribe" control moved onto the catalog browse page's group headers.

  System state badges are normalized into one icon-only `@checkstack/ui` `StatusBadge` primitive - a small tinted icon chip with the full label on hover/focus (and via `aria-label`). Each signal uses its feature's navbar icon (health = Activity, incident = AlertTriangle, SLO = Target, maintenance = Wrench, dependency = GitBranch; anomaly = ChartSpline). Badges self-sort by severity via CSS `order` (error -> warn -> info), tooltips are scoped to a named group, and in catalog browse rows the cluster moved to the right edge.

  This is a beta minor.

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/dashboard-frontend@0.8.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/gitops-frontend@0.5.0
  - @checkstack/dependency-common@1.2.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/signal-frontend@0.2.0

## 0.4.8

### Patch Changes

- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0
  - @checkstack/gitops-common@0.5.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/dashboard-frontend@0.7.8
  - @checkstack/gitops-frontend@0.4.7

## 0.4.7

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
- Updated dependencies [c39ee69]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/ui@1.11.0
  - @checkstack/common@0.12.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/dashboard-frontend@0.7.7
  - @checkstack/dependency-common@1.1.3
  - @checkstack/gitops-frontend@0.4.6
  - @checkstack/gitops-common@0.4.2
  - @checkstack/signal-frontend@0.1.5

## 0.4.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/dashboard-frontend@0.7.6

## 0.4.5

### Patch Changes

- f23f3c9: Gate decorative motion and blur effects behind
  `usePerformance().isLowPower` on a focused set of high-traffic plugin
  pages (Dashboard, Dependency map, System node, Notification bell,
  Announcement banner / cards, Anomaly field overrides editor, SLO
  attribution chart, Catalog droppable group). Hover scales, backdrop
  blurs, `animate-pulse`/`animate-ping` accents, and entry transitions
  now drop to static states on low-power devices; functional UX
  transitions (Drawer/Dialog open-close, colour transitions) are left
  alone.

  Standardise the post-mutation error-toast voice on plugin pages by
  migrating multi-clause `toast.error(extractErrorMessage(error, "Failed
to X"))` call sites onto the `toastError(toast, "Failed to X", error)`
  helper from `@checkstack/ui`. The helper applies the canonical
  `"action: message"` prefix and 100-character truncation in one place,
  and the now-orphaned `extractErrorMessage` imports are dropped from
  the affected files. No business logic or component APIs changed.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/dashboard-frontend@0.7.5
  - @checkstack/gitops-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/dependency-common@1.1.2
  - @checkstack/gitops-common@0.4.1
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-frontend@0.1.4

## 0.4.4

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dashboard-frontend@0.7.4
  - @checkstack/dependency-common@1.1.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/gitops-frontend@0.4.4

## 0.4.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/dashboard-frontend@0.7.3
  - @checkstack/gitops-frontend@0.4.3

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/dashboard-frontend@0.7.2
  - @checkstack/gitops-frontend@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/dependency-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/dashboard-frontend@0.7.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/gitops-frontend@0.4.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.4.0

### Minor Changes

- f6f9a5c: Add a GitOps `System.dependencies` extension and lock the matching UI.

  Each entry references an upstream system by ref and tunes the impact:

  ```yaml
  apiVersion: checkstack.io/v1alpha1
  kind: System
  metadata: { name: payments-api }
  spec:
    dependencies:
      - targetRef: { kind: System, name: payments-db }
        impactType: critical
        transitive: false
        label: "primary store"
  ```

  The reconciler diffs the YAML-declared edges against the persisted ones
  where this system is the source and converges via
  create / update / delete. GitOps is the source of truth, so any edges
  no longer listed are removed. Refs that resolve to the source system
  itself are rejected; refs that fail to resolve abort the diff before
  any mutation.

  UI gates:

  - The `DependencyEditor` (system editor drawer) hides Add and disables
    Edit/Delete on upstream rows when the source system is GitOps-managed.
    Downstream rows are gated per-row by the _other_ system's lock.
  - The `DependencyMap` blocks `onConnect` when the source is locked,
    surfaces a "Managed by GitOps" notice in the edge editor panel, and
    disables Save/Delete there.

### Patch Changes

- 950d6ec: Fix mobile UserMenu items rendering at zero height, group menu items by
  section, and unstack cramped card headers on small viewports.

  - **UserMenu mobile bug**: On mobile, the user-menu Sheet rendered every
    menu item as a grid row, which combined with `flex-shrink: 1` on each
    item collapsed the buttons whose internal layout uses `display: flex`
    (the items registered with `useNavigate` rather than `<Link>`) to zero
    content height. Switched the mobile container to a flex column with
    `[&>*]:shrink-0` and added `min-h-0` so the sheet scrolls correctly
    when the list overflows.

  - **UserMenu grouping**: Slot extensions now accept an optional `group`
    field. The user menu buckets `UserMenuItemsSlot` extensions by `group`
    and renders each group under a labeled header (`Workspace`,
    `Reliability`, `Configuration`, `Documentation`, `Account`). Existing
    core plugins are tagged with the appropriate group; third-party plugins
    can pick any of these or supply their own label. Untagged extensions
    render last with no header. `UserMenuItemsBottomSlot` is unaffected.

  - **Card header responsiveness**: `CardHeaderRow` (the primitive shared by
    Incident, Maintenance, Auth, Catalog, GitOps and other config cards) now
    stacks vertically on narrow viewports and only switches to a single row
    at the `sm` breakpoint, so titles and adjacent filter controls (e.g.
    status `Select`, "Show resolved" checkbox) no longer cram together on
    mobile. Refactored the Incident and Maintenance config pages to use the
    primitive instead of a hand-rolled `flex items-center justify-between`
    row, and made their `Select` triggers full-width on mobile.

- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-frontend@0.4.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/dashboard-frontend@0.7.0
  - @checkstack/dependency-common@1.0.2
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.3.5

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/dashboard-frontend@0.6.1
  - @checkstack/dependency-common@1.0.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1

## 0.3.4

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/dashboard-frontend@0.6.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/ui@1.7.0

## 0.3.3

### Patch Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

- Updated dependencies [208ad71]
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/dependency-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/dashboard-frontend@0.5.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/ui@1.6.1

## 0.3.2

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/dashboard-frontend@0.5.0
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/dependency-common@0.2.3
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-frontend@0.0.16

## 0.3.1

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/dashboard-frontend@0.4.6
  - @checkstack/ui@1.5.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2

## 0.3.0

### Minor Changes

- 35463ef: Improve dependency map directional clarity

  - Redesigned system nodes with a split footer bar showing directional dependency counts (`← N used by | depends N →`), making each node self-documenting
  - Color-coded connection handles: teal for incoming ("used by") and violet for outgoing ("depends on")
  - Fixed invisible edge arrows by implementing custom SVG marker definitions with impact-type-matched colors (sky for informational, amber for degraded, red for critical)
  - Updated the legend panel to explain handle colors alongside the existing impact type guide

## 0.2.18

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/dashboard-frontend@0.4.5

## 0.2.17

### Patch Changes

- @checkstack/dashboard-frontend@0.4.4

## 0.2.16

### Patch Changes

- a7b7081: Fixed a race condition in the Dependency Map where an auto-layout calculation could permanently override saved user locations when system data loaded faster than position data.
  - @checkstack/dashboard-frontend@0.4.3
  - @checkstack/catalog-common@1.4.1

## 0.2.15

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/dashboard-frontend@0.4.2

## 0.2.14

### Patch Changes

- @checkstack/dashboard-frontend@0.4.1

## 0.2.13

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/dashboard-frontend@0.4.0
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0

## 0.2.12

### Patch Changes

- @checkstack/dashboard-frontend@0.3.35

## 0.2.11

### Patch Changes

- @checkstack/dashboard-frontend@0.3.34

## 0.2.10

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/dashboard-frontend@0.3.33

## 0.2.9

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/dashboard-frontend@0.3.32

## 0.2.8

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/dashboard-frontend@0.3.31

## 0.2.7

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/dashboard-frontend@0.3.30

## 0.2.6

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29

## 0.2.5

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/dashboard-frontend@0.3.28

## 0.2.4

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/dashboard-frontend@0.3.27

## 0.2.3

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/dependency-common@0.2.1
  - @checkstack/signal-frontend@0.0.15

## 0.2.2

### Patch Changes

- c0935d8: Fix dependency map node positions resetting when connecting two nodes. The graph-building effect was rebuilding all nodes from scratch on every data change, discarding unsaved drag positions. Node and edge construction are now split into separate effects with a clear position resolution priority: in-memory positions → saved positions → auto-layout fallback for new systems only.
  - @checkstack/catalog-common@1.3.0
  - @checkstack/common@0.6.4
  - @checkstack/dashboard-frontend@0.3.25
  - @checkstack/dependency-common@0.2.0
  - @checkstack/frontend-api@0.3.8
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/dashboard-frontend@0.3.25

## 0.2.0

### Minor Changes

- 3f36a64: Add System Dependencies plugin

  Introduces the system dependencies feature with three new core plugins and
  extends the catalog with a new SystemEditorSlot extension point.

  **New plugins:**

  - **dependency-common**: Shared Zod schemas, RPC contract with resource-level access control, signal definitions, and routes
  - **dependency-backend**: Drizzle schema, DependencyService with cycle detection, WarningEvaluationService with transitive impact matrix, RPC router with signal broadcasting, and per-user canvas node position persistence
  - **dependency-frontend**: DependencyBadge (dashboard), DependencyAlert (system details), DependencyEditor (system editor dialog), and interactive DependencyMapPage (React Flow canvas)

  **Catalog extensions:**

  - **catalog-common**: New `SystemEditorSlot` for plugin-injected sections in the system editor dialog
  - **catalog-frontend**: `SystemEditor` renders the slot after TeamAccessEditor for existing systems

  **Key capabilities:**

  - Directional dependency edges between systems (source depends on target)
  - Three impact types: informational, degraded, critical
  - Transitive multi-hop warning propagation with toggle switch
  - Cycle detection at creation time with graphical chain visualization
  - Health check-level dependency rules
  - Interactive dependency map with drag-to-connect, edge click editor, and auto-saving node positions
  - Inline editing of dependencies in both the system editor and the map canvas
  - Team-based resource-level access control on all mutation endpoints
  - Realtime signal-driven UI updates

### Patch Changes

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/dashboard-frontend@0.3.24
  - @checkstack/dependency-common@0.2.0
  - @checkstack/catalog-common@1.3.0
