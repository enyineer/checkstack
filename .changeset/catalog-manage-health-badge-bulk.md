---
"@checkstack/catalog-frontend": minor
---

perf(catalog): bulk-fetch the Health column on the catalog management page

The catalog management systems table rendered each row's state badges
(`SystemStateBadgesSlot` - health, SLO, dependency, notification) without a
bulk-data provider, so every row fired its own per-system query (e.g.
`getSystemHealthStatus` per system) - an N+1 request burst that scaled with the
catalog size. The management table is now wrapped in the same
`CatalogBrowseDataBoundary` the browse view already uses, so each provider's data
is fetched once in bulk (e.g. a single `getBulkSystemHealthStatus`) and every
badge reads it from React context instead of fetching per row. Live updates are
unchanged (the bulk queries live under the same `[["healthcheck"]]` key and are
auto-invalidated on status-change signals).
