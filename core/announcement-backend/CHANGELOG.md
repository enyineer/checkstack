# @checkstack/announcement-backend

## 0.3.8

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/auth-backend@0.4.28
  - @checkstack/cache-api@0.3.3
  - @checkstack/command-backend@0.1.28
  - @checkstack/cache-utils@0.2.8

## 0.3.7

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/auth-backend@0.4.27
  - @checkstack/command-backend@0.1.27
  - @checkstack/cache-api@0.3.2
  - @checkstack/cache-utils@0.2.7

## 0.3.6

### Patch Changes

- Updated dependencies [9016526]
- Updated dependencies [080627f]
  - @checkstack/common@0.10.0
  - @checkstack/announcement-common@0.4.0
  - @checkstack/auth-backend@0.4.26
  - @checkstack/backend-api@0.15.2
  - @checkstack/command-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 0.3.5

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/announcement-common@0.3.2
  - @checkstack/auth-backend@0.4.25
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/signal-common@0.2.2
  - @checkstack/cache-utils@0.2.5

## 0.3.4

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/announcement-common@0.3.1
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/auth-backend@0.4.24
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/signal-common@0.2.1

## 0.3.3

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/auth-backend@0.4.23
  - @checkstack/cache-api@0.2.3
  - @checkstack/command-backend@0.1.23
  - @checkstack/announcement-common@0.3.0
  - @checkstack/cache-utils@0.2.3
  - @checkstack/common@0.7.0
  - @checkstack/signal-common@0.2.0

## 0.3.2

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-backend@0.4.22
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/cache-utils@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/announcement-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/auth-backend@0.4.21
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
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
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/announcement-common@0.2.2
  - @checkstack/auth-backend@0.4.20
  - @checkstack/command-backend@0.1.20
  - @checkstack/signal-common@0.1.10

## 0.2.5

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-backend@0.4.19

## 0.2.4

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/auth-backend@0.4.18
  - @checkstack/command-backend@0.1.19

## 0.2.3

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/auth-backend@0.4.17
  - @checkstack/announcement-common@0.2.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/signal-common@0.1.9

## 0.2.2

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16
  - @checkstack/command-backend@0.1.17

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/auth-backend@0.4.15
- @checkstack/command-backend@0.1.16

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
