# @checkstack/notification-frontend

## 0.5.8

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-frontend@0.2.5

## 0.5.7

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/auth-frontend@0.7.7
  - @checkstack/tips-frontend@0.3.7

## 0.5.6

### Patch Changes

- @checkstack/auth-frontend@0.7.6
- @checkstack/tips-frontend@0.3.6

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

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-frontend@0.7.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/notification-common@1.3.3
  - @checkstack/tips-frontend@0.3.5
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
  - @checkstack/auth-frontend@0.7.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/common@0.14.1
  - @checkstack/notification-common@1.3.2

## 0.5.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/auth-frontend@0.7.3
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-frontend@0.7.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/tips-frontend@0.3.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/auth-frontend@0.7.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/tips-frontend@0.3.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.5.0

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

- 9dcc848: Guard component animations behind isLowPower, and add a shared inline Spinner.

  - `@checkstack/ui` shared components (`Tabs`, `ConfirmationModal`, `Accordion`, `CodeEditor` popout-button backdrop blur) now drop their `animate-*` / `backdrop-blur` classes when the device reports the low-power tier, matching `LoadingSpinner` / `Skeleton`. No public API change; normal-power rendering is unchanged.
  - A new shared inline `Spinner` (`@checkstack/ui`) renders a lucide `Loader2` whose `animate-spin` is gated internally behind `usePerformance().isLowPower`, so call sites inherit the low-power guard. Props: `size` (`sm`/`md`/`lg`), `className`, rest spread to the icon; decorative by default (`aria-hidden`), `role="status"` when given `aria-label`. The hand-rolled `Loader2` button/table spinners in `HealthCheckDrawer`, `HealthCheckRunsTable`, `IncidentEditor`, `IncidentUpdateForm`, `ProviderConnectionsPage`, `MaintenanceEditor`, `MaintenanceUpdateForm`, `UserChannelCard`, and `DynamicOptionsField` are migrated onto it.
  - Remaining unguarded `animate-*` / `animate-in` / blur classes across the auth, gitops, healthcheck, incident, integration, maintenance, and notification frontends are gated behind `usePerformance().isLowPower`, so effects degrade gracefully on low-power devices per the performance rule.

  Normal-power behavior is unchanged; low-power rendering drops the animations.

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
  - @checkstack/ui@1.13.0
  - @checkstack/auth-frontend@0.7.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/signal-frontend@0.2.0

## 0.4.7

### Patch Changes

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
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/auth-frontend@0.6.7
  - @checkstack/tips-frontend@0.2.7

## 0.4.6

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
  - @checkstack/auth-frontend@0.6.6
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-frontend@0.1.5

## 0.4.5

### Patch Changes

- f23f3c9: Add per-channel notification delivery-attempt tracking
  (Phase 8 of the v1 polishing plan). The external dispatch loop now
  persists one row per `strategy.send(...)` call into a new
  `notification_delivery_attempts` table - both successes and
  failures - so silent delivery breakage (misconfigured webhooks, dead
  channels) becomes queryable instead of buried in logs.

  - `@checkstack/notification-backend` adds the
    `notification_delivery_attempts` table, the matching Drizzle
    migration, and a new `dispatchWithAttempt` helper that wraps every
    external `strategy.send(...)` with duration measurement and
    best-effort row persistence. The insert is intentionally
    fire-and-forget: if writing the attempt row itself errors, the
    dispatch loop logs and continues so visibility tracking can never
    introduce a _new_ silent failure.
  - `@checkstack/notification-common` exports a new
    `DeliveryAttemptSchema` zod schema, the
    `ListDeliveryAttemptsInputSchema =
PaginationInput.extend({ notificationId })` input, and a new
    `getDeliveryAttempts` procedure on the contract. The procedure is
    gated by the existing `notificationAccess.admin`
    (`notification:manage`) access rule - no new permission was
    introduced.
  - `@checkstack/notification-frontend` adds a minimal admin-only
    `DeliveryAttemptsPage` (route id `notification.deliveryAttempts`,
    path `/notifications/delivery-attempts`) and an "Open inspector"
    link from the Notification Settings page for users with
    `notification:manage`. No client-side `isAdmin` gate - the FORBIDDEN
    case is rendered via the standard error-state branch on the page,
    enforced by the contract.

  Visibility only: there is no retry mechanism in this phase. A
  `failure` row is a final outcome an admin actions manually
  (re-trigger the source event, fix the misconfigured channel).
  Automated retries are deferred to v1.1.

  Strategy errors thrown during `send(...)` are persisted via
  `extractErrorMessage(error)` so secrets potentially embedded in raw
  error objects (webhook URLs, OAuth tokens reachable from the strategy
  send context) are not stored verbatim.

  See the new
  `docs/src/content/docs/backend/notification-delivery.md` page for the
  full surface description.

