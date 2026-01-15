---
"@checkstack/queue-memory-backend": minor
---

Changed recurring job scheduling from completion-based to wall-clock scheduling.

**Breaking Change:** Recurring jobs now run on a fixed interval (like BullMQ) regardless of whether the previous job has completed. If a job takes longer than `intervalSeconds`, multiple jobs may run concurrently.

**Improvements:**
- Fixed job ID collision bug when rescheduling within the same millisecond
- Configuration updates via `scheduleRecurring()` now properly cancel old intervals before starting new ones
- Added `heartbeatIntervalMs` to config for resilient job recovery after system sleep
