---
"@checkmate-monitor/queue-api": minor
"@checkmate-monitor/queue-bullmq-backend": minor
"@checkmate-monitor/queue-bullmq-common": minor
"@checkmate-monitor/queue-memory-backend": patch
"@checkmate-monitor/healthcheck-backend": patch
"@checkmate-monitor/test-utils-backend": patch
---

Add BullMQ queue plugin with orphaned job cleanup

- **queue-api**: Added `listRecurringJobs()` method to Queue interface for detecting orphaned jobs
- **queue-bullmq-backend**: New plugin implementing BullMQ (Redis) queue backend with job schedulers, consumer groups, and distributed job persistence
- **queue-bullmq-common**: New common package with queue permissions
- **queue-memory-backend**: Implemented `listRecurringJobs()` for in-memory queue
- **healthcheck-backend**: Enhanced `bootstrapHealthChecks` to clean up orphaned job schedulers using `listRecurringJobs()`
- **test-utils-backend**: Added `listRecurringJobs()` to mock queue factory

This enables production-ready distributed queue processing with Redis persistence and automatic cleanup of orphaned jobs when health checks are deleted.
