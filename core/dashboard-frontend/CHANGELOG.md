# @checkstack/dashboard-frontend

## 0.8.0

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
  - @checkstack/catalog-frontend@0.11.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/command-frontend@0.3.0
  - @checkstack/queue-frontend@0.5.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/command-common@0.3.0
  - @checkstack/incident-common@1.4.0
  - @checkstack/maintenance-common@1.4.0
  - @checkstack/signal-frontend@0.2.0

## 0.7.8

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
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/maintenance-common@1.3.0
  - @checkstack/auth-frontend@0.6.7
  - @checkstack/catalog-frontend@0.10.7
  - @checkstack/command-frontend@0.2.42
  - @checkstack/notification-frontend@0.4.7
  - @checkstack/queue-frontend@0.4.7
  - @checkstack/tips-frontend@0.2.7

## 0.7.7

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
  - @checkstack/auth-frontend@0.6.6
  - @checkstack/catalog-common@2.2.3
  - @checkstack/catalog-frontend@0.10.6
  - @checkstack/command-frontend@0.2.41
  - @checkstack/incident-common@1.3.1
  - @checkstack/maintenance-common@1.2.3
  - @checkstack/notification-frontend@0.4.6
  - @checkstack/queue-frontend@0.4.6
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/anomaly-common@1.2.3
  - @checkstack/command-common@0.2.14
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-frontend@0.1.5

## 0.7.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/incident-common@1.3.0

## 0.7.5

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
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/notification-frontend@0.4.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/catalog-frontend@0.10.5
  - @checkstack/queue-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/anomaly-common@1.2.2
  - @checkstack/catalog-common@2.2.2
  - @checkstack/command-common@0.2.13
  - @checkstack/command-frontend@0.2.40
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/incident-common@1.2.2
  - @checkstack/maintenance-common@1.2.2
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.7.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/ui@1.9.0
  - @checkstack/anomaly-common@1.2.1
  - @checkstack/catalog-common@2.2.1
  - @checkstack/catalog-frontend@0.10.4
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/incident-common@1.2.1
  - @checkstack/maintenance-common@1.2.1
  - @checkstack/notification-frontend@0.4.4
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/command-frontend@0.2.39
  - @checkstack/queue-frontend@0.4.4
  - @checkstack/tips-frontend@0.2.4

## 0.7.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/catalog-frontend@0.10.3
  - @checkstack/command-frontend@0.2.38
  - @checkstack/notification-frontend@0.4.3
  - @checkstack/queue-frontend@0.4.3
  - @checkstack/tips-frontend@0.2.3

## 0.7.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/catalog-frontend@0.10.2
  - @checkstack/command-frontend@0.2.37
  - @checkstack/notification-frontend@0.4.2
  - @checkstack/queue-frontend@0.4.2
  - @checkstack/tips-frontend@0.2.2

## 0.7.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/maintenance-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/anomaly-common@1.2.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/catalog-frontend@0.10.1
  - @checkstack/command-common@0.2.12
  - @checkstack/command-frontend@0.2.36
  - @checkstack/frontend-api@0.5.1
  - @checkstack/notification-frontend@0.4.1
  - @checkstack/queue-frontend@0.4.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.7.0

### Minor Changes

