# @checkstack/healthcheck-backend

## 1.1.0

### Minor Changes

- 7c97b43: Backfill missing package bumps for the `/rest` mount PR — these packages were
  modified in that change but were not declared in its changeset:

  - `@checkstack/api-docs-frontend`: schema renderer rewrite (`additionalProperties`,
    `$ref` resolution, `oneOf`/`anyOf`/`allOf`, nullable unions, `format`
    qualifiers) and the new path/query/header/cookie parameters table for GET
    endpoints.
  - `@checkstack/frontend`: Vite dev-server proxy for `/rest/*` so external REST
    clients pointing at the Vite port resolve to the backend.
  - `@checkstack/healthcheck-backend`: router handler now unpacks `input.systemId`
    after `getSystemConfigurations` was refactored from `.input(z.string())` to
    `.input(z.object({ systemId: z.string() }))`.

  No behavior change beyond what the original PR already shipped.

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/maintenance-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/satellite-backend@0.3.1
  - @checkstack/backend-api@0.15.2
  - @checkstack/catalog-backend@1.1.1
  - @checkstack/command-backend@0.1.26
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/integration-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 1.0.4

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/satellite-backend@0.3.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/maintenance-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/catalog-backend@1.1.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/integration-backend@0.1.25
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2
  - @checkstack/cache-utils@0.2.5

## 1.0.3

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
  - @checkstack/backend-api@0.15.0
  - @checkstack/catalog-backend@1.0.2
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/gitops-backend@0.2.8
  - @checkstack/gitops-common@0.2.2
  - @checkstack/maintenance-common@1.0.1
  - @checkstack/queue-api@0.2.18
  - @checkstack/satellite-backend@0.2.21
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/incident-common@1.0.1
  - @checkstack/integration-backend@0.1.24
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 1.0.2

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/catalog-backend@1.0.1
  - @checkstack/command-backend@0.1.23
  - @checkstack/gitops-backend@0.2.7
  - @checkstack/integration-backend@0.1.23
  - @checkstack/queue-api@0.2.17
  - @checkstack/satellite-backend@0.2.20
  - @checkstack/cache-utils@0.2.3
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/gitops-common@0.2.1
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 1.0.1

### Patch Changes

- 2a749d3: fix: run afterPluginsReady in topological order; merge daily rollups on conflict

  Two resilience fixes for the dependency chain:

  1. **Plugin loader**: Phase 3 (`afterPluginsReady`) now iterates plugins
     in the same topologically-sorted order as Phase 2 (`init`). Previously
     it iterated `pendingInits` in registration order, which raced
     subscription-spec dependencies — catalog's afterPluginsReady registers
     `catalog.system` and `catalog.group` notification targets, and emitting
     plugins (incident, maintenance, …) call `registerSubscriptionSpec`
     against those targets in their own afterPluginsReady. With registration
     order, an emitter could run before catalog and hit
     `Target type catalog.group is not registered`. Sorted order encodes
     the dependency via `spec.target.ownerPlugin`, so the emitter now
     always runs after the target owner.

  2. **Healthcheck retention job**: the daily rollup now upserts
     `health_check_aggregates` with `ON CONFLICT DO UPDATE` instead of a
     plain insert. Previously, late-arriving hourly aggregates (e.g. from
     a satellite that was offline when the prior rollup ran) would crash
     the rollup with a unique-constraint violation on
     `(configuration_id, system_id, bucket_start, bucket_size, source_id)`.
     The merge sums counts and folds min/max/p95 into the existing daily
     row.

  - @checkstack/satellite-backend@0.2.19

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
- Updated dependencies [32d52c6]
  - @checkstack/gitops-backend@0.2.6
  - @checkstack/integration-backend@0.1.22
  - @checkstack/satellite-backend@0.2.18
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/queue-api@0.2.16
  - @checkstack/cache-utils@0.2.2

## 0.18.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/maintenance-common@0.5.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/integration-backend@0.1.21
  - @checkstack/satellite-backend@0.2.17
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/gitops-backend@0.2.5
  - @checkstack/queue-api@0.2.15
  - @checkstack/cache-utils@0.2.1

## 0.18.0

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