- f23f3c9: Establish the canonical optimistic-UI pattern for oRPC mutations
  (`onMutate` snapshot / patch, `onError` rollback, `onSettled`
  invalidate) and apply it to the two highest-frequency toggles where
  perceived latency was most visible:

  - `markAsRead` on the Notifications page — clicking the check on a
    notification card now flips the read state immediately instead of
    waiting for the round-trip.
  - `pauseConfiguration` / `resumeConfiguration` on the Health Check
    Config page — pause/resume now flip the row's badge instantly,
    rolling back on server error.

  The wrapper type for `useMutation` on each plugin client gained an
  optional `TContext` generic so optimistic sites can return a snapshot
  from `onMutate` and consume it in `onError` without `unknown` casts.
  The runtime behaviour and the auto-invalidation on success are
  unchanged; the change is additive on the type surface only.

  Full pattern and "when NOT to use it" guidance live in
  `docs/frontend/optimistic-updates.md`.

- f23f3c9: Sweep every paginated `*-common` contract onto the canonical
  `PaginationInput` / `PaginatedResult` from `@checkstack/common` and
  remove the now-unused legacy exports.

  **BREAKING CHANGE** - `@checkstack/common` drops the deprecated
  `PaginationInputSchema`, `paginatedOutput`, and `PaginatedResponse`
  symbols. Callers must consume `PaginationInput` (input) and
  `PaginatedResult(itemSchema)` (output) instead. The canonical input is
  `{ limit (1-100, default 20), offset (>= 0, default 0) }`; the
  canonical output envelope is
  `{ items, total, limit, offset }`.

  **BREAKING CHANGE** - `@checkstack/notification-common` migrates
  `getNotifications` off the legacy `PaginationInputSchema`
  (`{ limit, offset, unreadOnly }` with output `{ notifications, total }`)
  onto `ListNotificationsInputSchema =
PaginationInput.extend({ unreadOnly })` and
  `PaginatedResult(NotificationSchema)`. The output key changes from
  `notifications` to `items`, and `limit` / `offset` are now echoed on
  the response. The `PaginationInput` type alias previously exported
  from `notification-common` is removed - use `ListNotificationsInput`
  or the canonical `PaginationInput` from `@checkstack/common`.

  **BREAKING CHANGE** - `@checkstack/integration-common` migrates
  `listSubscriptions` (inline `{ page, pageSize, ... }` -> output
  `{ subscriptions, total }`) and `getDeliveryLogs` (via
  `DeliveryLogQueryInputSchema` `{ subscriptionId?, eventType?, status?,
page, pageSize }` -> output `{ logs, total }`) onto the canonical
  `PaginationInput.extend({...})` input and
  `PaginatedResult(itemSchema)` output. External callers must switch
  from `{ page, pageSize }` to `{ limit, offset }` and read response
  items from `data.items` (no more `data.subscriptions` / `data.logs`).

  The matching `*-backend` handlers were updated to consume the new
  input shape (`offset` arithmetic in lieu of `(page - 1) * pageSize`)
  and to echo `limit` / `offset` on the response. The `*-frontend` call
  sites in `NotificationsPage`, `NotificationBell`, `IntegrationsPage`,
  and `DeliveryLogsPage` were updated to send the new input shape and
  read `data.items`.

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

- f23f3c9: Standardise the empty / loading / error story on key list pages using
  the shared `ListEmptyState`, `QueryErrorState`, and `Skeleton`
  primitives from `@checkstack/ui`. Each affected page now branches
  through the same `isLoading -> isError -> empty -> data` ladder, so
  failed queries surface a retry-able inline error instead of silently
  rendering an empty table, and loading states match the final layout
  rather than flashing a generic spinner. No layout, business logic, or
  query input shapes changed.
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/ui@1.10.0
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.4.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/ui@1.9.0
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/tips-frontend@0.2.4

## 0.4.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/tips-frontend@0.2.3

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/tips-frontend@0.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.4.0

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

- 3547670: Add a `<Tip>` next to the title in the notification-subscriptions modal
  that explains the two things that confuse first-time users: (1) the
  difference between subscribing to an individual system vs. subscribing
  to a whole group (groups auto-include systems added later), and (2) the
  difference between "Subscribe to all" and toggling specific rows for
  just the event types they care about. Tip id:
  `notification.subscriptions.intro`.
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
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
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
  - @checkstack/common@0.8.0
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/frontend-api@0.4.2
  - @checkstack/notification-common@1.0.1

## 0.3.0

### Minor Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

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

