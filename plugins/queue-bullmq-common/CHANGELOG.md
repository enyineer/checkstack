# @checkstack/queue-bullmq-common

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2

## 0.2.1

### Patch Changes

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0

## 0.2.0

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

- Updated dependencies [ffc28f6]
  - @checkstack/common@0.1.0
