---
"@checkstack/catalog-common": major
"@checkstack/catalog-backend": minor
---

BREAKING: `getSystems` now returns `{ systems: [...] }` instead of plain array

This change enables resource-level access control filtering for the catalog plugin. The middleware needs a consistent object format with named keys to perform post-execution filtering on list endpoints.

## Breaking Changes

- `getSystems()` now returns `{ systems: System[] }` instead of `System[]`
- All call sites must update to destructure: `const { systems } = await api.getSystems()`

## New Features

- Added `resourceAccess` metadata to catalog endpoints:
  - `getSystems`: List filtering by team access
  - `getSystem`: Single resource pre-check by team access  
  - `getEntities`: List filtering for systems by team access

## Migration

```diff
- const systems = await catalogApi.getSystems();
+ const { systems } = await catalogApi.getSystems();
```
