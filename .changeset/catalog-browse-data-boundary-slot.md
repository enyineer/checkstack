---
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": patch
---

Add `CatalogBrowseDataBoundarySlot` and eliminate the catalog browse view's per-row N+1 fetches.

The user (browse) catalog view mounts small contributions on every system row and group header (state badges, a notification bell) that each fetched their own data - one request per row, so a catalog with N systems issued O(N) health/incident/maintenance/subscription requests on open.

`catalog-common` now exposes `CatalogBrowseDataBoundarySlot`: a provider plugin fills it with a component that wraps the whole browse tree in a bulk-data provider keyed on the entire visible `systemIds`/`groupIds` set, so the per-row contributions read from that provider's context and issue no per-row request. `catalog-frontend` renders the new `CatalogBrowseDataBoundary`, which folds every registered filler around the tree (multiple providers nest; the tree renders exactly once) and, when no filler is installed, renders the tree unchanged so each contribution falls back to its own fetch. Catalog gains no dependency on any provider plugin - all coupling stays on the filler side, mirroring the existing `CatalogBrowseHealthSlot` pattern.

The catalog backend read was already fully batched (2 queries); this change is entirely on the frontend and is behavior-preserving.
