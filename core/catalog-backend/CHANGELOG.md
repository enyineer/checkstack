# @checkstack/catalog-backend

## 1.1.2

### Patch Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

- Updated dependencies [b627562]
  - @checkstack/gitops-backend@0.3.2

## 1.1.1

### Patch Changes

- Updated dependencies [9016526]
- Updated dependencies [080627f]
  - @checkstack/common@0.10.0
  - @checkstack/auth-common@0.7.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/auth-backend@0.4.26
  - @checkstack/backend-api@0.15.2
  - @checkstack/command-backend@0.1.26
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/cache-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 1.1.0

### Minor Changes

- 1ef2e79: feat: hotlinks on incidents/maintenances and additional links on systems

  Users with `manage` access on an incident, maintenance, or system can now
  attach free-form URL "hotlinks" — Jira tickets, runbooks, dashboards, ticket
  tools, etc. — alongside the existing fields.

  - **Incidents** & **maintenances**: links live on the entity itself and are
    surfaced both in the editor dialog and on the public detail page. Two new
    RPC procedures per plugin (`addLink`, `removeLink`) gated behind the
    existing `manage` access rule. Links are returned as part of
    `getIncident` / `getMaintenance` and cache-invalidated on every link
    mutation.
  - **Systems**: a parallel `system_links` table with `getSystemLinks`,
    `addSystemLink`, `removeSystemLink` procedures. Surfaced inside the
    system editor (next to contacts) and on the read-only system detail
    sidebar. Cache-scoped per-system so list endpoints remain hot.
  - **Shared UI**: a `LinksEditor` component in `@checkstack/ui` does the
    presentation; the three plugins each own their own RPC wiring.

  Database changes ship as additive migrations (new `incident_links`,
  `maintenance_links`, `system_links` tables, all FK-cascaded on parent
  delete). No existing columns or rows are touched.

  The system incident and maintenance history pages now sort by relevance:
  active entries (non-`resolved` incidents, `scheduled` or `in_progress`
  maintenances) appear at the top, with creation date descending as the
  tiebreaker.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/auth-backend@0.4.25
  - @checkstack/auth-common@0.6.6
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/notification-common@1.0.2
  - @checkstack/cache-utils@0.2.5

## 1.0.2

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
  - @checkstack/auth-common@0.6.5
  - @checkstack/backend-api@0.15.0
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/gitops-backend@0.2.8
  - @checkstack/gitops-common@0.2.2
  - @checkstack/auth-backend@0.4.24
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/notification-common@1.0.1

## 1.0.1

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/auth-backend@0.4.23
  - @checkstack/cache-api@0.2.3
  - @checkstack/command-backend@0.1.23
  - @checkstack/gitops-backend@0.2.7
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-utils@0.2.3
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/gitops-common@0.2.1
  - @checkstack/notification-common@1.0.0

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

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/gitops-backend@0.2.6
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-backend@0.4.22
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/cache-utils@0.2.2

## 0.7.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/notification-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/auth-backend@0.4.21
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/gitops-backend@0.2.5
  - @checkstack/cache-utils@0.2.1

## 0.7.0

### Minor Changes

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
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/auth-backend@0.4.20
  - @checkstack/auth-common@0.6.3
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/gitops-backend@0.2.4
  - @checkstack/gitops-common@0.2.1
  - @checkstack/notification-common@0.2.9

## 0.6.1

### Patch Changes

- @checkstack/catalog-common@1.5.1

## 0.6.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0

## 0.5.4

### Patch Changes

- Updated dependencies [adc89a8]
  - @checkstack/gitops-backend@0.2.3

## 0.5.3

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/gitops-backend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/gitops-backend@0.2.1

## 0.5.1

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2
  - @checkstack/auth-backend@0.4.19
  - @checkstack/catalog-common@1.4.1

## 0.5.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

## 0.4.4

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0

## 0.4.3

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

## 0.4.2

### Patch Changes

- Updated dependencies [79cf5f8]
  - @checkstack/gitops-backend@0.1.2

## 0.4.1

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-backend@0.1.1
  - @checkstack/gitops-common@0.1.1

## 0.4.0

### Minor Changes

- b01078f: Added GitOps System kind extension for managing system group associations

## 0.3.0

### Minor Changes

- 6c40b5b: Register catalog System and Group as GitOps entity kinds

  - **catalog-backend**: Registers `kind: System` and `kind: Group` with the GitOps Entity Kind Registry. The catalog now supports declarative management via YAML descriptors in Git repositories. Systems and groups are reconciled using the `metadata.gitops_entity_name` marker for cross-sync identity lookup.
  - **gitops-backend**: Wires up the delete reconciler for orphan cleanup — both automatic deletion (via `deletionPolicy: "auto"`) and manual orphan confirmation now invoke the owning plugin's `delete()` handler before removing provenance entries.