- 3547670: Wire the new tips infrastructure across the frontends:

  **Empty-state coaching.** Replace generic "no items" copy with onboarding
  guidance — short description, three numbered steps and a primary CTA — on
  every EmptyState that has a meaningful next action. Affects: catalog
  (systems + groups), dashboard, health-check page, integrations (subscriptions

  - provider connections), GitOps providers + secrets, GitOps provenance,
    SLO config + overview, maintenance config, satellites, plugin manager,
    incident config, announcements. Read-only EmptyStates (incident history,
    maintenance history, plugin events) get clearer descriptions explaining
    what would populate them.

  **First-run anchored tips.** Add `<Tip>` popovers to the most important
  "Create" affordances so first-time users see a one-line explanation of
  what they're about to make and why it matters: catalog “Add System” /
  “Add Group”, healthcheck “Create Check”, integrations “New Subscription”,
  GitOps “Add Provider”, SLO “Create SLO”, maintenance “Create Maintenance”,
  satellite “Create Satellite”, plugin-manager “Install plugin”, incident
  “Report Incident”, announcement “New Announcement”. Each tip is dismissed
  per user (server-backed when signed in, localStorage otherwise) and
  namespaced through `qualifyTipId(plugin, …)` so it cannot escape the
  plugin's own namespace.

  **Welcome banner on the dashboard.** A `<TipBanner>` at the top of the
  dashboard introduces Checkstack's main flow ("add a system, then a health
  check") with a one-click jump into the catalog.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/anomaly-common@1.1.0
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/catalog-frontend@0.10.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/maintenance-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/queue-frontend@0.4.0
  - @checkstack/notification-frontend@0.4.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/command-common@0.2.11
  - @checkstack/command-frontend@0.2.35
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.6.1

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
  - @checkstack/catalog-frontend@0.9.1
  - @checkstack/command-common@0.2.10
  - @checkstack/common@0.8.0
  - @checkstack/maintenance-common@1.0.1
  - @checkstack/notification-frontend@0.3.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/anomaly-common@1.0.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/command-frontend@0.2.34
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/incident-common@1.0.1
  - @checkstack/notification-common@1.0.1
  - @checkstack/queue-frontend@0.3.3

## 0.6.0

### Minor Changes

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
  - @checkstack/catalog-frontend@0.9.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0
  - @checkstack/command-frontend@0.2.33
  - @checkstack/queue-frontend@0.3.2

## 0.5.1

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
  - @checkstack/anomaly-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/maintenance-common@0.5.0
  - @checkstack/notification-common@0.3.0
  - @checkstack/queue-frontend@0.3.1
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-frontend@0.8.7
  - @checkstack/command-frontend@0.2.32
  - @checkstack/ui@1.6.1

## 0.5.0

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

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/anomaly-common@0.2.0
  - @checkstack/common@0.7.0
  - @checkstack/queue-frontend@0.3.0
  - @checkstack/ui@1.6.0
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/catalog-common@1.5.2
  - @checkstack/catalog-frontend@0.8.6
  - @checkstack/command-common@0.2.9
  - @checkstack/command-frontend@0.2.31
  - @checkstack/frontend-api@0.3.11
  - @checkstack/incident-common@0.4.9
  - @checkstack/maintenance-common@0.4.11
  - @checkstack/notification-common@0.2.9
  - @checkstack/signal-frontend@0.0.16

## 0.4.6

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29
  - @checkstack/catalog-common@1.5.1
  - @checkstack/catalog-frontend@0.8.5
  - @checkstack/command-frontend@0.2.30
  - @checkstack/incident-common@0.4.8
  - @checkstack/maintenance-common@0.4.10
  - @checkstack/queue-frontend@0.2.31

## 0.4.5

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-frontend@0.8.4

## 0.4.4

### Patch Changes

- @checkstack/catalog-frontend@0.8.3

## 0.4.3

### Patch Changes

- Updated dependencies [019e659]
  - @checkstack/queue-frontend@0.2.30
  - @checkstack/auth-frontend@0.5.28
  - @checkstack/catalog-common@1.4.1
  - @checkstack/catalog-frontend@0.8.2

## 0.4.2

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27
  - @checkstack/catalog-frontend@0.8.1
  - @checkstack/command-frontend@0.2.29
  - @checkstack/queue-frontend@0.2.29

## 0.4.1

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/catalog-frontend@0.8.0

## 0.4.0

### Minor Changes

- bb1fea0: feat: implement active incident and maintenance overview sheets on dashboard

  - Replaces direct routing on status cards with slide-out overview sheets to gracefully degrade for users without manage permissions
  - Refactors dashboard system groups into a clean table-style list layout for better density
  - Makes global status cards more compact

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-frontend@0.7.0
  - @checkstack/auth-frontend@0.5.26
  - @checkstack/command-frontend@0.2.28
  - @checkstack/queue-frontend@0.2.28

## 0.3.35

### Patch Changes

- @checkstack/catalog-frontend@0.6.2

## 0.3.34

### Patch Changes

- @checkstack/catalog-frontend@0.6.1

