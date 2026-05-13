# @checkstack/announcement-frontend

## 0.3.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/tips-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/announcement-common@0.4.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.3.0

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
  - @checkstack/announcement-common@0.3.2
  - @checkstack/signal-frontend@0.1.2

## 0.2.16

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/announcement-common@0.3.1
  - @checkstack/common@0.8.0
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/frontend-api@0.4.2

## 0.2.15

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0

## 0.2.14

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
  - @checkstack/announcement-common@0.3.0
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/ui@1.6.1

## 0.2.13

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/announcement-common@0.2.2
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-frontend@0.0.16

## 0.2.12

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29

## 0.2.11

### Patch Changes

- @checkstack/auth-frontend@0.5.28

## 0.2.10

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27

## 0.2.9

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/auth-frontend@0.5.26

## 0.2.8

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/auth-frontend@0.5.25

## 0.2.7

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24

## 0.2.6

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23

## 0.2.5

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22

## 0.2.4

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/auth-frontend@0.5.21

## 0.2.3

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20

## 0.2.2

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/auth-frontend@0.5.19

## 0.2.1

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
  - @checkstack/announcement-common@0.2.1
  - @checkstack/signal-frontend@0.0.15

## 0.2.0

### Minor Changes

- dee86ec: feat: add portal announcement system

  Introduces a complete announcement system for communicating with portal users:

  - **announcement-common**: Zod schemas for announcements (severity, visibility, display mode), oRPC contract with 6 procedures (public retrieval, user dismissal, admin CRUD), access rules, and `ANNOUNCEMENT_UPDATED` signal definition
  - **announcement-backend**: Drizzle schema with `announcements` and `announcement_dismissals` tables, router with temporal filtering, visibility control, per-user dismissal persistence, user cleanup hook, real-time signal broadcasting on create/update/delete, and command palette registration ("Create Announcement", "Manage Announcements" with `⇧⌘A` shortcut)
  - **announcement-frontend**: Admin management page with create/edit dialog, global banner component above the navbar (severity-colored, expandable markdown), dashboard cards with compact expand/collapse, admin menu link, and real-time WebSocket signal subscription for instant UI updates
  - **frontend**: Integrates AnnouncementBanner into App.tsx for global visibility

### Patch Changes

- Updated dependencies [dee86ec]
  - @checkstack/announcement-common@0.2.0
