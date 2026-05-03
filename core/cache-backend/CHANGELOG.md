# @checkstack/cache-backend

## 0.2.3

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/cache-common@0.2.0
  - @checkstack/common@0.7.0

## 0.2.2

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/cache-api@0.2.2

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/cache-api@0.2.1

## 0.2.0

### Minor Changes

- 8d1ef12: ## Infrastructure Configuration Shell & Cache System

  ### New Packages

  - **`@checkstack/cache-api`**: Core cache abstractions — `CacheProvider` interface, `createScopedCache` factory for plugin key isolation, `CachePlugin`/`CacheManager` lifecycle interfaces.
  - **`@checkstack/cache-common`**: Shared cache types, RPC contract (`getPlugins`, `getConfiguration`, `updateConfiguration`), access rules, and plugin metadata.
  - **`@checkstack/cache-backend`**: Cache settings RPC router — exposes plugin discovery, configuration read/write endpoints with access-gated authorization.
  - **`@checkstack/cache-frontend`**: Cache configuration tab component for the Infrastructure Settings page.
  - **`@checkstack/infrastructure-common`**: Infrastructure tab registry, routes, and shared types for the IDE-style configuration shell.
  - **`@checkstack/infrastructure-frontend`**: Infrastructure Settings page with vertical tab bar, per-tab access control, and user menu integration.

  ### Modified Packages

  - **`@checkstack/backend-api`**: Added `cachePluginRegistry` and `cacheManager` to `RpcContext` and `coreServices`.
  - **`@checkstack/backend`**: Registered cache services in boot sequence, added cache config loading, extended dependency sorter for cache plugin ordering.
  - **`@checkstack/queue-frontend`**: Refactored from standalone `/queue/config` route to an infrastructure tab. Queue settings now live inside the Infrastructure Settings page.

  ### Architecture

  The former monolithic Queue Config page is replaced by a pluggable Infrastructure Settings shell (`/infrastructure/config`). Plugins register configuration tabs via `registerInfrastructureTab()` with their own access rules, icons, and components. The shell evaluates per-tab access and only renders tabs the user can see.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-common@0.2.0
  - @checkstack/backend-api@0.13.0