## 0.3.33

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [4b0934d]
  - @checkstack/catalog-frontend@0.6.0
  - @checkstack/ui@1.3.6
  - @checkstack/auth-frontend@0.5.25
  - @checkstack/command-frontend@0.2.27
  - @checkstack/queue-frontend@0.2.27

## 0.3.32

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24
  - @checkstack/catalog-frontend@0.5.14
  - @checkstack/command-frontend@0.2.26
  - @checkstack/queue-frontend@0.2.26

## 0.3.31

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23
  - @checkstack/catalog-frontend@0.5.13
  - @checkstack/command-frontend@0.2.25
  - @checkstack/queue-frontend@0.2.25

## 0.3.30

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22
  - @checkstack/catalog-frontend@0.5.12
  - @checkstack/command-frontend@0.2.24
  - @checkstack/queue-frontend@0.2.24

## 0.3.29

### Patch Changes

- 0388000: Implemented a global performance-aware UI infrastructure that detects hardware capabilities (using heuristics and frame-budget benchmarks) to automatically disable expensive CSS animations, backdrop-blurs, and glassmorphism effects on low-power or non-hardware-accelerated devices.
- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/command-frontend@0.2.23
  - @checkstack/auth-frontend@0.5.21
  - @checkstack/catalog-frontend@0.5.11
  - @checkstack/queue-frontend@0.2.23

## 0.3.28

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20
  - @checkstack/catalog-frontend@0.5.10
  - @checkstack/command-frontend@0.2.22
  - @checkstack/queue-frontend@0.2.22

## 0.3.27

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/auth-frontend@0.5.19
  - @checkstack/catalog-frontend@0.5.9
  - @checkstack/command-frontend@0.2.21
  - @checkstack/queue-frontend@0.2.21

## 0.3.26

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
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/catalog-frontend@0.5.8
  - @checkstack/frontend-api@0.3.9
  - @checkstack/queue-frontend@0.2.20
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-common@0.2.8
  - @checkstack/command-frontend@0.2.20
  - @checkstack/incident-common@0.4.7
  - @checkstack/maintenance-common@0.4.9
  - @checkstack/notification-common@0.2.8
  - @checkstack/signal-frontend@0.0.15

## 0.3.25

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0

## 0.3.24

### Patch Changes

- 1f191cf: Add SYSTEM_STATUS_CHANGED signal and dependency-driven notification improvements

  **healthcheck-common:**

  - New `SYSTEM_STATUS_CHANGED` signal that fires only on system-level health status transitions (healthy ↔ degraded ↔ unhealthy), providing a low-noise alternative to `HEALTH_CHECK_RUN_COMPLETED` for coarse-grained reactivity

  **healthcheck-backend:**

  - Broadcast `SYSTEM_STATUS_CHANGED` signal at both status transition code paths in the queue executor

  **healthcheck-frontend:**

  - Switch `SystemHealthBadge` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` to reduce unnecessary refetch noise

  **dashboard-frontend:**

  - Switch `SystemBadgeDataProvider` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` for more efficient badge updates

  **maintenance-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

  **incident-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/catalog-common@1.3.0
  - @checkstack/catalog-frontend@0.5.7

## 0.3.23

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/catalog-frontend@0.5.6
  - @checkstack/command-frontend@0.2.19
  - @checkstack/queue-frontend@0.2.19

## 0.3.22

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16
  - @checkstack/catalog-frontend@0.5.5

## 0.3.21

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15
  - @checkstack/catalog-frontend@0.5.4
  - @checkstack/command-frontend@0.2.18
  - @checkstack/queue-frontend@0.2.18

## 0.3.20

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-common@1.2.11
  - @checkstack/catalog-frontend@0.5.3
  - @checkstack/command-frontend@0.2.17
  - @checkstack/queue-frontend@0.2.17

## 0.3.19

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-common@1.2.10
  - @checkstack/catalog-frontend@0.5.2
  - @checkstack/command-common@0.2.7
  - @checkstack/command-frontend@0.2.16
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/incident-common@0.4.6
  - @checkstack/maintenance-common@0.4.8
  - @checkstack/notification-common@0.2.7
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3
  - @checkstack/queue-frontend@0.2.16

