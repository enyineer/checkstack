---
"@checkstack/slo-backend": minor
---

perf(slo): add indexes for hot SLO read paths

Adds Postgres indexes serving the queries run on every SYSTEM_STATUS_CHANGED
and per chart request:

- `slo_downtime_events` partial `(objective_id) WHERE end_time IS NULL` -
  open-event lookup by objective, run several times per status change.
- `slo_downtime_events` partial `(system_id) WHERE end_time IS NULL` -
  open-event lookup by system, run several times per status change.
- `slo_downtime_events` composite `(objective_id, start_time)` - window and
  recent event scans for an objective.
- `slo_objectives` `(system_id)` - objectives-for-system read per status change.
- `slo_daily_snapshots` `(objective_id, date)` - trend read per chart request.
- `slo_achievements` `(system_id, achievement)` - idempotency check before every
  insert plus list-by-system.
