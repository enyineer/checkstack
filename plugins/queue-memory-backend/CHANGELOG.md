# @checkstack/queue-memory-backend

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
