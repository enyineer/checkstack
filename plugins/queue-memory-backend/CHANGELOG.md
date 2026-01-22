# @checkstack/queue-memory-backend

## 0.3.3

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/queue-memory-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.3.2

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/queue-api@0.2.2
  - @checkstack/queue-memory-common@0.1.5

## 0.3.1

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/queue-memory-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.3.0

### Minor Changes

- 2c0822d: ### Queue System

  - Added cron pattern support to `scheduleRecurring()` - accepts either `intervalSeconds` or `cronPattern`
  - BullMQ backend uses native cron scheduling via `pattern` option
  - InMemoryQueue implements wall-clock cron scheduling with `cron-parser`

  ### Maintenance Backend

  - Auto status transitions now use cron pattern `* * * * *` for precise second-0 scheduling
  - User notifications are now sent for auto-started and auto-completed maintenances
  - Refactored to call `addUpdate` RPC for status changes, centralizing hook/signal/notification logic

  ### UI

  - DateTimePicker now resets seconds and milliseconds to 0 when time is changed

### Patch Changes

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/backend-api@0.5.0

## 0.2.4

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/queue-memory-common@0.1.3
  - @checkstack/queue-api@0.1.3

## 0.2.3

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/queue-memory-common@0.1.2

## 0.2.2

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/queue-api@0.1.1

## 0.2.1

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/queue-memory-common@0.1.1

## 0.2.0

### Minor Changes

- 9a27800: Changed recurring job scheduling from completion-based to wall-clock scheduling.

  **Breaking Change:** Recurring jobs now run on a fixed interval (like BullMQ) regardless of whether the previous job has completed. If a job takes longer than `intervalSeconds`, multiple jobs may run concurrently.

  **Improvements:**

  - Fixed job ID collision bug when rescheduling within the same millisecond
  - Configuration updates via `scheduleRecurring()` now properly cancel old intervals before starting new ones
  - Added `heartbeatIntervalMs` to config for resilient job recovery after system sleep

### Patch Changes

- 9a27800: Fix recurring jobs resilience and add logger support

  **Rescheduling Fix:**
  Previously, recurring job rescheduling logic was inside the `try` block of `processJob()`. When a job handler threw an exception and `maxRetries` was exhausted (or 0), the recurring job would never be rescheduled, permanently breaking the scheduling chain.

  This fix moves the rescheduling logic to the `finally` block, ensuring recurring jobs are always rescheduled after execution, regardless of success or failure.

  **Heartbeat Mechanism:**
  Added a periodic heartbeat (default: 5 seconds) that checks for ready jobs and triggers processing. This ensures jobs are processed even if `setTimeout` callbacks fail to fire (e.g., after system sleep/wake cycles). Configurable via `heartbeatIntervalMs` option; set to 0 to disable.

  **Logger Service Integration:**

  - Added optional `logger` parameter to `QueuePlugin.createQueue()` interface
  - `InMemoryQueue` now uses the provided logger instead of raw `console.error`
  - Consistent with the rest of the codebase's logging patterns

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
  - @checkstack/queue-memory-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
  - @checkstack/queue-memory-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/queue-memory-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/queue-memory-common@0.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/queue-memory-common@0.1.2

## 1.0.0

### Major Changes

- 8e889b4: Add consumer group support to Queue API for distributed event system. BREAKING: consume() now requires ConsumeOptions with consumerGroup parameter.

### Patch Changes

- e4d83fc: Add BullMQ queue plugin with orphaned job cleanup

  - **queue-api**: Added `listRecurringJobs()` method to Queue interface for detecting orphaned jobs
  - **queue-bullmq-backend**: New plugin implementing BullMQ (Redis) queue backend with job schedulers, consumer groups, and distributed job persistence
  - **queue-bullmq-common**: New common package with queue permissions
  - **queue-memory-backend**: Implemented `listRecurringJobs()` for in-memory queue
  - **healthcheck-backend**: Enhanced `bootstrapHealthChecks` to clean up orphaned job schedulers using `listRecurringJobs()`
  - **test-utils-backend**: Added `listRecurringJobs()` to mock queue factory

  This enables production-ready distributed queue processing with Redis persistence and automatic cleanup of orphaned jobs when health checks are deleted.

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
  - @checkstack/queue-memory-common@0.1.1
