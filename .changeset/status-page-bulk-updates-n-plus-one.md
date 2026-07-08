---
"@checkstack/healthcheck-common": minor
"@checkstack/incident-common": minor
"@checkstack/maintenance-common": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
---

Eliminate N+1 RPC fan-outs in the public status-page widget resolvers.

Each of these widgets renders a PUBLIC page, so every per-item RPC was real
external DB load. Three bulk-by-id endpoints replace the per-item fetches:

- `healthcheck-common`: new `getBulkRunStats({ systemIds, startDate, endDate,
  maxBuckets })` -> `{ stats: Record<systemId, RunStats> }`. The `systemHealth`
  widget's uptime column now issues ONE request for all systems instead of one
  `getRunStats` per system. Systems with no runs in the window are omitted, so
  the resolver's output is unchanged.
- `incident-common`: new `getBulkIncidentUpdates({ incidentIds })` ->
  `{ updates: Record<incidentId, IncidentUpdate[]> }`. The incidents widget now
  fetches every selected incident's update timeline in ONE request instead of
  one `getIncident` per incident.
- `maintenance-common`: new `getBulkMaintenanceUpdates({ maintenanceIds })` ->
  `{ updates: Record<maintenanceId, MaintenanceUpdate[]> }` (symmetric with the
  incident endpoint) for the maintenance widget.

The new update endpoints apply the same per-item audience filter as
`getIncident` / `getMaintenance`, so internal/logged-in updates and author
identity never leak to a non-manager caller. Each endpoint is keyed by the
resource id and gated with the record post-filter (`recordKey`) matching the
single endpoint's read scope, mirroring `getBulkSystemHealthStatus` /
`getBulkIncidentsForSystems`. Widget DTO output is unchanged - this is a pure
request-count optimization.
