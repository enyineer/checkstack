---
"@checkstack/dependency-frontend": patch
---

Eliminate the catalog browse view's per-row dependency-warning N+1.

The per-system `DependencyBadge` previously fetched its own `getWarningsForSystem` RPC on every catalog browse row, so a catalog with N systems issued O(N) dependency-warning requests on open.

dependency-frontend now fills catalog's `CatalogBrowseDataBoundarySlot` with `CatalogBrowseDependencyDataFiller`, which wraps the whole browse tree in a `DependencyBadgeDataProvider` that bulk-fetches warnings for every visible system via `getWarnings` and exposes them through context. When that provider is mounted, `DependencyBadge` reads its warning from context and disables its own per-system query. This is behavior-preserving and frontend-only: the bulk record's per-system entry is equivalent to the singular endpoint's result (both derive from the same warning evaluation), so a system with a warning renders identically and a system without one renders nothing. On surfaces with no filler (e.g. the system detail page) the fallback per-system query still runs exactly as before.
