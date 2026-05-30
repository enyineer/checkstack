---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-common": minor
---

Add the health-state provider data contract (automation sensing layer, Wave 2 Phase 13).

- New `health_check_state_transitions` table records every aggregate health-status transition for a system (all statuses, not just unhealthy), giving a reliable "in current status since" timestamp. Written wherever an aggregate transition is detected. Pruned with raw-run retention, but the single most-recent row per system is always kept so an active streak never blanks.
- New service-typed RPCs on `HealthCheckApi`: `getHealthState({ systemId, configurationId? })` returns `{ status, inStatusSince, inStatusForMs, latencyMs?, avgLatencyMs?, p95LatencyMs?, successRate?, lastRunAt?, inMaintenance, evaluatedAt }`, and `getBulkHealthState({ systemIds })` (POST) resolves many systems against one shared timestamp.
- New service-typed RPC on `MaintenanceApi`: `hasActiveMaintenance({ systemId })` reports whether a system is in an active maintenance window regardless of notification-suppression (suppression-agnostic), folded into `getHealthState` as `inMaintenance`.

All reads are fail-safe: a missing transition row yields `inStatusSince: null`, and a maintenance-plugin error fails open to `inMaintenance: false`.
