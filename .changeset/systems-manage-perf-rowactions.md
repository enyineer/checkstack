---
"@checkstack/anomaly-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/ui": minor
---

Speed up the catalog manage Systems tab and unify its per-row actions.

- The per-row `SystemHealthCheckAssignment` no longer runs two allocation-heavy
  access hooks (`useCanAccessType` + `useResourceAccess`) plus a counts query
  PER ROW - profiling showed this as the dominant, GC-bound cost of opening the
  Systems tab. A new `CatalogSystemHealthCheckDataProvider`, folded around the
  catalog tree via `CatalogBrowseDataBoundarySlot`, resolves the gate + counts
  once for the whole visible list; the row action reads them from context (the
  heavy standalone path is only rendered on surfaces without the provider, e.g.
  the system detail page).
- The per-row `SystemAnomalyBadge` no longer instantiates two live query
  observers (and scans up to 500-element arrays) per row. A new
  `AnomalyBadgeDataProvider`, folded around the catalog browse/manage tree via
  `CatalogBrowseDataBoundarySlot`, fetches the active + suspicious anomaly sets
  once and exposes an O(1) per-system lookup - matching the SLO / incident /
  health / dependency badges. Without the provider the badge falls back to its
  own (deduped) queries, so the system detail page is unchanged.
- `ScopeSystemToTeamAction` and `SystemHealthCheckAssignment` now render through
  the shared `RowAction`, so a system row's action cluster looks uniform.
  `ScopeSystemToTeamAction` additionally defers mounting its Radix dialog until
  first use, so a table of rows no longer mounts an idle dialog per row.
- `@checkstack/ui` `RowAction` gains an optional `badge` (e.g. an assigned-count
  indicator) rendered next to the icon, so a count action stays a normal
  `RowAction` instead of a bespoke button.
