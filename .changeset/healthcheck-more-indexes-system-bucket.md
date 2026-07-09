---
"@checkstack/healthcheck-backend": minor
---

perf(healthcheck): add system-leading aggregate and config-reverse indexes

Add two Postgres indexes (migration 0020) to serve reads that the existing
keys cannot cover:

- `health_check_aggregates_system_bucket_idx` on
  `(system_id, bucket_size, bucket_start)`. The health-state read omits
  `configuration_id`, so the leading-`configuration_id` unique index could
  not be used and the query scanned the aggregates table. This index leads
  with `system_id` so those reads use an index instead.
- `system_health_checks_config_enabled_idx` on `(configuration_id, enabled)`.
  The reverse lookup in `getSystemIdsForConfiguration` (config-change
  recompute) filters by `configuration_id`, but the primary key leads with
  `system_id` and could not serve it. This index makes the config-scoped
  lookup an index scan.
