---
"@checkstack/healthcheck-backend": minor
"@checkstack/automation-backend": minor
---

Migrate the per-system aggregated health to the reactive `health` entity (reactive automation engine Phase 4, §10.3).

Healthcheck now defines a `health` entity `{ status, healthyChecks, totalChecks }` keyed by `systemId` through the `automation.entity` extension point and mirrors the aggregate into the framework entity store at every aggregate-write site in the queue executor (success + failure evaluation paths). A behavior-preserving change → trigger-event deriver maps a status transition to the existing qualified trigger events so automations keep firing:

- recovery (`prev !== healthy` → `next === healthy`) → `healthcheck.system.healthy` + `healthcheck.system.health_changed`
- degradation (`prev === healthy` → `next !== healthy`) → `healthcheck.system.degraded` + `healthcheck.system.health_changed`
- any other transition → `healthcheck.system.health_changed`

The mirror is fail-soft (a store error never breaks check execution) and diff-suppressed (an unchanged aggregate is a no-op). Raw `health_check_runs` stay intentionally non-reactive (`declareNonReactiveState`, raw-sample) — the aggregate is the entity; individual runs remain a `numeric_state` wake source only.

`@checkstack/automation-backend` now re-exports the `EntityChanged`, `EntityChangeDeriver`, `RegisterChangeDeriver`, `OnEntityChanged` (and related) types from its public barrel so a domain plugin needs only the automation-backend dependency to author a deriver / cross-plugin consumer.

This step KEEPS the `healthcheck.system.degraded` / `.healthy` / `.health_changed` hooks emitting (they are removed in the final Phase-4 step once all consumers move to `onEntityChanged`), so no behavior changes for existing subscribers yet.
