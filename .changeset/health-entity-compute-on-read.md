---
"@checkstack/healthcheck-backend": minor
---

Make the reactive `health` entity PLUGIN-BACKED compute-on-read over its own durable data (no framework storage).

The per-system `health` entity previously stored its reactive subset
(`{ status, healthyChecks, totalChecks }`) in the framework keyed store
(`entity_state`, keyed by `systemId`) — the last remaining user of that store.
It is now a Model B PLUGIN-BACKED + COMPUTED entity: the `read` accessor derives
the view on demand from the same durable health data the rest of the plugin
reads (`health_check_runs` via `getSystemHealthStatus`), gated on the system
having at least one persisted run (so a system's first evaluation is still a
create that fires no directional/umbrella event, matching prior behavior).

Each evaluation-site write now drives `handle.mutate({ id: systemId, apply })`,
where `apply` performs the REAL durable write (insert run + increment the hourly
aggregate) and returns the freshly-computed view. The framework snapshots `prev`
via `read` BEFORE the run is persisted, so a real status change still produces
exactly one correct `ENTITY_CHANGED` with accurate prev → next. The change
deriver, emitted trigger events
(`healthcheck.system_degraded` / `_healthy` / `_health_changed`), and
`classifyHealthChange` are unchanged, so the slo / dependency consumers that read
health via `onEntityChanged({ kind: "health" })` behave identically.

The healthcheck plugin no longer uses `createKeyedStore` /
`entityKeyedStoreServiceRef`.

BREAKING CHANGE: the `health` entity no longer materializes its state in the
framework keyed store (`entity_state`). The state is computed on read from the
durable `health_check_*` tables; any out-of-band read of the keyed-store row for
the `health` kind no longer returns data. All sanctioned consumers
(`get`/`getMany`, scope enrichment, `onEntityChanged`) are unaffected.
