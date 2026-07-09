---
"@checkstack/healthcheck-backend": minor
---

perf(healthcheck): add the missing composite indexes on health_check_runs

The status read path reads the last N runs for a (system, check[, environment])
slice ordered by `timestamp DESC` on every status read AND on every check
execution, but `health_check_runs` had NO secondary indexes - only its primary
key. Every such read was a full sequential scan of the (multi-million-row) table
plus an in-memory sort, so point reads averaged 50-320 ms and dominated total DB
time. Two composite indexes now back these access patterns:

- `health_check_runs_check_recent_idx` (system_id, configuration_id, timestamp) -
  the cross-environment newest-run reads and the retention `DELETE`.
- `health_check_runs_slice_recent_idx` (system_id, configuration_id,
  environment_id, timestamp) - the env-scoped slice reads, the per-check
  DISTINCT-environment discovery, and the per-env last-healthy `max(timestamp)`
  group-by.

Both turn full-table seq-scans into index range scans (Postgres scans the btree
backward for the `DESC` order).

> [!IMPORTANT]
> Deploy note: the migration builds the indexes with a plain (non-CONCURRENT)
> `CREATE INDEX`, which briefly locks writes to `health_check_runs` while each
> index builds (the migrator runs every migration in one transaction, so
> `CREATE INDEX CONCURRENTLY` is not possible through it). On a very large table
> you can build them `CONCURRENTLY` by hand (same names) before deploying; the
> migration uses `IF NOT EXISTS`, so it then no-ops.
