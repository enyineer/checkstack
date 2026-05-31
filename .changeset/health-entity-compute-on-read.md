---
"@checkstack/healthcheck-backend": minor
---

Make the per-system aggregated `health` a PLUGIN-BACKED, COMPUTE-ON-READ reactive entity via the Model-B entity state machine.

Healthcheck defines a `health` entity `{ status, healthyChecks, totalChecks }` keyed by `systemId`. There is NO framework storage and NO domain table of its own: the `read` accessor DERIVES the view on demand from the same durable health data the rest of the plugin reads (`health_check_runs` via `getSystemHealthStatus`), gated on the system having at least one enabled check association (see the first-run-degradation fix changeset). Storing a second materialized copy would duplicate the engine's source of truth and risk drift, so the aggregate is computed, not mirrored.

Each evaluation-site write drives `handle.mutate({ id: systemId, apply })`, where `apply` performs the REAL durable write (insert run + increment the hourly aggregate) and returns the freshly-computed view. The framework snapshots `prev` via `read` BEFORE the run is persisted, so a real status change still produces exactly one correct `ENTITY_CHANGED` with accurate prev to next. The write is fail-soft (a framework reactivity error after the durable write commits never breaks check execution) and diff-suppressed (an unchanged aggregate is a no-op). Raw `health_check_runs` stay intentionally non-reactive (`declareNonReactiveState`, raw-sample).

A behavior-preserving change to trigger-event deriver maps a status transition to the existing qualified TRIGGER events (the underscore trigger ids automations match on, not the dotted hook ids):

- recovery (`prev !== healthy` to `next === healthy`) to `healthcheck.system_healthy` + `healthcheck.system_health_changed`
- degradation (`prev === healthy` to `next !== healthy`) to `healthcheck.system_degraded` + `healthcheck.system_health_changed`
- any other transition to `healthcheck.system_health_changed`

`classifyHealthChange` lets cross-plugin consumers (slo, dependency) reproduce the old directional `systemDegraded` / `systemHealthy` predicates from a `health` change read via `onEntityChanged({ kind: "health" })`. The transition history in `entity_transitions` is recorded for every change.

BREAKING CHANGES:
- The `health` entity's current state is computed on read from the durable `health_check_*` tables; there is no stored current-state row (no framework `entity_state`, no domain mirror). Any code reading current aggregated health must read through the entity `read` accessor / `handle.get` / `getMany`, scope enrichment, or `onEntityChanged`. Durable history in `entity_transitions` is unaffected. (The cross-plugin `healthcheck.system.degraded` / `.healthy` / `.health_changed` hooks are removed in the healthcheck/catalog hook-removal changeset; the reactive entity drives the matching trigger events so existing automations keep firing.)
