---
"@checkstack/queue-bullmq-backend": minor
---

Set explicit BullMQ worker lock/stalled tuning for the durability path.

The BullMQ `Worker` previously set no `lockDuration` / `stalledInterval` / `maxStalledCount`, so BullMQ's implicit defaults (30s lock, 30s stalled check, 1 max-stalled) applied. These are now configured explicitly so the durability contract is intentional and stable across BullMQ upgrades:

- `lockDuration: 30_000` - BullMQ automatically renews the lock at `lockDuration/2` while the processor promise is pending, so no manual `extendLock` is needed. Dispatch jobs are short (one run); any delay / wait suspends and releases the job rather than blocking, so no job blocks longer than `lockDuration`.
- `stalledInterval: 30_000` and `maxStalledCount: 1` - a worker that dies mid-job has its lock expire after `lockDuration`; the stalled check then redelivers the job once. This is the crash-recovery path for in-flight dispatch work.

No behavioral change versus the prior implicit defaults; this makes the durability tuning explicit and documents the reasoning inline. The per-run Postgres advisory lock and the heartbeat stalled-sweeper are unchanged (both retained, different scopes).
