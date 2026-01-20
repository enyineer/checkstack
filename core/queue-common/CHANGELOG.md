# @checkstack/queue-common

## 0.2.3

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/signal-common@0.1.4

## 0.2.2

### Patch Changes

- 8a87cd4: Updated access rules to use new `accessPair` interface

  Migrated to the new `accessPair` interface with per-level options objects for cleaner access rule definitions.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/signal-common@0.1.3

## 0.2.1

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/signal-common@0.1.2

## 0.2.0

### Minor Changes

- 180be38: # Queue Lag Warning

  Added a queue lag warning system that displays alerts when pending jobs exceed configurable thresholds.

  ## Features

  - **Backend Stats API**: New `getStats`, `getLagStatus`, and `updateLagThresholds` RPC endpoints
  - **Signal-based Updates**: `QUEUE_LAG_CHANGED` signal for real-time frontend updates
  - **Aggregated Stats**: `QueueManager.getAggregatedStats()` sums stats across all queues
  - **Configurable Thresholds**: Warning (default 100) and Critical (default 500) thresholds stored in config
  - **Dashboard Integration**: Queue lag alert displayed on main Dashboard (access-gated)
  - **Queue Settings Page**: Lag alert and Performance Tuning guidance card with concurrency tips

  ## UI Changes

  - Queue lag alert banner appears on Dashboard and Queue Settings when pending jobs exceed thresholds
  - New "Performance Tuning" card with concurrency settings guidance and bottleneck indicators

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/signal-common@0.1.1

## 0.1.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0

## 0.0.4

### Patch Changes

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
  - @checkstack/common@0.1.0
