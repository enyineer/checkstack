---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": patch
---

Fix an N+1 in the catalog manager: the per-system "Health Checks" count badge
fired one `getSystemAssociations` request per system row, each holding a pooled
Postgres connection that contended with the background health-check run
executor and could exhaust the pool on large catalogs.

- Add `getBulkAssignedHealthCheckCounts({ systemIds })` to healthcheck, which
  returns per-system assignment counts (0 for systems with no assignments) from
  ONE grouped `COUNT(*) ... GROUP BY system_id` query. Read authorization
  matches the per-system endpoint it replaces (`configuration.read` +
  `catalog.system` read via `recordKey`), so a team-scoped user only sees counts
  for systems they may read.
- `CatalogSystemActionsSlot` now passes `visibleSystemIds` (every system id in
  the row's list) so a per-row filler can bulk-fetch for the whole visible set
  in a single deduped request instead of one request per row. This mirrors how
  `CatalogBrowseHealthSlot` / `SystemSignalsSlot` already pass `systemIds`.
- The health-check count badge now reads its count from that one deduped bulk
  query. N visible rows cause 1 request instead of N.

State & scale: the counts are derived on read from the shared
`system_health_checks` table, so every pod returns the same answer; no
process-local or duplicated state is introduced.
