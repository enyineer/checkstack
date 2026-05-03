# @checkstack/dependency-backend

## 1.0.2

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/catalog-backend@1.0.1
  - @checkstack/healthcheck-backend@1.0.2
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [2a749d3]
  - @checkstack/healthcheck-backend@1.0.1

## 1.0.0

### Major Changes

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

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/healthcheck-backend@1.0.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/backend-api@0.14.0

## 0.3.3

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/dependency-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/maintenance-common@0.5.0
  - @checkstack/notification-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/healthcheck-backend@0.18.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1

## 0.3.2

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/healthcheck-backend@0.18.0
  - @checkstack/common@0.7.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/dependency-common@0.2.3
  - @checkstack/incident-common@0.4.9
  - @checkstack/maintenance-common@0.4.11
  - @checkstack/notification-common@0.2.9
  - @checkstack/signal-common@0.1.10

## 0.3.1

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/healthcheck-backend@0.17.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2
  - @checkstack/incident-common@0.4.8
  - @checkstack/maintenance-common@0.4.10
  - @checkstack/catalog-backend@0.6.1

## 0.3.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0

## 0.2.16

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.15

### Patch Changes

- @checkstack/catalog-backend@0.5.4
- @checkstack/healthcheck-backend@0.16.4

## 0.2.14

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3
  - @checkstack/catalog-backend@0.5.3

## 0.2.13

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2
  - @checkstack/catalog-backend@0.5.2

## 0.2.12

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/healthcheck-backend@0.16.1

## 0.2.11

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0
  - @checkstack/catalog-backend@0.5.0

## 0.2.10

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/healthcheck-backend@0.15.1

## 0.2.9

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0
  - @checkstack/catalog-backend@0.4.3

## 0.2.8

### Patch Changes

- @checkstack/catalog-backend@0.4.2
- @checkstack/healthcheck-backend@0.14.3

## 0.2.7

### Patch Changes

- @checkstack/catalog-backend@0.4.1
- @checkstack/healthcheck-backend@0.14.2

## 0.2.6

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/healthcheck-backend@0.14.1

## 0.2.5

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.4

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.3

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24

## 0.2.2

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
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/healthcheck-backend@0.12.1
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/dependency-common@0.2.1
  - @checkstack/incident-common@0.4.7
  - @checkstack/maintenance-common@0.4.9
  - @checkstack/signal-common@0.1.9

## 0.2.1

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/healthcheck-backend@0.12.0
  - @checkstack/backend-api@0.11.0
  - @checkstack/catalog-backend@0.2.22

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
  - @checkstack/healthcheck-backend@0.11.0
  - @checkstack/dependency-common@0.2.0
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/catalog-backend@0.2.21
