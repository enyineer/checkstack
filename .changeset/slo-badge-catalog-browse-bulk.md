---
"@checkstack/slo-frontend": patch
---

Eliminate the catalog browse view's per-row SLO N+1.

`SystemSloBadge` previously fetched `getObjectivesForSystem` once per system row, so a catalog with N systems issued O(N) SLO requests on open. slo-frontend now fills `CatalogBrowseDataBoundarySlot` with a `SloBadgeDataProvider` that bulk-fetches `getBulkObjectivesForSystems` keyed on the whole visible `systemIds` set; the per-row badges read their objectives from that provider's context and issue no per-row request. This is behavior-preserving and frontend-only. On surfaces without the filler (e.g. the system detail page) the badge's fallback per-system query runs exactly as before.
