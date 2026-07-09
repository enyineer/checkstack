---
"@checkstack/dashboard-frontend": patch
---

Catalog browse view: wrap rows in the bulk badge-data provider so
health/incident/maintenance badges stop fetching per-row (performance-only,
behavior unchanged).

dashboard-frontend now fills catalog's `CatalogBrowseDataBoundarySlot` with an
eager filler that wraps the boundary's `children` (the whole browse tree) in its
existing `SystemBadgeDataProvider`, keyed on the visible `systemIds`. The
per-row `SystemHealthBadge` / `SystemIncidentBadge` / `SystemMaintenanceBadge`
already read `useSystemBadgeDataOptional()` and now resolve from that bulk
context instead of each issuing a singular per-system RPC, eliminating the
browse view's N+1. All cross-plugin coupling lives on the filler side; catalog
gains no new dependency.