- 32d52c6: Fix several modal/sheet/overlay closing issues:

  - Replace the custom `DropdownMenu` container with a Radix-based `Popover` (desktop) and `Sheet` (mobile). The previous mobile implementation suppressed outside-click closing, leaving the notification bell's panel only closable by clicking the bell again. `UserMenu` and `NotificationBell` were updated to the new pattern. Leaf primitives `DropdownMenuItem`, `DropdownMenuLabel`, and `DropdownMenuSeparator` are preserved (now backed by a `MenuCloseContext`) so existing call sites continue to work.
  - Fix `Dialog` outside-click closing. The previous structure made `DialogPrimitive.Content` cover the full viewport, so Radix never registered clicks on the dimmed area as "outside" — only ESC could close the modal. The centering wrapper is now a non-Content `<div>` and the actual modal box is the Content, so outside-click closes correctly. A visible X button is now rendered by default; pass `hideCloseButton` to suppress it (e.g. for the search overlay where it would clash with a custom header).
  - Export a standalone `useIsMobile` hook and a new `Popover` primitive.
  - Prevent Radix's auto-focus-return on `NotificationBell` and `UserMenu` overlays. Closing via an item with a `<Link>` (e.g. "View all notifications") would synchronously refocus the trigger via `onCloseAutoFocus`, stealing focus from the link mid-click on pages where another element held focus and requiring a second click to navigate.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-common@1.0.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0

## 0.2.36

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
  - @checkstack/notification-common@0.3.0
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/ui@1.6.1

## 0.2.35

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/frontend-api@0.3.11
  - @checkstack/notification-common@0.2.9
  - @checkstack/signal-frontend@0.0.16

## 0.2.34

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29

## 0.2.33

### Patch Changes

- @checkstack/auth-frontend@0.5.28

## 0.2.32

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27

## 0.2.31

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/auth-frontend@0.5.26

## 0.2.30

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/auth-frontend@0.5.25

## 0.2.29

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24

## 0.2.28

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23

## 0.2.27

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22

## 0.2.26

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/auth-frontend@0.5.21

## 0.2.25

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20

## 0.2.24

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/auth-frontend@0.5.19

## 0.2.23

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
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/frontend-api@0.3.9
  - @checkstack/notification-common@0.2.8
  - @checkstack/signal-frontend@0.0.15

## 0.2.22

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17

## 0.2.21

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16

## 0.2.20

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15

## 0.2.19

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4

## 0.2.18

### Patch Changes

- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/notification-common@0.2.7
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3

## 0.2.17

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/ui@1.1.2

## 0.2.16

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/frontend-api@0.3.6
  - @checkstack/notification-common@0.2.6
  - @checkstack/signal-frontend@0.0.13

## 0.2.15

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10

## 0.2.14

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/frontend-api@0.3.5
  - @checkstack/notification-common@0.2.5
  - @checkstack/signal-frontend@0.0.12

## 0.2.13

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/ui@0.5.3
  - @checkstack/auth-frontend@0.5.8

## 0.2.12

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/notification-common@0.2.4
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.2.11

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1
  - @checkstack/auth-frontend@0.5.6

## 0.2.10

### Patch Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

- Updated dependencies [223081d]
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5

## 0.2.9

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/frontend-api@0.3.3
  - @checkstack/notification-common@0.2.3
  - @checkstack/signal-frontend@0.0.10

## 0.2.8

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3

## 0.2.7

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/frontend-api@0.3.2
  - @checkstack/notification-common@0.2.2
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.2.6

### Patch Changes

- 5ac15df: Fixed notification count badge not updating correctly when notifications are marked as read.

  **Root Cause:** When the `NOTIFICATION_READ` signal was received, `signalUnreadCount` state was `undefined` (only set from signals, not initial query data), so it incorrectly defaulted to `1` instead of the actual count from the query. This caused the count to jump to `0` after the first mark-as-read.

  **Fix:** Now uses `unreadData?.count` as the fallback value when decrementing the count in the signal handler.

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/frontend-api@0.3.1
  - @checkstack/notification-common@0.2.1
  - @checkstack/signal-frontend@0.0.8

## 0.2.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1

## 0.2.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/ui@0.2.2

## 0.2.0

### Minor Changes

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

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.1.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/notification-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.4

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/ui@0.1.1

## 0.1.0

### Minor Changes

- b55fae6: Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

  ## New Packages

  - **@checkstack/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
  - **@checkstack/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
  - **@checkstack/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

  ## Changes

  - **@checkstack/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
  - **@checkstack/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

  ## Usage

  Backend plugins can emit signals:

  ```typescript
  import { coreServices } from "@checkstack/backend-api";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  const signalService = context.signalService;
  await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
  ```

  Frontend components subscribe to signals:

  ```tsx
  import { useSignal } from "@checkstack/signal-frontend";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  useSignal(NOTIFICATION_RECEIVED, (payload) => {
    // Handle realtime notification
  });
  ```

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
