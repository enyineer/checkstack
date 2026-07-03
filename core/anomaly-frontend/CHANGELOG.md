# @checkstack/anomaly-frontend

## 0.6.4

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/healthcheck-frontend@0.31.0
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/notification-frontend@0.7.3
  - @checkstack/anomaly-common@1.6.2
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-frontend@0.3.4

## 0.6.3

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/healthcheck-frontend@0.30.0
  - @checkstack/ui@1.23.0
  - @checkstack/anomaly-common@1.6.1
  - @checkstack/catalog-common@2.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/notification-frontend@0.7.2
  - @checkstack/signal-frontend@0.3.3

## 0.6.2

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/healthcheck-frontend@0.29.0

## 0.6.1

### Patch Changes

- 0cac684: Align the health-check run-history gates end to end. The history surfaces had a
  three-way drift: the route allowed `configuration.read`, the page required
  manage capability, and the procedures required the standalone
  `healthcheck.details` rule - so global read-rule holders reached a page that
  denied them, and team-scoped managers passed the page gate but got 403s from
  every data call.

  Detailed run history is now a MANAGER surface everywhere, with system owners
  included: access requires global `configuration.manage`, a team manage grant
  on the CONFIGURATION, or manage access to the SYSTEM - a system's owning team
  sees every run of that system, whoever owns the configuration.

  - Routes, pages, drawer links, and the anomaly/health signals gate on the
    manage capability (with `catalog.system` as the parent type); the drawer and
    chart hook check the caller's grant on the specific configuration OR system.
  - All three history procedures (`getDetailedHistory`,
    `getDetailedAggregatedHistory`, `getRunById`) are authorized in the handler
    via a shared fail-closed module (`history-access.ts`) - the triple-OR is not
    expressible with the declarative instanceAccess modes. `getRunById`
    authorizes against the fetched run's own configuration/system, and answers
    `undefined` for unauthorized callers so run ids don't leak existence.
  - The feed (`getDetailedHistory`) scopes team callers to runs of their
    configurations UNION runs of their systems, with correct pagination totals.

  BREAKING CHANGES:

  - The standalone `healthcheck.details` access rule is REMOVED. Roles that held
    `details` without `configuration.manage` lose access to detailed run data;
    grant them the manage rule (or a team grant on the configuration/system)
    instead. Stale role rows referencing the removed rule are inert.
  - `getDetailedAggregatedHistory` is `authenticated` (was `public`); anonymous
    callers could never pass its access rule anyway.

- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/healthcheck-frontend@0.28.0
  - @checkstack/notification-frontend@0.7.1

## 0.6.0

### Minor Changes

