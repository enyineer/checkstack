---
"@checkstack/backend": patch
"@checkstack/healthcheck-backend": patch
---

fix: run afterPluginsReady in topological order; merge daily rollups on conflict

Two resilience fixes for the dependency chain:

1. **Plugin loader**: Phase 3 (`afterPluginsReady`) now iterates plugins
   in the same topologically-sorted order as Phase 2 (`init`). Previously
   it iterated `pendingInits` in registration order, which raced
   subscription-spec dependencies — catalog's afterPluginsReady registers
   `catalog.system` and `catalog.group` notification targets, and emitting
   plugins (incident, maintenance, …) call `registerSubscriptionSpec`
   against those targets in their own afterPluginsReady. With registration
   order, an emitter could run before catalog and hit
   `Target type catalog.group is not registered`. Sorted order encodes
   the dependency via `spec.target.ownerPlugin`, so the emitter now
   always runs after the target owner.

2. **Healthcheck retention job**: the daily rollup now upserts
   `health_check_aggregates` with `ON CONFLICT DO UPDATE` instead of a
   plain insert. Previously, late-arriving hourly aggregates (e.g. from
   a satellite that was offline when the prior rollup ran) would crash
   the rollup with a unique-constraint violation on
   `(configuration_id, system_id, bucket_start, bucket_size, source_id)`.
   The merge sums counts and folds min/max/p95 into the existing daily
   row.
