# @checkstack/queue-backend

## 0.2.4

### Patch Changes

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/backend-api@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/queue-common@0.2.2
  - @checkstack/queue-api@0.1.3

## 0.2.2

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/queue-common@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/queue-api@0.1.1

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

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-common@0.2.0
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2

## 0.1.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1

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
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/queue-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
  - @checkstack/queue-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/queue-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/queue-common@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/queue-common@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/queue-common@0.0.2
