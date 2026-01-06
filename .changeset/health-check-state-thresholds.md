---
"@checkmate-monitor/backend-api": minor
"@checkmate-monitor/backend": patch
"@checkmate-monitor/healthcheck-common": minor
"@checkmate-monitor/healthcheck-backend": minor
"@checkmate-monitor/healthcheck-frontend": minor
---

Add configurable state thresholds for health check evaluation

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

