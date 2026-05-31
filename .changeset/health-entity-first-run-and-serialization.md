---
"@checkstack/healthcheck-backend": minor
---

Fix two correctness defects in the reactive `health` entity: suppressed first-run degradation, and duplicate `ENTITY_CHANGED` under concurrent N-pod evaluation.

**First-run degradation was silently dropped (data-loss).** The compute-on-read `health` entity gated on the system having at least one persisted `health_check_runs` row, so a system's very first evaluation snapshotted `prev = null` (a create). The deriver and `classifyHealthChange` both treat a null side as "no transition", so a first-ever run that came up unhealthy fired NO `system_degraded` / `health_changed` trigger and NO `degraded` `onEntityChanged` - meaning SLO / dependency consumers never opened downtime. If the system stayed unhealthy, `prev === next` forever and the event never fired. The executor's own pre-run baseline (`getSystemHealthStatus`, no run gate) DID see the transition, so the entity and the executor disagreed.

Fix: the existence gate is now on ENABLED check ASSOCIATIONS, not on persisted runs. A system with at least one enabled check resolves to the SAME default-`healthy` baseline `getSystemHealthStatus` returns for an empty run window (`{ status: "healthy", healthyChecks: N, totalChecks: N }`); a system with no enabled checks still has no entity. So a first-ever unhealthy run is now a real `healthy -> degraded` diff that fires `system_degraded` + `health_changed` and opens SLO / dependency downtime. The entity and the executor now agree on the pre-run baseline.

**Concurrent evaluations of one system double-emitted (race / data-loss).** `writeHealthEntity -> handle.mutate` snapshotted `prev`, applied, and diffed with NO advisory lock. Two concurrent evaluations of one system (multiple per-config jobs across pods, or at-least-once redelivery) could both snapshot `prev = healthy`, both insert a failing run, both diff `healthy -> degraded`, and both emit - yielding two `ENTITY_CHANGED` + two `entity_transitions` rows for one logical transition (inflating `transitionCount` / flapping and re-running dependency notify).

Fix: each system's snapshot-`prev` + `apply` + diff + emit is now serialized through a transaction-scoped advisory lock keyed `health:<systemId>` (`withXactLock` from `@checkstack/backend-api`), wired into `writeHealthEntity` via an injected `serialize` and applied at all three evaluation-write sites. Two concurrent evals of one system now collapse to exactly one emit and one transition row. The durable run/aggregate write is unchanged; only the snapshot/diff/emit window is protected.

BREAKING CHANGES:
- A system with an enabled health check now has a resolvable `health` entity BEFORE its first run (default-`healthy` baseline), where previously it had none until the first run persisted. Code that relied on the entity being absent for run-less-but-configured systems (e.g. treating a missing entity as "not yet monitored") should instead treat a `healthy` baseline as "configured, no failing signal yet". Systems with no enabled checks still have no entity.