- 6c40b5b: Generalized provenance system and GitOps frontend plugin

  **Breaking**: `EntityKindDefinition.reconcile()` now returns `{ entityId: string }` instead of `void`. Plugins must return the plugin-specific entity ID (e.g., catalog system UUID) so the engine can store it in provenance.

  - Added `entityId` column to the provenance table (non-nullable)
  - Reconciler engine passes `existingEntityId` to plugins for updates
  - `getProvenance` now supports lookup by `entityId` in addition to `entityName`
  - Added provider CRUD endpoints: `createProvider`, `updateProvider`, `deleteProvider`
  - Created `gitops-frontend` plugin with provider management, secret management, and sync status dashboard
  - Removed `gitops_entity_name` metadata markers from catalog entities
  - Removed `findSystemByGitOpsName`, `deleteSystemByGitOpsName` (and Group equivalents) from EntityService
  - Added provenance-based UI locking in catalog-frontend: edit/delete/drag disabled for GitOps-managed systems and groups

### Patch Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/gitops-backend@0.1.0
  - @checkstack/gitops-common@0.1.0

## 0.2.24

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/auth-backend@0.4.18
  - @checkstack/command-backend@0.1.19

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
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/auth-backend@0.4.17
  - @checkstack/catalog-common@1.3.1
  - @checkstack/auth-common@0.6.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/notification-common@0.2.8

## 0.2.22

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16
  - @checkstack/command-backend@0.1.17

## 0.2.21

### Patch Changes

- Updated dependencies [3f36a64]
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/auth-backend@0.4.15
  - @checkstack/command-backend@0.1.16

## 0.2.20

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/auth-backend@0.4.14
  - @checkstack/command-backend@0.1.15

## 0.2.19

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-backend@0.4.13

## 0.2.18

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-common@0.6.0
  - @checkstack/auth-backend@0.4.12
  - @checkstack/command-backend@0.1.14
  - @checkstack/catalog-common@1.2.11

## 0.2.17

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/auth-backend@0.4.11
  - @checkstack/auth-common@0.5.7
  - @checkstack/backend-api@0.8.2
  - @checkstack/catalog-common@1.2.10
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/notification-common@0.2.7

## 0.2.16

### Patch Changes

- Updated dependencies [eb353a4]
  - @checkstack/auth-backend@0.4.10

## 0.2.15

### Patch Changes

- @checkstack/catalog-common@1.2.9

## 0.2.14

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/auth-backend@0.4.9
  - @checkstack/auth-common@0.5.6
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-backend@0.1.12
  - @checkstack/notification-common@0.2.6

## 0.2.13

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/auth-backend@0.4.8
  - @checkstack/command-backend@0.1.11

## 0.2.12

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/auth-backend@0.4.7
  - @checkstack/command-backend@0.1.10

## 0.2.11

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-backend@0.4.6
  - @checkstack/auth-common@0.5.5
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/notification-common@0.2.5

## 0.2.10

### Patch Changes

- Updated dependencies [e5079e1]
  - @checkstack/catalog-common@1.2.6

## 0.2.9

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/notification-common@0.2.4

## 0.2.8

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/notification-common@0.2.3

## 0.2.7

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.2.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/command-backend@0.1.5
  - @checkstack/notification-common@0.2.2

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/command-backend@0.1.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/notification-common@0.2.1

## 0.2.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/command-backend@0.1.3

## 0.2.3

### Patch Changes

- @checkstack/catalog-common@1.2.1

## 0.2.2

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/command-backend@0.1.2

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/command-backend@0.1.1

## 0.2.0

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
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/notification-common@0.1.0

## 0.1.0

### Minor Changes

- 8e43507: BREAKING: `getSystems` now returns `{ systems: [...] }` instead of plain array

  This change enables resource-level access control filtering for the catalog plugin. The middleware needs a consistent object format with named keys to perform post-execution filtering on list endpoints.

  ## Breaking Changes

  - `getSystems()` now returns `{ systems: System[] }` instead of `System[]`
  - All call sites must update to destructure: `const { systems } = await api.getSystems()`

  ## New Features

  - Added `resourceAccess` metadata to catalog endpoints:
    - `getSystems`: List filtering by team access
    - `getSystem`: Single resource pre-check by team access
    - `getEntities`: List filtering for systems by team access

  ## Migration

  ```diff
  - const systems = await catalogApi.getSystems();
  + const { systems } = await catalogApi.getSystems();
  ```

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/notification-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/notification-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/notification-common@0.0.2

## 0.1.0

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

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/notification-common@0.1.1

## 0.0.3

### Patch Changes

- @checkstack/catalog-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/command-backend@0.0.2
