# @checkstack/dependency-frontend

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