## 0.3.18

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-common@1.2.9
  - @checkstack/catalog-frontend@0.5.1
  - @checkstack/command-frontend@0.2.15
  - @checkstack/incident-common@0.4.5
  - @checkstack/maintenance-common@0.4.7
  - @checkstack/queue-frontend@0.2.15
  - @checkstack/ui@1.1.2

## 0.3.17

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/catalog-frontend@0.5.0
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-common@0.2.6
  - @checkstack/command-frontend@0.2.14
  - @checkstack/frontend-api@0.3.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/incident-common@0.4.4
  - @checkstack/maintenance-common@0.4.6
  - @checkstack/notification-common@0.2.6
  - @checkstack/queue-frontend@0.2.14
  - @checkstack/signal-frontend@0.0.13

## 0.3.16

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10
  - @checkstack/catalog-frontend@0.4.2
  - @checkstack/command-frontend@0.2.13
  - @checkstack/queue-frontend@0.2.13

## 0.3.15

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/catalog-frontend@0.4.1
  - @checkstack/command-frontend@0.2.12
  - @checkstack/queue-frontend@0.2.12
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-common@0.2.5
  - @checkstack/frontend-api@0.3.5
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/incident-common@0.4.3
  - @checkstack/maintenance-common@0.4.5
  - @checkstack/notification-common@0.2.5
  - @checkstack/signal-frontend@0.0.12

## 0.3.14

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-frontend@0.4.0
  - @checkstack/catalog-common@1.2.6
  - @checkstack/ui@0.5.3
  - @checkstack/incident-common@0.4.2
  - @checkstack/maintenance-common@0.4.4
  - @checkstack/auth-frontend@0.5.8
  - @checkstack/command-frontend@0.2.11
  - @checkstack/queue-frontend@0.2.11

## 0.3.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-common@1.2.5
  - @checkstack/catalog-frontend@0.3.11
  - @checkstack/command-common@0.2.4
  - @checkstack/command-frontend@0.2.10
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/incident-common@0.4.1
  - @checkstack/maintenance-common@0.4.3
  - @checkstack/notification-common@0.2.4
  - @checkstack/queue-frontend@0.2.10
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.3.12

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.3.11

### Patch Changes

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0
  - @checkstack/ui@0.5.1
  - @checkstack/auth-frontend@0.5.6
  - @checkstack/catalog-frontend@0.3.10
  - @checkstack/command-frontend@0.2.9
  - @checkstack/queue-frontend@0.2.9

## 0.3.10

### Patch Changes

- Updated dependencies [11d2679]
- Updated dependencies [cce5453]
- Updated dependencies [223081d]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/incident-common@0.4.0
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/catalog-frontend@0.3.9
  - @checkstack/queue-frontend@0.2.8
  - @checkstack/command-frontend@0.2.8

## 0.3.9

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/catalog-frontend@0.3.8
  - @checkstack/command-common@0.2.3
  - @checkstack/command-frontend@0.2.7
  - @checkstack/frontend-api@0.3.3
  - @checkstack/incident-common@0.3.4
  - @checkstack/maintenance-common@0.4.2
  - @checkstack/notification-common@0.2.3
  - @checkstack/queue-frontend@0.2.7
  - @checkstack/signal-frontend@0.0.10

## 0.3.8

### Patch Changes

- 1f1f6c2: Fixed layout issue where multiple system status badges would push the system name out of view on dashboard cards
- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3
  - @checkstack/catalog-frontend@0.3.7
  - @checkstack/command-frontend@0.2.6
  - @checkstack/queue-frontend@0.2.6

## 0.3.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/incident-common@0.3.3
  - @checkstack/maintenance-common@0.4.1
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/catalog-frontend@0.3.6
  - @checkstack/command-common@0.2.2
  - @checkstack/command-frontend@0.2.5
  - @checkstack/frontend-api@0.3.2
  - @checkstack/notification-common@0.2.2
  - @checkstack/queue-frontend@0.2.5
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.3.6

### Patch Changes

- Updated dependencies [18fa8e3]
  - @checkstack/maintenance-common@0.4.0

