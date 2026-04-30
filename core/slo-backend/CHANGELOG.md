# @checkstack/slo-backend

## 0.3.2

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/healthcheck-backend@1.0.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/queue-api@0.2.16
  - @checkstack/slo-common@0.3.1
  - @checkstack/cache-utils@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/dependency-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/slo-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/healthcheck-backend@0.18.1
  - @checkstack/integration-backend@0.1.21
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/queue-api@0.2.15
  - @checkstack/cache-utils@0.2.1

## 0.3.0

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
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/healthcheck-backend@0.18.0
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/dependency-common@0.2.3
  - @checkstack/integration-backend@0.1.20
  - @checkstack/integration-common@0.2.9
  - @checkstack/signal-common@0.1.10
  - @checkstack/slo-common@0.2.2
  - @checkstack/queue-api@0.2.14

## 0.2.16

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/healthcheck-backend@0.17.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2
  - @checkstack/slo-common@0.2.1
  - @checkstack/catalog-backend@0.6.1

## 0.2.15

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0

## 0.2.14

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.13

### Patch Changes

- @checkstack/catalog-backend@0.5.4
- @checkstack/healthcheck-backend@0.16.4

## 0.2.12

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3
  - @checkstack/catalog-backend@0.5.3

## 0.2.11

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2
  - @checkstack/catalog-backend@0.5.2

## 0.2.10

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/healthcheck-backend@0.16.1

## 0.2.9

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0
  - @checkstack/catalog-backend@0.5.0

## 0.2.8

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/healthcheck-backend@0.15.1

## 0.2.7

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0
  - @checkstack/catalog-backend@0.4.3

## 0.2.6

### Patch Changes

- @checkstack/catalog-backend@0.4.2
- @checkstack/healthcheck-backend@0.14.3

## 0.2.5

### Patch Changes

- 86bab6a: ### GitOps: Fix authentication token handling

  - Made `authToken` optional in `ReconcileProviderParams` and `ScraperOptions` to support unauthenticated access to public repositories
  - GitHub and GitLab scrapers now conditionally set authentication headers only when a token is provided
  - Sync worker now decrypts the encrypted `authToken` from the database before passing it to scrapers, fixing authentication failures caused by sending encrypted values in HTTP headers

  ### SLO: Fix premature Nines Club achievement unlock

  - The "Nines Club" achievement now requires both ≥99.99% availability **and** a 365-day compliance streak, preventing immediate unlock on newly created SLOs with 100% default availability

  ### SLO: Align frontend achievement descriptions with backend criteria

  - Fixed mismatched descriptions for Iron Uptime (7-day, not 30), Diamond Uptime (30-day, not 90), Clean Sheet (rolling window, not quarter), Full Coverage (3+ SLOs, not all systems in group), and Nines Club (99.99%)

  ### SLO: Enrich milestones with system names

  - The `getRecentMilestones` endpoint now resolves human-readable system names via the Catalog API instead of returning raw system IDs
  - @checkstack/catalog-backend@0.4.1
  - @checkstack/healthcheck-backend@0.14.2

## 0.2.4

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/healthcheck-backend@0.14.1

## 0.2.3

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.2

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.1

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24
  - @checkstack/command-backend@0.1.19
  - @checkstack/integration-backend@0.1.19
  - @checkstack/queue-api@0.2.13

## 0.2.0

### Minor Changes

- 3c34b07: Complete SLO Reliability Engine frontend and backend

  **Frontend** — 7 new visualization components:

  - `StreakCounter`: Fire-themed compliance streak counter with color-coded flame and best-streak trophy
  - `AchievementBadge`: Emoji-labeled badges for 9 achievement types with hover tooltip
  - `AttributionChart`: Horizontal stacked bar showing error budget split (self/upstream/remaining)
  - `DowntimeTimeline`: Dot-and-line timeline with attribution badges and timestamps
  - `SloTrendChart`: Pure SVG availability trend line chart from daily snapshots
  - `MilestoneFeed`: Organization-wide milestone feed on the SLO overview sidebar
  - `DependencyExclusionConfig`: Interactive upstream dependency picker for SLO editor

  **Backend** — Weekly digest scheduled integration event:

  - `weekly-digest.ts`: Cron job (Monday 09:00 UTC) emitting SLO performance summary
  - Top/worst performers, breach counts, and streak data delivered via configured notification channels
  - New `sloWeeklyDigest` hook registered as integration event

### Patch Changes

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/healthcheck-backend@0.12.1
  - @checkstack/integration-backend@0.1.18
  - @checkstack/slo-common@0.2.0
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/dependency-common@0.2.1
  - @checkstack/integration-common@0.2.8
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12
