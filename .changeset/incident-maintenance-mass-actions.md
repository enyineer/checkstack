---
"@checkstack/common": minor
"@checkstack/backend-api": minor
"@checkstack/backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
---

Add "Mass delete" and "Mass resolve" to the Incidents and Maintenances lists,
authorized per item (RLAC).

The incidents and maintenances list pages now support multi-select with a bulk
action bar. A user may only select and act on entries they are allowed to
MANAGE: a row's checkbox appears only when the caller can manage it (the same
`canAccess(id)` gate as the per-row actions), so a team-scoped member sees
checkboxes only for their team's entries. Mass delete confirms before running;
mass resolve (incidents) and mass complete (maintenances, the "resolve"
equivalent = close, status -> completed) skip entries that are already
resolved/completed. Each action reports a per-id partial-success summary
(e.g. "3 deleted, 1 skipped").

New backend procedures: `incident.bulkDeleteIncidents`,
`incident.bulkResolveIncidents`, `maintenance.bulkDeleteMaintenances`, and
`maintenance.bulkCloseMaintenances`. Each authorizes EACH id against the
caller's manage grant and never fails open: unauthorized ids are filtered out
before the handler runs and returned as `forbidden`; missing ids as `notFound`;
a per-id failure is isolated as `error` without aborting the batch. Per-id cache
invalidation, realtime signals, and subscriber notifications run for every
success so dashboards and status pages stay consistent.

Platform: a new `instanceAccess` mode `bulkManage: { idsParam }` is the
enforcement point for bulk writes. Before the handler runs, `autoAuthMiddleware`
partitions the input id array into the caller's manageable subset and the denied
remainder and exposes both on `context.bulkAccess` (fail-closed on an S2S
error). The boot-time contract validator (`validateContractInstanceAccess`)
accepts `bulkManage` as one of the mutually-exclusive scoping modes, marks its
type team-scopable, and cross-checks `idsParam` against the input schema.

State and scale: authorization is derived per request from the shared team-grant
store via the existing auth S2S path (no process-local state); the read returns
the same answer on every pod. No database migration.
