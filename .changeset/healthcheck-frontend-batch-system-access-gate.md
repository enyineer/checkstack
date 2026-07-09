---
"@checkstack/healthcheck-frontend": patch
---

perf(healthcheck): batch the system-access gate in the catalog "Health Checks"
action so it no longer N+1s per row

`SystemHealthCheckAssignment` (contributed once per system row to the catalog
`CatalogSystemActionsSlot`) gated its button with
`useResourceAccess({ resourceIds: [systemId] })` - a single id per row. Each
row's query key differed, so React Query could not dedupe them and N systems
fired N separate `listMyAccessibleResources` requests on every catalog-manager
render. It now passes the `visibleSystemIds` it already receives (the whole
visible list), so every row's identical-input query dedupes to ONE request and
the row still gates on `canAccess(systemId)` - the exact pattern the same file's
`getBulkAssignedHealthCheckCounts` counts query already uses.