- 5236e41: Scope anomaly rows by (check, environment), completing the deferred follow-up
  from the per-environment work in #375 (which env-scoped only baselines).

  Previously the `anomalies` table was cross-environment: the inline spike
  detector and the drift evaluator located and created the open row by
  `(systemId, configurationId, fieldPath, kind)` with no environment predicate.
  When a `(system, configuration)` assignment fanned out to multiple environments,
  a healthy value in environment A shared one row with an anomaly in environment B,
  so one env could mask (or merge with) another.

  - **Schema.** New nullable `anomalies.environment_id` column (migration
    `0007_uneven_trauma.sql`, a single `ADD COLUMN`). No unique constraint is
    added: the table intentionally allows multiple rows per identity tuple (a
    `recovered` historical row plus a fresh active row), so uniqueness would break
    the state machine.
  - **Detection.** The spike detector (from the `checkCompleted` hook) and the
    drift evaluator (from the analyzer's per-environment loop) now locate/create
    the open row by `(systemId, configurationId, environmentId, fieldPath, kind)`,
    matching `environment_id = <id>` when present or `IS NULL` for the env-less
    slice - mirroring the per-environment baseline lookup.
  - **Reads.** `getAnomalies` gains an optional `environmentId` tristate filter
    (`undefined` = all envs, `null` = env-less slice, string = that env), and both
    `AnomalyDto` and `getActiveSignalAnomalies` surface `environmentId`. The
    system-detail widget renders an environment pill on env-scoped anomaly rows.
  - **Notifications.** An env-scoped anomaly appends its environment id to the
    collapse key, so two failing environments render as two independent cards
    instead of collapsing into one. The env-less slice keeps the pre-feature
    two-segment key. Mutes stay env-agnostic (per system / per field).

  BREAKING (semantics, not types; BETA so minor only):

  - **Anomaly row identity now includes `environmentId`.** For a fanned-out check,
    an anomaly in one environment is a distinct row from another environment. Any
    code that assumed a single anomaly row per `(system, config, field, kind)`
    must account for the environment dimension.
  - **`AnomalyDto` and `getActiveSignalAnomalies` rows carry a new
    `environmentId: string | null` field**, and `getAnomalies` accepts a new
    optional `environmentId` filter. Additive on the wire; consumers that reject
    unknown fields should be updated.
  - **Upgrade behaviour.** Existing rows backfill to `null` (the env-less slice)
    and stay until they recover; the next detection tick opens fresh
    per-environment rows for fanned-out checks. This mirrors how #375 handled
    baselines.

  State and scale: the anomaly state lives entirely in the shared `anomalies`
  Postgres table. `environmentId` is just another column on the row, so every pod
  reads the same per-`(system, config, env, field, kind)` state - no pod-local
  state, and reads return the same answer on every pod. The baseline cache key
  already carries the env segment (#375), so there is no cross-env cache shadowing.

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [5236e41]
- Updated dependencies [d1b71b6]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [b45be8e]
- Updated dependencies [d9f4654]
- Updated dependencies [3420d24]
- Updated dependencies [dea02f0]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [935d34e]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [53666a7]
- Updated dependencies [b3b547c]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/anomaly-common@1.6.0
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/healthcheck-frontend@0.27.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/notification-frontend@0.7.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/signal-frontend@0.3.2

## 0.5.18

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/healthcheck-frontend@0.26.1
  - @checkstack/notification-frontend@0.6.4

## 0.5.17

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-frontend@0.26.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/ui@1.20.0
  - @checkstack/anomaly-common@1.5.4
  - @checkstack/frontend-api@0.12.1
  - @checkstack/notification-common@1.4.2
  - @checkstack/notification-frontend@0.6.3
  - @checkstack/signal-frontend@0.3.1

## 0.5.16

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
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/anomaly-common@1.5.3
  - @checkstack/catalog-common@2.4.3
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/healthcheck-frontend@0.25.2
  - @checkstack/notification-common@1.4.1
  - @checkstack/notification-frontend@0.6.2
  - @checkstack/common@0.17.0

## 0.5.15

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/healthcheck-frontend@0.25.1
  - @checkstack/notification-frontend@0.6.1

## 0.5.14

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

- 8cad340: Enlarge the per-field mute/unmute icon button in the anomaly field mute list to a
  40px touch target (`h-10 w-10`) so it is reliably tappable on touch devices.
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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ui@1.17.0
  - @checkstack/healthcheck-frontend@0.25.0
  - @checkstack/notification-frontend@0.6.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/anomaly-common@1.5.2
  - @checkstack/catalog-common@2.4.2
  - @checkstack/signal-frontend@0.2.6

## 0.5.13

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/healthcheck-frontend@0.24.1
  - @checkstack/notification-frontend@0.5.9
  - @checkstack/ui@1.16.2
  - @checkstack/anomaly-common@1.5.1

## 0.5.12

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/common@0.16.0
  - @checkstack/anomaly-common@1.5.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/healthcheck-frontend@0.24.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/notification-frontend@0.5.8
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-frontend@0.2.5

## 0.5.11

### Patch Changes

- @checkstack/healthcheck-frontend@0.23.11

## 0.5.10

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/healthcheck-frontend@0.23.10
  - @checkstack/notification-frontend@0.5.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/anomaly-common@1.4.2
  - @checkstack/healthcheck-common@1.6.2

## 0.5.9

### Patch Changes

- @checkstack/catalog-common@2.3.5
- @checkstack/healthcheck-frontend@0.23.9
- @checkstack/notification-frontend@0.5.6
- @checkstack/anomaly-common@1.4.1
- @checkstack/healthcheck-common@1.6.1

## 0.5.8

### Patch Changes

- @checkstack/healthcheck-frontend@0.23.8

## 0.5.7

### Patch Changes

- 0b6f01b: feat(anomaly): contribute anomaly signals to the backend system.issues aggregator

  The anomaly plugin now registers a `system.issues` contributor (sourceId
  `anomaly`) from its backend `init`, so the AI assistant surfaces confirmed
  anomalies and suspicious states alongside incidents, SLOs, health checks, and
  dependency problems.

  The contributor enforces its own `anomaly_feed.read` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users are
  trusted), then reads the current problem rows for every system from the shared,
  durable `anomalies` table via a new global `getActiveSignalAnomalies` service
  method (state = anomaly | suspicious, suppressed rows excluded). The answer is
  therefore identical on every pod, and only systems with a current problem appear
  in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveAnomalySignals` deriver in
  `@checkstack/anomaly-common`, shared by both the backend contributor and the
  frontend `AnomalySignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/anomaly-common@1.4.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/healthcheck-frontend@0.23.7

## 0.5.6

### Patch Changes

- @checkstack/healthcheck-frontend@0.23.6

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

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/notification-frontend@0.5.5
  - @checkstack/catalog-common@2.3.4
  - @checkstack/healthcheck-frontend@0.23.5
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/anomaly-common@1.3.4
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/notification-common@1.3.3
  - @checkstack/signal-frontend@0.2.4

## 0.5.4

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
  - @checkstack/healthcheck-frontend@0.23.4
  - @checkstack/notification-frontend@0.5.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/anomaly-common@1.3.3
  - @checkstack/common@0.14.1
  - @checkstack/healthcheck-common@1.5.3
  - @checkstack/notification-common@1.3.2

## 0.5.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/healthcheck-frontend@0.23.3
  - @checkstack/notification-frontend@0.5.3
  - @checkstack/anomaly-common@1.3.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/anomaly-common@1.3.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/healthcheck-frontend@0.23.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/notification-frontend@0.5.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/anomaly-common@1.3.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/healthcheck-frontend@0.23.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/notification-frontend@0.5.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.5.0

### Minor Changes

- 9dcc848: Auto-resolve anomalies that settle at a new normal, and add global suppression.

  Part A (bug fix): a confirmed anomaly used to stay stuck in `anomaly` indefinitely when the metric settled at a new stable level. Both detectors now carry a baseline-independent self-resolution path - spike: after `STABLE_RESOLUTION_RUN_COUNT` (5) consecutive healthy samples within `STABLE_RESOLUTION_RELATIVE_BAND` (10%) the row self-resolves to `recovered`; drift: when the projected change goes flat relative to the new mean for `STABLE_DRIFT_RESOLUTION_RUN_COUNT` (2) analyzer runs. The original baseline-relative recovery path is unchanged.

  Part B (feature): global (per-row) suppression. New `suppressedAt` / `suppressedValue` / `suppressedBaseline` columns (Drizzle migration `0005`), `suppressAnomaly` / `unsuppressAnomaly` RPCs gated by `anomaly_feed.manage`, and a `suppression` filter on `getAnomalies` (default `active` hides suppressed rows). Suppressed rows drop out of the dashboard badge/widget active count; the widget exposes an eye-off suppress affordance. Suppression auto-clears once the observed value moves more than `SUPPRESSION_REACTIVATION_DELTA` (25%) from the value it was suppressed at. All suppression state lives on the shared `anomalies` row, so every pod reads the same active/suppressed set. Distinct from the existing per-user notification mute.

  This is a beta minor.

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/anomaly-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/healthcheck-frontend@0.23.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/notification-frontend@0.5.0
  - @checkstack/signal-frontend@0.2.0

## 0.4.8

### Patch Changes

- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/healthcheck-frontend@0.22.0
  - @checkstack/notification-frontend@0.4.7

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
  - @checkstack/healthcheck-frontend@0.21.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/notification-frontend@0.4.6
  - @checkstack/anomaly-common@1.2.3
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-frontend@0.1.5

## 0.4.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/healthcheck-frontend@0.20.0

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
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/healthcheck-frontend@0.19.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/notification-frontend@0.4.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/ui@1.10.0
  - @checkstack/anomaly-common@1.2.2
  - @checkstack/catalog-common@2.2.2
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-frontend@0.1.4

## 0.4.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/healthcheck-frontend@0.19.4
  - @checkstack/ui@1.9.0
  - @checkstack/anomaly-common@1.2.1
  - @checkstack/catalog-common@2.2.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/notification-frontend@0.4.4

## 0.4.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/healthcheck-frontend@0.19.3
  - @checkstack/notification-frontend@0.4.3

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/healthcheck-frontend@0.19.2
  - @checkstack/ui@1.8.2
  - @checkstack/notification-frontend@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/anomaly-common@1.2.0
  - @checkstack/frontend-api@0.5.1
  - @checkstack/healthcheck-frontend@0.19.1
  - @checkstack/notification-frontend@0.4.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.4.0

### Minor Changes

- 42abfff: Remove global anomaly settings — configuration is now field-only.

  `AnomalySettings` (template- and assignment-level) no longer carries
  `sensitivity`, `confirmationWindow`, `driftEnabled`, or `driftThreshold`.
  These were duplicating the per-field configuration path with awkward
  cascade semantics, and a single global multiplier was meaningless across
  fields with different units (ms, %, counts).

  The schema retains only the truly global concerns:

  - `enabled` — master kill switch for the assignment
  - `baselineWindow` — there is one history per system, not per field
  - `notify` — one notification preference per assignment
  - `fieldOverrides` — per-field configuration (where everything else now lives)

  `resolveEffectiveConfig` collapses to two layers: field override → schema
  default → engine fallback constant. The plugin-author defaults set via
  `x-anomaly-*` annotations now drive sensitivity/window/drift across the
  detector and drift evaluator (previously only floors were threaded
  through the schema layer).

  **Breaking changes:**

  - Any global `sensitivity`/`confirmationWindow`/`driftEnabled`/
    `driftThreshold` values previously stored in `anomaly_configurations`
    or `anomaly_assignments` are silently stripped on parse. Users who
    customized these globals will revert to the plugin's tuned per-field
    defaults; if they want to keep those values they must re-apply them
    per field in the new UI.
  - `AnomalySettingsForm` no longer renders the global sliders. The form
    now shows: enable toggle, baseline window selector, notify toggle,
    field overrides editor.
  - `AnomalyFieldOverridesEditor` props `defaultSensitivity`,
    `defaultConfirmationWindow`, `defaultDriftEnabled`, `defaultDriftThreshold`
    are removed. Engine fallbacks (1.0, 3, true, 2) are now hard-coded
    internal constants used only when neither field override nor schema
    default is set.
  - The GitOps `System.anomaly` entry schema (in `anomaly-gitops-kinds`)
    drops `sensitivity`, `confirmationWindow`, `driftEnabled`, and
    `driftThreshold` to match the new `AnomalySettings` shape. YAML files
    declaring those fields will be rejected at parse time — operators
    must move per-field tuning into `fieldOverrides`.

  This change makes the override model trivial to explain ("plugin defaults,
  overridden per field") and removes a class of confusing "where did this
  threshold come from?" questions.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/anomaly-common@1.1.0
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/notification-frontend@0.4.0
  - @checkstack/healthcheck-frontend@0.19.0
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.3.1

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/healthcheck-frontend@0.18.2
  - @checkstack/notification-frontend@0.3.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/anomaly-common@1.0.1
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/notification-common@1.0.1

## 0.3.0

### Minor Changes

- 32d52c6: feat(anomaly): per-system and per-field notification mute

  Anomaly notifications now flow through their own subscription group
  (`anomaly.system.<systemId>`) instead of the shared catalog system group, so
  users can opt out of anomaly noise without losing incident or healthcheck
  alerts for the same system. On first deploy, existing subscribers of each
  `catalog.system.<id>` group are seeded onto the new anomaly group so no one
  silently stops getting alerts.

  A new mute table (`anomaly_notification_mutes`) backs two granularities:

  - **Per-field**: silence a single noisy metric on one system.
  - **Per-system**: silence every anomaly for one system in one click.

  The system anomaly widget now exposes a bell icon on each anomaly row plus a
  `Mute all` toggle in the card header. Mutes are user-scoped and persist
  across sessions.

  Catalog gains a `systemCreated` hook so anomaly (and any future plugin) can
  provision per-system state on creation rather than waiting for a restart.
  The notification service gains a `bulkSubscribe` service-RPC used by the
  one-time migration described above.

- 32d52c6: feat: unified notification-subscription manager dialog driven by spec registry

  Replaces the bell-toggle UX (which only managed a single legacy
  catalog group) with a modal that lists every notification type
  registered against a target — system or group — and exposes both
  per-type toggles and a bulk "Subscribe to all / Unsubscribe from all"
  action. Both surfaces (system detail page header bell, dashboard group
  header bell) now open the same `NotificationSubscriptionsManager`
  component.

  **Key change vs. the prior slot-based approach**: rows are now driven
  by `notificationClient.listSubscriptionSpecs` — the backend's spec
  registry is the single source of truth. Previously, a row only
  appeared if a frontend plugin had remembered to register a
  `createNotificationSubscriptionExtension`; this caused silent drift
  (healthcheck and dependency registered backend specs without frontend
  extensions, so the dialog counted them but never rendered rows). Now,
  every spec the platform knows about renders a row using the spec's
  `display` metadata (title, description, iconName resolved via
  `DynamicIcon`).

  **Sub-controls registry** (`@checkstack/notification-frontend`):
  plugins that want sub-granularity (anomaly's per-field mute list,
  future severity / channel filters) call
  `registerSubscriptionSubControls(spec, Component)` at module load —
  the manager looks the component up by `specId` when expanding a row.

  **Removed (no compat)**:

  - `createNotificationSubscriptionExtension` (replaced by the
    spec-driven manager + the SubControls registry)
  - `target.slot` field on `NotificationTarget` and the
    `NotificationTargetInput.slot` parameter on
    `defineNotificationTarget`
  - `SystemNotificationSubscriptionsSlot` and
    `GroupNotificationSubscriptionsSlot` from `@checkstack/catalog-common`
  - `SystemNotificationsCard` from the system detail page's main column
  - `SubscribeButton` wiring on dashboard group cards and the system
    detail page header

  **Migrated frontends**: anomaly (now registers `AnomalyFieldMuteList`
  via the SubControls registry), incident, maintenance — all dropped
  their `createNotificationSubscriptionExtension` calls. healthcheck and
  dependency now show up automatically via the spec registry — no
  frontend changes needed for them to render.

  The trigger button reflects aggregate state — filled bell when at
  least one spec is subscribed for the resource, ghost bell when none.

- 32d52c6: feat: notification target pattern + per-spec subscriptions

  Replaces the all-or-nothing catalog system/group notification model with a
  platform-level target pattern. Each notification-emitting plugin declares
  _subscription specs_ against typed _target_ objects exported from the
  target's owning plugin (catalog ships `catalogSystemTarget` and
  `catalogGroupTarget`). Notification-backend handles every per-resource
  group lifecycle, parent-edge inheritance, and legacy-subscription seeding
  — plugins never author groupId helpers, lifecycle hooks, or migration
  code again.

  **Plugin-author surface area is now ~12 lines per emitter:**

  ```ts
  // <plugin>-common
  const { defineSubscription } = createSubscriptionFactory(pluginMetadata);
  export const fooSystemSubscription = defineSubscription({
    localId: "system",
    target: catalogSystemTarget,
    display: { title: "Foo Alerts", description: "...", iconName: "Bell" },
  });

  // <plugin>-backend register()
  env.registerSubscriptionSpecs([fooSystemSubscription]);
  //   ^ feeds the plugin loader's dependency sorter — each spec's
  //     target.ownerPlugin becomes an implicit init-order dep, so this
  //     plugin automatically waits for catalog (the target owner) to
  //     finish init + afterPluginsReady before its own runs.

  // <plugin>-backend afterPluginsReady
  await notificationClient.registerSubscriptionSpec(
    specToRegistration(fooSystemSubscription)
  );
  // dispatch
  await notificationClient.notifyForSubscription({
    specId: fooSystemSubscription.specId,
    resourceKeys: [systemId],
    title,
    body,
    importance,
    action,
    collapseKey,
    subjects,
  });

  // <plugin>-frontend
  createNotificationSubscriptionExtension({ spec: fooSystemSubscription });
  ```

  **Migrated plugins**: anomaly, incident, maintenance, healthcheck,
  dependency. Each lost its bespoke `notification-groups.ts`,
  `bootstrap*NotificationGroups`, `ensure*Group`, and inheritance walk —
  all of that is now centralized in notification-backend's
  `subscription-engine`.

  **Plugin loader change** (`@checkstack/backend-api`,
  `@checkstack/backend`): the register-time API gains
  `env.registerSubscriptionSpecs([...specs])`. The dependency sorter
  walks `spec.target.ownerPlugin` for every declared spec and adds the
  target owner as an init-order dependency of the emitting plugin. This
  guarantees that catalog (the owner of the platform's `system` and
  `group` targets) completes init + afterPluginsReady before any
  emitting plugin tries to register its specs against the notification
  service — no string-prefix heuristics, no manual `dependsOnPlugins`
  list, no stub rows. Plugins that fail to declare their specs at
  register time get a clear `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
  error from the dispatcher.

  **Removed** (no backwards compat):

  - `catalogClient.notifySystemSubscribers` and
    `catalogClient.notifyManySystemSubscribers`
  - `notificationClient.notifyUsers` and `notificationClient.notifyGroups`
    as direct dispatch primitives — replaced by spec-bound
    `notifyForSubscription`
  - catalog's `bootstrapNotificationGroups` (replaced by
    `bootstrapNotificationTargets`)

  **Enforcement**: the dispatcher rejects calls referencing unregistered
  specIds, specs owned by other plugins, or resourceKeys that haven't been
  pushed via `upsertNotificationResource`. Display metadata for any
  groupId is recoverable via the spec registry, so audit lists render
  correct labels even when an emitter's frontend isn't loaded.

  **Per-field anomaly mute** keeps working — it now lives inside the
  generic SubscriptionRow's optional `SubControls` panel
  (`AnomalyFieldMuteList`), exposed through the catalog system detail
  page's notifications card.

  The catalog system detail page renders a "Notifications" card hosting
  `SystemNotificationSubscriptionsSlot`. The matching group surface is
  not yet rendered — group-level subscriptions are wired end-to-end on
  the backend; a follow-up will add the host UI.

  **Migration of existing subscribers**: target types declare a
  `legacyGroupIdTemplate`; on first registration of each spec,
  notification-backend reads subscribers from the legacy
  `catalog.system.<id>` / `catalog.group.<id>` groups and seeds the new
  spec groups exactly once per (spec × resource) pair, tracked in
  `subscription_migrations`. Anomaly stays opt-in (its target also
  declares the template, but the user-explicit nature of the original
  opt-in flow means the seeding produces the same set of subscribers
  they already had).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/anomaly-common@1.0.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/notification-frontend@0.3.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/ui@1.7.0
  - @checkstack/healthcheck-frontend@0.18.1

## 0.2.2

### Patch Changes

- Updated dependencies [a914b31]
- Updated dependencies [ac1e5d4]
- Updated dependencies [208ad71]
  - @checkstack/healthcheck-frontend@0.18.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/anomaly-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/catalog-common@1.5.3
  - @checkstack/ui@1.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [42b0832]
  - @checkstack/healthcheck-frontend@0.17.1

## 0.2.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

- 8d1ef12: Phase 2 of anomaly detection: trend drift detection.

  The background baseline analyzer now computes a linear regression slope across each field's chronologically-ordered history and runs a `detectDrift` evaluator that catches gradual "creeping degradation" never reaching the 3σ spike threshold. Drifts share the same `anomalies` table as spike anomalies via a new `kind` column (`spike` | `drift`, default `spike`); the existing suspicious → anomaly → recovered lifecycle is reused, ticking at the analyzer's hourly cadence with a default 2-run confirmation window.

  User-facing additions: a Trend Drift toggle and threshold slider on both the template and assignment anomaly settings panels (with per-field overrides), drift rows in the System Anomaly widget, dashed regression-line overlays on the auto-generated line charts, and a new `ANOMALY_TREND_DETECTED` signal for live UI updates. Plugin authors can disable drift per chartable field via `x-anomaly-drift-enabled: false` or tighten/loosen it via `x-anomaly-drift-threshold`.

- 8d1ef12: Added Categorical Anomaly Detection (Dominance Drift) support for non-numeric healthcheck values, and introduced Slider UI components for sensitivity and confirmation window anomaly settings.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/anomaly-common@0.2.0
  - @checkstack/healthcheck-frontend@0.17.0
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-frontend@0.0.16
