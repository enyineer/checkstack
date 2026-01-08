# @checkmate-monitor/healthcheck-frontend

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkmate-monitor/frontend-api@0.0.3
  - @checkmate-monitor/catalog-common@0.1.1
  - @checkmate-monitor/ui@0.1.1

## 0.1.0

### Minor Changes

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkmate-monitor/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkmate-monitor/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkmate-monitor/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkmate-monitor/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkmate-monitor/healthcheck-frontend:**

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

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/catalog-common@0.1.0
  - @checkmate-monitor/healthcheck-common@0.1.0
  - @checkmate-monitor/signal-frontend@0.1.0
  - @checkmate-monitor/frontend-api@0.0.2
