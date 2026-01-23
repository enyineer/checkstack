# @checkstack/queue-api

## 0.2.5

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0

## 0.2.4

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0

## 0.2.3

### Patch Changes

- Updated dependencies [48c2080]
  - @checkstack/backend-api@0.6.0

## 0.2.2

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.5.1

## 0.2.0

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

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3

## 0.1.0

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

- Updated dependencies [7a23261]
  - @checkstack/backend-api@0.3.2

## 0.0.6

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
  - @checkstack/backend-api@0.3.1

## 0.0.5

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0

## 1.0.0

### Major Changes

- 8e889b4: Add consumer group support to Queue API for distributed event system. BREAKING: consume() now requires ConsumeOptions with consumerGroup parameter.

### Minor Changes

- e4d83fc: Add BullMQ queue plugin with orphaned job cleanup

  - **queue-api**: Added `listRecurringJobs()` method to Queue interface for detecting orphaned jobs
  - **queue-bullmq-backend**: New plugin implementing BullMQ (Redis) queue backend with job schedulers, consumer groups, and distributed job persistence
  - **queue-bullmq-common**: New common package with queue permissions
  - **queue-memory-backend**: Implemented `listRecurringJobs()` for in-memory queue
  - **healthcheck-backend**: Enhanced `bootstrapHealthChecks` to clean up orphaned job schedulers using `listRecurringJobs()`
  - **test-utils-backend**: Added `listRecurringJobs()` to mock queue factory

  This enables production-ready distributed queue processing with Redis persistence and automatic cleanup of orphaned jobs when health checks are deleted.

### Patch Changes

- 81f3f85: ## Breaking: Unified Versioned<T> Architecture

  Refactored the versioning system to use a unified `Versioned<T>` class instead of separate `VersionedSchema`, `VersionedData`, and `VersionedConfig` types.

  ### Breaking Changes

  - **`VersionedSchema<T>`** is replaced by `Versioned<T>` class
  - **`VersionedData<T>`** is replaced by `VersionedRecord<T>` interface
  - **`VersionedConfig<T>`** is replaced by `VersionedPluginRecord<T>` interface
  - **`ConfigMigration<F, T>`** is replaced by `Migration<F, T>` interface
  - **`MigrationChain<T>`** is removed (use `Migration<unknown, unknown>[]`)
  - **`migrateVersionedData()`** is removed (use `versioned.parse()`)
  - **`ConfigMigrationRunner`** is removed (migrations are internal to Versioned)

  ### Migration Guide

  Before:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: {
      version: 1,
      schema: mySchema,
      migrations: [],
    },
  };
  const data = await migrateVersionedData(stored, 1, migrations);
  ```

  After:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: new Versioned({
      version: 1,
      schema: mySchema,
      migrations: [],
    }),
  };
  const data = await strategy.config.parse(stored);
  ```

- Updated dependencies [ffc28f6]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/backend-api@1.0.0
