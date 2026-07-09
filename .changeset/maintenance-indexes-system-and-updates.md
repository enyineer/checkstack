---
"@checkstack/maintenance-backend": minor
---

perf(maintenance): add indexes for per-system reverse lookup and update timelines

Add two Postgres indexes to speed up hot read paths:

- `maintenance_systems_system_idx` on `maintenance_systems (system_id)` -
  serves the reverse lookup (`getMaintenancesForSystem`) and per-system render
  fan-out. The junction primary key leads with the maintenance id, so a lookup
  by system had no usable index before.
- `maintenance_updates_maintenance_created_idx` on
  `maintenance_updates (maintenance_id, created_at)` - serves status derivation
  (`ORDER BY created_at DESC LIMIT 1`) and the bulk timeline fetch, both keyed
  on the maintenance id.
