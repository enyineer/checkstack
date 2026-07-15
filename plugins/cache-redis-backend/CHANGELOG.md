# @checkstack/cache-redis-backend

## 0.1.3

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/backend-api@0.34.0
  - @checkstack/common@0.23.0
  - @checkstack/cache-api@0.3.20
  - @checkstack/cache-redis-common@0.1.1

## 0.1.2

### Patch Changes

- Updated dependencies [d00e099]
  - @checkstack/backend-api@0.33.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/common@0.22.0
  - @checkstack/cache-redis-common@0.1.0

## 0.1.1

### Patch Changes

- @checkstack/backend-api@0.32.1

## 0.1.0

### Minor Changes

- bd41130: feat(cache): add a distributed Redis cache backend

  Ships `cache-redis-backend` (with its `cache-redis-common` access rules), a
  `CacheProvider` backed by Redis via `ioredis`. Select it in the Infrastructure
  Cache configuration UI to give every pod one shared, coherent cache - this is the
  backend a horizontally-scaled deployment MUST use, since the default in-memory
  backend is per-pod (see the cache-system docs and the in-memory warning in the
  Cache UI).

  Details:

  - Values are serialized with `v8.serialize` (structured-clone semantics), not
    JSON, so `Date` / `Map` / `Set` / typed arrays survive the round trip intact -
    several platform caches (e.g. the health-status response's `evaluatedAt` /
    `lastRunAt`) carry `Date`s that JSON would flatten to strings.
  - Honors TTL via `PX`, uses `UNLINK` for non-blocking deletes, and implements
    prefix invalidation with a non-blocking `SCAN` loop (never `KEYS`).
  - Namespaces its keys by folding `instanceRuntime.namespace` into the key prefix
    (`<namespace>:cache:`, or `cache:` for the default instance), so a secondary
    instance (e.g. PR preview) can share one Redis without colliding.
  - `getStats` reports `scope: "cluster"` so the UI can flag it as a shared cache.

  The dev-server's provider auto-resolution treats `cache-redis-backend` as a
  sibling of `cache-memory-backend`, so wiring Redis in a plugin's deps no longer
  forces the in-memory default to also load.

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/cache-redis-common@0.1.0