- 8d1ef12: ## Per-entity caching with single-flight + safe invalidation across the dashboard hot paths

  ### `@checkstack/cache-api`

  - **Breaking** for backend implementors: `CacheProvider` now requires `deleteByPrefix(prefix: string): Promise<number>` for family-level invalidation. The in-memory provider implements it; downstream providers (Redis, etc.) must add it before upgrading.
  - `createScopedCache` forwards `deleteByPrefix` and keeps prefixes scoped to the calling plugin.

  ### `@checkstack/cache-utils` (new package)

  High-level read-through caching helpers built on `CacheProvider`:

  - `createCachedScope({ cacheManager, pluginId })` returns a scope with `wrap`, `wrapMany`, `invalidate`, and `invalidatePrefix`.
  - **Single-flight**: concurrent cache misses for the same key share one loader.
  - **Per-entity bulk caching** via `wrapMany` so list/bulk RPCs cache by id rather than by the full input shape — overlapping callers share entries and invalidation stays exact.
  - **Race-safe invalidation** via per-key epoch counters: a loader started before a mutation cannot repopulate the cache with stale data after the mutation invalidates it. The mutation invariant is `db.write → cache.invalidate (await) → signals.emit`.
  - Cache failures fall through to the loader so a cache outage cannot break reads.

  ### `@checkstack/backend`

  - The internal null `CacheProvider` (used when no cache backend is configured) now implements the new `deleteByPrefix` method as a no-op. Patch bump only — no behavior change for existing callers.

  ### `@checkstack/healthcheck-backend`

  - `getSystemHealthStatus` and `getBulkSystemHealthStatus` now read through a per-system cache (`healthcheck:status:<systemId>`), eliminating N database queries per dashboard refresh for unchanged systems.
  - Mutation paths (configuration CRUD, system associations, satellite ingest, queue-driven check runs, system/satellite removal hooks) invalidate affected keys before broadcasting their signals so frontend refetches always observe fresh data.

  ### `@checkstack/incident-backend`

  - `listIncidents`, `getIncident`, `getIncidentsForSystem`, and `getBulkIncidentsForSystems` now read through a scoped cache:
    - per-incident at `incident:<id>`
    - per-system at `system:<systemId>`
    - per-filter-shape at `list:<stable-stringify(filters)>` for the few list shapes the dashboard polls
  - Mutations (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident`) invalidate the incident, every affected system, and every cached list before broadcasting `INCIDENT_UPDATED`.
  - The catalog `systemDeleted` cleanup hook drops that system's cached entries.

  ### `@checkstack/maintenance-backend`

  - `listMaintenances`, `getMaintenance`, `getMaintenancesForSystem`, and `getBulkMaintenancesForSystems` use the same per-entity / per-system / per-filter-shape pattern as incidents.
  - Mutations (`createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`, `deleteMaintenance`) invalidate before broadcasting `MAINTENANCE_UPDATED`.

  ### `@checkstack/catalog-backend`

  - Topology reads (`getEntities`, `getSystems`, `getSystem`, `getGroups`, `getSystemGroupIds`) cache under the `entity:` family (25s TTL).
  - Views (`getViews`) and per-system contacts (`getSystemContacts`) cache in their own families.
  - System / group / membership mutations drop the entire `entity:` family (every reader joins the same tables); view and contact mutations drop only their respective scopes.

  ### `@checkstack/slo-backend`

  - `listObjectives`, `getObjective`, `getObjectivesForSystem`, and `getBulkObjectivesForSystems` cache results including the expensive `engine.computeStatus` output.
  - Per-entity caching for the bulk handler so dashboards with overlapping system sets share entries.
  - Mutations (`createObjective`, `updateObjective`, `deleteObjective`) invalidate before broadcasting `SLO_STATUS_CHANGED`.

  ### `@checkstack/anomaly-backend`

  - New `router-cache.ts` adds a cache scope distinct from the existing detector baseline cache, keyed by stable filter hash.
  - `getAnomalies` and `getAnomalyBaselines` cache through this scope (15s TTL).
  - The detector invalidates the router cache before broadcasting `ANOMALY_STATE_CHANGED` on every state transition (suspicious/anomaly/recovered).
  - Config mutations also invalidate.

  ### `@checkstack/notification-backend`

  - `getUnreadCount`, `getNotifications`, and `getSubscriptions` cache per-user.
  - `markAsRead`, `deleteNotification`, `notifyUsers`, and `notifyGroups` invalidate every affected user's cache before sending realtime signals to that user.
  - `subscribe` and `unsubscribe` invalidate the user's subscription cache.

  ### `@checkstack/announcement-backend`

  - `getActiveAnnouncements` caches per-user (or anonymous) and per-`includeDismissed` flag (45s TTL — admin-driven, slowly changing).
  - `listAllAnnouncements` caches under a single key.
  - `dismissAnnouncement` only drops that user's cache; `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` drop every user's cache before broadcasting `ANNOUNCEMENT_UPDATED`.
  - The auth `userDeleted` cleanup hook drops that user's cached entries.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/satellite-backend@0.2.16
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/gitops-backend@0.2.4
  - @checkstack/gitops-common@0.2.1
  - @checkstack/incident-common@0.4.9
  - @checkstack/integration-backend@0.1.20
  - @checkstack/maintenance-common@0.4.11
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.17.1

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.
  - @checkstack/catalog-common@1.5.1
  - @checkstack/incident-common@0.4.8
  - @checkstack/maintenance-common@0.4.10
  - @checkstack/satellite-backend@0.2.15
  - @checkstack/catalog-backend@0.6.1

## 0.17.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0
  - @checkstack/satellite-backend@0.2.14

## 0.16.5

### Patch Changes

- 9a320fe: Fixed an issue where GitOps-provisioned health checks were not added to the background execution queue immediately upon association.
  - @checkstack/satellite-backend@0.2.13

## 0.16.4

### Patch Changes

- Updated dependencies [adc89a8]
  - @checkstack/gitops-backend@0.2.3
  - @checkstack/catalog-backend@0.5.4
  - @checkstack/satellite-backend@0.2.12

## 0.16.3

### Patch Changes

- b53a40e: Fix GitOps entity update failures due to pending error records

  - Ensured the `existingEntityId` parameter in the Reconciler engine is set to `undefined` instead of a `"pending-UUID"` when handling entities that failed to sync initially.
  - Hardened the `Healthcheck` GitOps kind logic to explicitly ignore `"pending-"` IDs, preventing SQL update errors on synthetic provenance IDs.
  - Fixed a bug where resolving YAML syntax errors would cause the subsequent sync to fail with `failed query: update [...]` because it attempted to update the nonexistent `"pending-"` entity instead of creating a new one.

- Updated dependencies [b53a40e]
  - @checkstack/gitops-backend@0.2.2
  - @checkstack/catalog-backend@0.5.3
  - @checkstack/satellite-backend@0.2.11

## 0.16.2

### Patch Changes

- 57d54de: Fix GitOps Healthcheck reconciliation engine and Kind Registry UI

  - Mandated fully qualified IDs for all healthcheck strategies and collector definitions.
  - Refactored the Kind Registry UI to display schema documentation in beautifully formatted, interactive YAML examples.
  - Entity Envelope Fields and Base Spec Schema are now displayed in collapsed accordions.
  - Fixed condition logic that broke the collector documentation display.
  - Enhanced UX by dynamically injecting fully-qualified strategy variants directly into the YAML examples.

- Updated dependencies [57d54de]
  - @checkstack/gitops-backend@0.2.1
  - @checkstack/catalog-backend@0.5.2
  - @checkstack/satellite-backend@0.2.10

## 0.16.1

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/satellite-backend@0.2.9

## 0.16.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/catalog-backend@0.5.0
  - @checkstack/satellite-backend@0.2.8

## 0.15.1

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/satellite-backend@0.2.7

## 0.15.0

### Minor Changes

- 8ef367a: Added `registerSpecSchemaDocumentation` to EntityKindRegistry to allow plugins to provide detailed JSON Schemas for specific configurations. The frontend now displays these registered schemas as dropdown alternatives, improving the developer experience when authoring GitOps configurations.

### Patch Changes

- cb65e9d: ### Schema-driven secret resolution, rotation invalidation, and security hardening

  **Breaking**: Replaced `{ secretRef: "..." }` object syntax with `${{ secrets.NAME }}` template interpolation. The `secretField()`, `secretRefSchema`, `isSecretRef`, `SecretRef`, and `ResolvedSecretField` exports have been removed from `@checkstack/gitops-common`.

  **Breaking**: `ReconcileContext.resolveSecretsBySchema()` now returns `{ resolved: T; warnings: string[] }` instead of `T` directly. Plugins must destructure the result. Warnings contain messages for `${{ secrets.NAME }}` templates found in non-secret fields (fields without `x-secret` annotation).

  **New features**:

  - Secrets can be referenced in **any string field** using `${{ secrets.NAME }}` syntax
  - Inline interpolation is supported: `"postgres://user:${{ secrets.DB_PASS }}@host/db"`
  - Resolution is **schema-driven** — reuses the existing `configString({ "x-secret": true })` pattern from DynamicForm
  - Secret rotation now automatically invalidates affected entities, triggering re-reconciliation on the next sync cycle
  - New `getSecretUsage` RPC endpoint to look up which entities reference a given secret
  - Secrets UI now shows an expandable usage panel per secret showing referencing entities
  - Reconciliation warnings: templates in non-secret fields are detected and surfaced in the provenance UI
  - New `secretNameSchema` and `SECRET_NAME_REGEX` exports for validating secret names

  **Security**:

  - Secret names are validated at creation: must start with a letter, contain only `[a-zA-Z0-9_-]`, max 63 chars
  - Secrets are validated to exist at sync time but **not pre-resolved** into the spec
  - Templates in `metadata` fields are **rejected** to prevent secret leaks via display fields
  - Only fields with `x-secret` schema annotations get resolved — no escape hatch
  - Templates in non-secret fields emit warnings (stored in provenance, visible in UI) instead of silently passing

  **Migration**: Update YAML descriptors to use `${{ secrets.NAME }}` instead of `secretRef: name`. Remove `secretField()` imports from plugin schemas — use `configString({ "x-secret": true })` to annotate secret fields. Destructure `const { resolved } = await context.resolveSecretsBySchema({ value, schema })` (return type changed from `T` to `{ resolved: T; warnings: string[] }`).

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-common@0.2.0
  - @checkstack/gitops-backend@0.2.0
  - @checkstack/catalog-backend@0.4.3
  - @checkstack/satellite-backend@0.2.6

## 0.14.3

### Patch Changes

- Updated dependencies [79cf5f8]
  - @checkstack/gitops-backend@0.1.2
  - @checkstack/catalog-backend@0.4.2
  - @checkstack/satellite-backend@0.2.5

## 0.14.2

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-backend@0.1.1
  - @checkstack/gitops-common@0.1.1
  - @checkstack/catalog-backend@0.4.1
  - @checkstack/satellite-backend@0.2.4

## 0.14.1

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/satellite-backend@0.2.3

## 0.14.0

### Minor Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/gitops-backend@0.1.0
  - @checkstack/gitops-common@0.1.0
  - @checkstack/satellite-backend@0.2.2

## 0.13.1

### Patch Changes

- aa2b3aa: fix: remove arbitrary hardcoded assertions in jenkins collectors (queue-info, node-health, job-status) to prevent silent fallback assertion failures, instead properly threading transport execution errors directly to the SingleRunChartGrid UI display widget via a new `_collectorError` result payload property.
  - @checkstack/satellite-backend@0.2.1

## 0.13.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

- 26d8bae: Source attribution and filtering for satellite health checks

  **Source Attribution**

  - Fixed satellite result attribution: runs from satellites now correctly display their source instead of defaulting to "Local"
  - Added `sourceId` and `sourceLabel` to both public and detailed history API responses

  **Source Filtering**

  - Added `sourceFilter` parameter to `getHistory`, `getDetailedHistory`, and `getDetailedAggregatedHistory` RPC endpoints
  - Source filter supports "local" (core-only), specific satellite UUID, or all sources
  - Filter applies to all three aggregation tiers (raw, hourly, daily)

  **Frontend**

  - System detail accordion shows source filter buttons (All / Local / per-satellite) next to date range filter
  - Filter applies to both charts and recent runs table
  - Source column added to the recent runs table with Local/Remote badges
  - Health check history detail page includes per-satellite source filter buttons

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/satellite-backend@0.2.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24
  - @checkstack/command-backend@0.1.19
  - @checkstack/integration-backend@0.1.19
  - @checkstack/queue-api@0.2.13

## 0.12.1

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
  - @checkstack/integration-backend@0.1.18
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/incident-common@0.4.7
  - @checkstack/maintenance-common@0.4.9
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.12.0

### Minor Changes

- 54a5f80: ### Health Check Editor Redesign — IDE-Style Experience

  Replaces the modal-based health check editor with a full-page, IDE-style experience:

  - **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
  - **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
  - **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
  - **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
  - **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
  - **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
  - **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
  - **Responsive Design**: Split-view on desktop, stacked layout on mobile
  - **Deleted**: Legacy `HealthCheckEditor.tsx` modal component

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/backend-api@0.11.0
  - @checkstack/catalog-backend@0.2.22
  - @checkstack/command-backend@0.1.17
  - @checkstack/integration-backend@0.1.17
  - @checkstack/queue-api@0.2.11

## 0.11.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/catalog-backend@0.2.21
  - @checkstack/command-backend@0.1.16
  - @checkstack/integration-backend@0.1.16
  - @checkstack/queue-api@0.2.10

## 0.10.7

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/catalog-backend@0.2.20
  - @checkstack/command-backend@0.1.15
  - @checkstack/integration-backend@0.1.15
  - @checkstack/queue-api@0.2.9

## 0.10.6

### Patch Changes

- @checkstack/catalog-backend@0.2.19

## 0.10.5

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/catalog-backend@0.2.18
  - @checkstack/command-backend@0.1.14
  - @checkstack/integration-backend@0.1.14
  - @checkstack/queue-api@0.2.8
  - @checkstack/catalog-common@1.2.11

## 0.10.4

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/backend-api@0.8.2
  - @checkstack/catalog-backend@0.2.17
  - @checkstack/catalog-common@1.2.10
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/incident-common@0.4.6
  - @checkstack/integration-backend@0.1.13
  - @checkstack/maintenance-common@0.4.8
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-common@0.1.8

## 0.10.3

### Patch Changes

- @checkstack/catalog-backend@0.2.16

## 0.10.2

### Patch Changes

- @checkstack/catalog-common@1.2.9
- @checkstack/incident-common@0.4.5
- @checkstack/maintenance-common@0.4.7
- @checkstack/catalog-backend@0.2.15

## 0.10.1

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12
  - @checkstack/catalog-backend@0.2.14
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-backend@0.1.12
  - @checkstack/queue-api@0.2.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/incident-common@0.4.4
  - @checkstack/maintenance-common@0.4.6
  - @checkstack/signal-common@0.1.7

## 0.10.0

### Minor Changes

- 869b4ab: ## Health Check Execution Improvements

  ### Breaking Changes (backend-api)

  - `HealthCheckStrategy.createClient()` now accepts `unknown` instead of `TConfig` due to TypeScript contravariance constraints. Implementations should use `this.config.validate(config)` to narrow the type.

  ### Features

  - **Platform-level hard timeout**: The executor now wraps the entire health check execution (connection + all collectors) in a single timeout, ensuring checks never hang indefinitely.
  - **Parallel collector execution**: Collectors now run in parallel using `Promise.allSettled()`, improving performance while ensuring all collectors complete regardless of individual failures.
  - **Base strategy config schema**: All strategy configs now extend `baseStrategyConfigSchema` which provides a standardized `timeout` field with sensible defaults (30s, min 100ms).

  ### Fixes

  - Fixed HTTP and Jenkins strategies clearing timeouts before reading the full response body.
  - Simplified registry type signatures by using default type parameters.

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/catalog-backend@0.2.13
  - @checkstack/command-backend@0.1.11
  - @checkstack/integration-backend@0.1.11
  - @checkstack/queue-api@0.2.5

## 0.9.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/catalog-backend@0.2.12
  - @checkstack/command-backend@0.1.10
  - @checkstack/integration-backend@0.1.10
  - @checkstack/queue-api@0.2.4

## 0.8.3

### Patch Changes

- 48c2080: Migrate aggregation from batch to incremental (`mergeResult`)

  ### Breaking Changes (Internal)

  - Replaced `aggregateResult(runs[])` with `mergeResult(existing, run)` interface across all HealthCheckStrategy and CollectorStrategy implementations

  ### New Features

  - Added incremental aggregation utilities in `@checkstack/backend-api`:
    - `mergeCounter()` - track occurrences
    - `mergeAverage()` - track sum/count, compute avg
    - `mergeRate()` - track success/total, compute %
    - `mergeMinMax()` - track min/max values
  - Exported Zod schemas for internal state: `averageStateSchema`, `rateStateSchema`, `minMaxStateSchema`, `counterStateSchema`

  ### Improvements

  - Enables O(1) storage overhead by maintaining incremental aggregation state
  - Prepares for real-time hourly aggregation without batch accumulation

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/catalog-backend@0.2.11
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/incident-common@0.4.3
  - @checkstack/integration-backend@0.1.9
  - @checkstack/maintenance-common@0.4.5
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.8.2

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/incident-common@0.4.2
  - @checkstack/maintenance-common@0.4.4
  - @checkstack/catalog-backend@0.2.10

## 0.8.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-backend@0.2.9
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/incident-common@0.4.1
  - @checkstack/integration-backend@0.1.8
  - @checkstack/maintenance-common@0.4.3
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-common@0.1.5

## 0.8.0

### Minor Changes

- d6f7449: Add availability statistics display to HealthCheckSystemOverview

  - New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
  - Availability is calculated as `(healthyRuns / totalRuns) * 100`
  - Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
  - Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
  - Shows total run counts for each period

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.7.0

### Minor Changes

- 1f81b60: ### Clickable Run History with Deep Linking

  **Backend (`healthcheck-backend`):**

  - Added `getRunById` service method to fetch a single health check run by ID

  **Schema (`healthcheck-common`):**

  - Added `getRunById` RPC procedure for fetching individual runs
  - Added `historyRun` route for deep linking to specific runs (`/history/:systemId/:configurationId/:runId`)

  **Frontend (`healthcheck-frontend`):**

  - Table rows in Recent Runs and Run History now navigate to detailed view instead of expanding inline
  - Added "Selected Run" card that displays when navigating to a specific run
  - Extracted `ExpandedResultView` into reusable component
  - Fixed layout shift during table pagination by preserving previous data while loading
  - Removed accordion expansion in favor of consistent navigation UX

### Patch Changes

- 090143b: ### Health Check Aggregation & UI Fixes

  **Backend (`healthcheck-backend`):**

  - Fixed tail-end bucket truncation where the last aggregated bucket was cut off at the interval boundary instead of extending to the query end date
  - Added `rangeEnd` parameter to `reaggregateBuckets()` to properly extend the last bucket
  - Fixed cross-tier merge logic (`mergeTieredBuckets`) to prevent hourly aggregates from blocking fresh raw data

  **Schema (`healthcheck-common`):**

  - Added `bucketEnd` field to `AggregatedBucketBaseSchema` so frontends know the actual end time of each bucket

  **Frontend (`healthcheck-frontend`):**

  - Updated all components to use `bucket.bucketEnd` instead of calculating from `bucketIntervalSeconds`
  - Fixed aggregation mode detection: changed `>` to `>=` so 7-day queries use aggregated data when `rawRetentionDays` is 7
  - Added ref-based memoization in `useHealthCheckData` to prevent layout shift during signal-triggered refetches
  - Exposed `isFetching` state to show loading spinner during background refetches
  - Added debounced custom date range with Apply button to prevent fetching on every field change
  - Added validation preventing start date >= end date in custom ranges
  - Added sparkline downsampling: when there are 60+ data points, they are aggregated into buckets with informative tooltips

  **UI (`ui`):**

  - Fixed `DateRangeFilter` presets to use true sliding windows (removed `startOfDay` from 7-day and 30-day ranges)
  - Added `disabled` prop to `DateRangeFilter` and `DateTimePicker` components
  - Added `onCustomChange` prop to `DateRangeFilter` for debounced custom date handling
  - Improved layout: custom date pickers now inline with preset buttons on desktop
  - Added responsive mobile layout: date pickers stack vertically with down arrow
  - Added validation error display for invalid date ranges

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0

## 0.6.0

### Minor Changes

- 11d2679: Add ability to pause health check configurations globally. When paused, health checks continue to be scheduled but execution is skipped for all systems using that configuration. Users with manage access can pause/resume from the Health Checks config page.
- cce5453: Add notification suppression for incidents

  - Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
  - When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
  - Mirrors the existing maintenance notification suppression pattern
  - Added toggle UI in the IncidentEditor dialog
  - Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries

### Patch Changes

- Updated dependencies [11d2679]
- Updated dependencies [cce5453]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/incident-common@0.4.0

## 0.5.0

### Minor Changes

- 095cf4e: ### Cross-Tier Data Aggregation

  Implements intelligent cross-tier querying for health check history, enabling seamless data retrieval across raw, hourly, and daily storage tiers.

  **What changed:**

  - `getAggregatedHistory` now queries all three tiers (raw, hourly, daily) in parallel
  - Added `NormalizedBucket` type for unified bucket format across tiers
  - Added `mergeTieredBuckets()` to merge data with priority (raw > hourly > daily)
  - Added `combineBuckets()` and `reaggregateBuckets()` for re-aggregation to target bucket size
  - Raw data preserves full granularity when available (uses target bucket interval)

  **Why:**

  - Previously, the API only queried raw runs, which are retained for a limited period (default 7 days)
  - For longer time ranges, data was missing because hourly/daily aggregates weren't queried
  - The retention job only runs periodically, so we can't assume tier boundaries based on config
  - Querying all tiers ensures no gaps in data coverage

  **Technical details:**

  - Additive metrics (counts, latencySum) are summed correctly for accurate averages
  - p95 latency uses max of source p95s as conservative upper-bound approximation
  - `aggregatedResult` (strategy-specific) is preserved for raw-only buckets

- ac3a4cf: ### Dynamic Bucket Sizing for Health Check Visualization

  Implements industry-standard dynamic bucket sizing for health check data aggregation, following patterns from Grafana/VictoriaMetrics.

  **What changed:**

  - Replaced fixed `bucketSize: "hourly" | "daily" | "auto"` with dynamic `targetPoints` parameter (default: 500)
  - Bucket interval is now calculated as `(endDate - startDate) / targetPoints` with a minimum of 1 second
  - Added `bucketIntervalSeconds` to aggregated response and individual buckets
  - Updated chart components to use dynamic time formatting based on bucket interval

  **Why:**

  - A 24-hour view with 1-second health checks previously returned 86,400+ data points, causing lag
  - Now returns ~500 data points regardless of timeframe, ensuring consistent chart performance
  - Charts still preserve visual fidelity through proper aggregation

  **Breaking Change:**

  - `bucketSize` parameter removed from `getAggregatedHistory` and `getDetailedAggregatedHistory` endpoints
  - Use `targetPoints` instead (defaults to 500 if not specified)

  ***

  ### Collector Aggregated Charts Fix

  Fixed issue where collector auto-charts (like HTTP request response time charts) were not showing in aggregated data mode.

  **What changed:**

  - Added `aggregatedResultSchema` to `CollectorDtoSchema`
  - Backend now returns collector aggregated schemas via `getCollectors` endpoint
  - Frontend `useStrategySchemas` hook now merges collector aggregated schemas
  - Service now calls each collector's `aggregateResult()` when building buckets
  - Aggregated collector data stored in `aggregatedResult.collectors[uuid]`

  **Why:**

  - Previously only strategy-level aggregated results were computed
  - Collectors like HTTP Request Collector have their own `aggregateResult` method
  - Without calling these, fields like `avgResponseTimeMs` and `successRate` were missing from aggregated buckets

- db1f56f: Add ephemeral field stripping to reduce database storage for health checks

  - Added `x-ephemeral` metadata flag to `HealthResultMeta` for marking fields that should not be persisted
  - All health result factory functions (`healthResultString`, `healthResultNumber`, `healthResultBoolean`, `healthResultArray`, `healthResultJSONPath`) now accept `x-ephemeral`
  - Added `stripEphemeralFields()` utility to remove ephemeral fields before database storage
  - Integrated ephemeral field stripping into `queue-executor.ts` for all collector results
  - HTTP Request collector now explicitly marks `body` as ephemeral

  This significantly reduces database storage for health checks with large response bodies, while still allowing assertions to run against the full response at execution time.

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-backend@0.2.8
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/integration-backend@0.1.7
  - @checkstack/maintenance-common@0.4.2
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.4.2

### Patch Changes

- 66a3963: Fix 500 error on `getDetailedAggregatedHistory` and update to SafeDatabase type

  - Fixed runtime error caused by usage of Drizzle relational query API (`db.query`) in `getAggregatedHistory`
  - Replaced `db.query.healthCheckConfigurations.findFirst()` with standard `db.select()` query
  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase`

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/catalog-backend@0.2.7
  - @checkstack/integration-backend@0.1.6
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.4.1

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/maintenance-common@0.4.1
  - @checkstack/catalog-backend@0.2.6
  - @checkstack/command-backend@0.1.5
  - @checkstack/integration-backend@0.1.5
  - @checkstack/queue-api@0.1.3
  - @checkstack/signal-common@0.1.3

## 0.4.0

### Minor Changes

- 18fa8e3: Add notification suppression toggle for maintenance windows

  **New Feature:** When creating or editing a maintenance window, you can now enable "Suppress health notifications" to prevent health status change notifications from being sent for affected systems while the maintenance is active (in_progress status). This is useful for planned downtime where health alerts are expected and would otherwise create noise.

  **Changes:**

  - Added `suppressNotifications` field to maintenance schema
  - Added new service-to-service API `hasActiveMaintenanceWithSuppression`
  - Healthcheck queue executor now checks for suppression before sending notifications
  - MaintenanceEditor UI includes new toggle checkbox

  **Bug Fix:** Fixed migration system to correctly set PostgreSQL search_path when running plugin migrations. Previously, migrations could fail with "relation does not exist" errors because the schema context wasn't properly set.

### Patch Changes

- db9b37c: Fixed 500 errors on healthcheck `getHistory` and `getDetailedHistory` endpoints caused by the scoped database proxy not handling Drizzle's `$count()` utility method.

  **Root Cause:** The `$count()` method returns a Promise directly (not a query builder), bypassing the chain-replay mechanism used for schema isolation. This caused queries to run without the proper `search_path`, resulting in database errors.

  **Changes:**

  - Added explicit `$count` method handling in `scoped-db.ts` to wrap count operations in transactions with proper schema isolation
  - Wrapped `$count` return values with `Number()` in healthcheck service to handle BigInt serialization

- Updated dependencies [18fa8e3]
  - @checkstack/maintenance-common@0.4.0

## 0.3.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/catalog-backend@0.2.5
  - @checkstack/command-backend@0.1.4
  - @checkstack/integration-backend@0.1.4
  - @checkstack/queue-api@0.1.2
  - @checkstack/catalog-common@1.2.2
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/signal-common@0.1.2

## 0.3.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/catalog-backend@0.2.4
  - @checkstack/command-backend@0.1.3
  - @checkstack/integration-backend@0.1.3
  - @checkstack/queue-api@0.1.1

## 0.3.3

### Patch Changes

- @checkstack/catalog-common@1.2.1
- @checkstack/catalog-backend@0.2.3

## 0.3.2

### Patch Changes

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

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/integration-backend@0.1.2
  - @checkstack/catalog-backend@0.2.2
  - @checkstack/command-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1
  - @checkstack/integration-backend@0.1.1
  - @checkstack/catalog-backend@0.2.1
  - @checkstack/command-backend@0.1.1

## 0.3.0

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
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/catalog-backend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/integration-backend@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.2.0

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

- 97c5a6b: Add UUID-based collector identification for better multiple collector support

  **Breaking Change**: Existing health check configurations with collectors need to be recreated.

  - Each collector instance now has a unique UUID assigned on creation
  - Collector results are stored under the UUID key with `_collectorId` and `_assertionFailed` metadata
  - Auto-charts correctly display separate charts for each collector instance
  - Charts are now grouped by collector instance with clear headings
  - Assertion status card shows pass/fail for each collector
  - Renamed "Success" to "HTTP Success" to clarify it's about HTTP request success
  - Fixed deletion of collectors not persisting to database
  - Fixed duplicate React key warnings in auto-chart grid

### Patch Changes

- 97c5a6b: Fix collector lookup when health check is assigned to a system

  Collectors are now stored in the registry with their fully-qualified ID format (ownerPluginId.collectorId) to match how they are referenced in health check configurations. Added `qualifiedId` field to `RegisteredCollector` interface to avoid re-constructing the ID at query time. This fixes the "Collector not found" warning that occurred when executing health checks with assigned systems.

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/integration-backend@0.0.4
  - @checkstack/queue-api@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.1.0

### Minor Changes

- f5b1f49: Extended health check system with per-collector assertion support.

  - Added `collectors` column to `healthCheckConfigurations` schema for storing collector configs
  - Updated queue-executor to run configured collectors and evaluate per-collector assertions
  - Added `CollectorAssertionSchema` to healthcheck-common for assertion validation
  - Results now stored with `metadata.collectors` containing per-collector result data

### Patch Changes

- f5b1f49: Added JSONPath assertions for response body validation and fully qualified strategy IDs.

  **JSONPath Assertions:**

  - Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
  - Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
  - Added `jsonPath` field to `CollectorAssertionSchema` for persistence
  - HTTP Request collector body field now supports JSONPath assertions

  **Fully Qualified Strategy IDs:**

  - HealthCheckRegistry now uses scoped factories like CollectorRegistry
  - Strategies are stored with `pluginId.strategyId` format
  - Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
  - Router returns qualified IDs so frontend can correctly fetch collectors

  **UI Improvements:**

  - Save button disabled when collector configs have invalid required fields
  - Fixed nested button warning in CollectorList accordion

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/catalog-backend@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.3

### Patch Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.2.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/catalog-common@0.1.2
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/signal-common@0.1.1

## 0.1.1

### Patch Changes

- @checkstack/catalog-common@0.1.1
- @checkstack/catalog-backend@0.0.3

## 0.1.0

### Minor Changes

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkstack/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkstack/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkstack/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkstack/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkstack/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- 0babb9c: Add public health status access and detailed history for admins

  **Permission changes:**

  - Added `healthcheck.status.read` permission with `isPublicDefault: true` for anonymous access
  - `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` now public
  - `getHistory` no longer returns `result` field (security)

  **New features:**

  - Added `getDetailedHistory` endpoint with `healthcheck.manage` permission
  - New `/healthcheck/history` page showing paginated run history with expandable result JSON

### Patch Changes

- e4d83fc: Add BullMQ queue plugin with orphaned job cleanup

  - **queue-api**: Added `listRecurringJobs()` method to Queue interface for detecting orphaned jobs
  - **queue-bullmq-backend**: New plugin implementing BullMQ (Redis) queue backend with job schedulers, consumer groups, and distributed job persistence
  - **queue-bullmq-common**: New common package with queue permissions
  - **queue-memory-backend**: Implemented `listRecurringJobs()` for in-memory queue
  - **healthcheck-backend**: Enhanced `bootstrapHealthChecks` to clean up orphaned job schedulers using `listRecurringJobs()`
  - **test-utils-backend**: Added `listRecurringJobs()` to mock queue factory

  This enables production-ready distributed queue processing with Redis persistence and automatic cleanup of orphaned jobs when health checks are deleted.

- 81f3f85: ## Breaking: Unified Versioned<T> Architecture

  Refactored the versioning system to use a unified `Versioned<T>` class instead of separate `VersionedSchema`, `VersionedData`, and `VersionedConfig` types.

  ### Breaking Changes

  - **`VersionedSchema<T>`** is replaced by `Versioned<T>` class
  - **`VersionedData<T>`** is replaced by `VersionedRecord<T>` interface
  - **`VersionedConfig<T>`** is replaced by `VersionedPluginRecord<T>` interface
  - **`ConfigMigration<F, T>`** is replaced by `Migration<F, T>` interface
  - **`MigrationChain<T>`** is removed (use `Migration<unknown, unknown>[]`)
  - **`migrateVersionedData()`** is removed (use `versioned.parse()`)
  - **`ConfigMigrationRunner`** is removed (migrations are internal to Versioned)

  ### Migration Guide

  Before:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: {
      version: 1,
      schema: mySchema,
      migrations: [],
    },
  };
  const data = await migrateVersionedData(stored, 1, migrations);
  ```

  After:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: new Versioned({
      version: 1,
      schema: mySchema,
      migrations: [],
    }),
  };
  const data = await strategy.config.parse(stored);
  ```

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/integration-backend@0.0.2