## 0.3.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/catalog-frontend@0.3.5
  - @checkstack/command-frontend@0.2.4
  - @checkstack/queue-frontend@0.2.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/command-common@0.2.1
  - @checkstack/frontend-api@0.3.1
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/incident-common@0.3.2
  - @checkstack/maintenance-common@0.3.2
  - @checkstack/notification-common@0.2.1
  - @checkstack/signal-frontend@0.0.8

## 0.3.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/catalog-frontend@0.3.4
  - @checkstack/command-frontend@0.2.3
  - @checkstack/queue-frontend@0.2.3

## 0.3.3

### Patch Changes

- cad3073: Fixed notification group subscription for catalog groups:
  - Fixed group ID format using colon separator instead of dots and missing entity type prefix
  - Fixed subscription button state not updating after subscribe/unsubscribe by using refetch instead of invalidateQueries

## 0.3.2

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/catalog-frontend@0.3.3
  - @checkstack/command-frontend@0.2.2
  - @checkstack/queue-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/catalog-frontend@0.3.2

## 0.3.0

### Minor Changes

- 4eed42d: Fix "No QueryClient set" error in containerized builds

  **Problem**: The containerized application was throwing "No QueryClient set, use QueryClientProvider to set one" errors during plugin registration. This didn't happen in dev mode.

  **Root Cause**: The `@tanstack/react-query` package was being bundled separately in different workspace packages, causing multiple React Query contexts. The `QueryClientProvider` from the main app wasn't visible to plugin code due to this module duplication.

  **Changes**:

  - `@checkstack/frontend-api`: Export `useQueryClient` from the centralized React Query import, ensuring all packages use the same context
  - `@checkstack/dashboard-frontend`: Import `useQueryClient` from `@checkstack/frontend-api` instead of directly from `@tanstack/react-query`, and remove the direct dependency
  - `@checkstack/frontend`: Add `@tanstack/react-query` to Vite's `resolve.dedupe` as a safety net

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/catalog-frontend@0.3.1
  - @checkstack/command-frontend@0.2.1
  - @checkstack/incident-common@0.3.1
  - @checkstack/maintenance-common@0.3.1
  - @checkstack/queue-frontend@0.2.1
  - @checkstack/ui@0.2.2

## 0.2.0

### Minor Changes

- 180be38: # Queue Lag Warning

  Added a queue lag warning system that displays alerts when pending jobs exceed configurable thresholds.

  ## Features

  - **Backend Stats API**: New `getStats`, `getLagStatus`, and `updateLagThresholds` RPC endpoints
  - **Signal-based Updates**: `QUEUE_LAG_CHANGED` signal for real-time frontend updates
  - **Aggregated Stats**: `QueueManager.getAggregatedStats()` sums stats across all queues
  - **Configurable Thresholds**: Warning (default 100) and Critical (default 500) thresholds stored in config
  - **Dashboard Integration**: Queue lag alert displayed on main Dashboard (access-gated)
  - **Queue Settings Page**: Lag alert and Performance Tuning guidance card with concurrency tips

  ## UI Changes

  - Queue lag alert banner appears on Dashboard and Queue Settings when pending jobs exceed thresholds
  - New "Performance Tuning" card with concurrency settings guidance and bottleneck indicators

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-frontend@0.2.0
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/command-frontend@0.2.0
  - @checkstack/command-common@0.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/incident-common@0.3.0
  - @checkstack/maintenance-common@0.3.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.1.1

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/catalog-frontend@0.2.0
  - @checkstack/command-common@0.1.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/incident-common@0.2.0
  - @checkstack/maintenance-common@0.2.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.1.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

### Patch Changes

- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/ui@0.1.0
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/command-frontend@0.0.5
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/command-common@0.0.4
  - @checkstack/frontend-api@0.0.4
  - @checkstack/notification-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-frontend@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/command-common@0.0.3
  - @checkstack/command-frontend@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/maintenance-common@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/maintenance-common@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.0

### Minor Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/command-common@0.0.3
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/incident-common@0.1.2
  - @checkstack/maintenance-common@0.1.2
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1
  - @checkstack/catalog-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/catalog-common@0.1.1
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3
  - @checkstack/incident-common@0.1.1
  - @checkstack/maintenance-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/frontend-api@0.0.2
