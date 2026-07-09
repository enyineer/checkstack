---
"@checkstack/anomaly-backend": minor
---

perf(anomaly): add two Postgres indexes to the `anomalies` table for its hottest read paths.

- `anomalies_open_lookup_idx` on (system_id, configuration_id, environment_id, kind): serves the inline detector's per-run open-row lookup, which runs once per health-check run and is the hottest anomaly path.
- `anomalies_active_started_idx`, a partial index on (started_at DESC) WHERE suppressed_at IS NULL: serves the dashboard active-signal scan, which previously full-scanned the table.
