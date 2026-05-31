---
"@checkstack/healthcheck-backend": minor
"@checkstack/automation-backend": minor
---

Make the per-system aggregated `health` a reactive entity via the Model-B entity state machine, homed in the framework keyed store.

Healthcheck defines a `health` entity `{ status, healthyChecks, totalChecks }` keyed by `systemId`. The per-system aggregate is HOMELESS - it is computed at check-evaluation time and has no domain table of its own (only the `health_check_*` transition log persists) - so it opts into the framework keyed store (`entity_state`) EXPLICITLY: `defineEntity({ kind: "health", read: keyedStore.readMany })`. Every aggregate-write site in the queue executor (success + failure evaluation paths) routes through `handle.mutate({ id: systemId, apply })`, where `apply` upserts the keyed store inside a transaction on automation-backend's DB and returns the aggregate view; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED`. The write is fail-soft (a store error never breaks check execution) and diff-suppressed (an unchanged aggregate is a no-op). Raw `health_check_runs` stay intentionally non-reactive (`declareNonReactiveState`, raw-sample).

A behavior-preserving change -> trigger-event deriver maps a status transition to the existing qualified trigger events (the underscore TRIGGER ids automations match on, not the dotted hook ids):

- recovery (`prev !== healthy` -> `next === healthy`) -> `healthcheck.system_healthy` + `healthcheck.system_health_changed`
- degradation (`prev === healthy` -> `next !== healthy`) -> `healthcheck.system_degraded` + `healthcheck.system_health_changed`
- any other transition -> `healthcheck.system_health_changed`

`@checkstack/automation-backend`:
- Re-exports the `EntityChanged`, `EntityChangeDeriver`, `RegisterChangeDeriver`, `OnEntityChanged` (and related) types from its public barrel so a domain plugin needs only the automation-backend dependency to author a deriver / cross-plugin consumer.
- Exposes `entityKeyedStoreServiceRef` (`EntityKeyedStoreService`) - cross-plugin access to the framework keyed store (`entity_state`) plus a transaction runner, both bound to automation-backend's schema-scoped DB. A homeless reactive kind whose state lives in `entity_state` (which sits behind automation-backend's scoped DB, unreachable through the consuming plugin's own scoped DB) reads/writes it through this service while staying reactive via `handle.mutate`.

`classifyHealthChange` lets cross-plugin consumers (slo, dependency) reproduce the old directional `systemDegraded` / `systemHealthy` predicates from a `health` change. The transition history in `entity_transitions` is recorded for every change.

BREAKING CHANGES:
- The `healthcheck.system.degraded` / `.healthy` / `.health_changed` cross-plugin hooks are removed (see also the healthcheck/catalog hook-removal changeset). The reactive `health` entity drives the matching trigger events (`healthcheck.system_degraded` / `_healthy` / `_health_changed`), so existing automations keep firing. Kept healthcheck hooks: `assignment.changed`, `check.completed`, `check.failed`, `flapping_detected`.
- A plugin that built a homeless reactive entity over `entity_state` must declare an explicit `read` (e.g. via `entityKeyedStoreServiceRef.keyedStoreFor(kind).readMany`) and mutate through `handle.mutate`.
