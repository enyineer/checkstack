---
"@checkstack/maintenance-backend": patch
---

Fix an N+1 query in the maintenance scheduled job. `getMaintenancesToStart` and
`getMaintenancesToComplete` fetched each due maintenance's affected systems in a
per-row loop (one query per maintenance). Both now fetch all systems in a single
batched `inArray` junction read (reusing the shared `getSystemsByMaintenance`
helper) inside one scoped transaction. External behavior is unchanged: same
return type, same contents, same ordering.
