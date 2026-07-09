---
"@checkstack/incident-backend": minor
---

perf(incident): add indexes for reverse system lookup and update status derivation

Add two Postgres indexes to speed up hot read paths:

- `incident_systems_system_idx` on `incident_systems (system_id)` - the junction
  primary key leads with `incident_id`, leaving the `system_id` direction
  unindexed. This index serves the reverse lookup used by
  `getIncidentsForSystem` / `getActiveHealthOverrides`, which fans out per
  system on every status-page render.
- `incident_updates_incident_created_idx` on
  `incident_updates (incident_id, created_at)` - serves the status-derivation
  query (`WHERE incident_id, status_change IS NOT NULL ORDER BY created_at DESC
  LIMIT 1`) and the bulk timeline fetch.
