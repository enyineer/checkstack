---
"@checkstack/backend": minor
"@checkstack/queue-memory-backend": patch
---

Add a queue-backlog metric and fix the in-memory queue's backlog accounting so
the metric is trustworthy under saturation - the single most important signal
for whether health-check (or any queue) work is keeping up at scale.

- **New `checkstack.queue.jobs` observable gauge** (`state="pending"|"processing"`),
  registered by the host once the QueueManager exists. `pending` is the backlog;
  if it climbs without draining, work is arriving faster than the queue
  concurrency can execute it. No-op unless metrics are enabled.
- **Fix: the in-memory queue undercounted `pending`.** `processNext` removed a
  job from the pending list and only THEN awaited a concurrency slot in
  `processJob`, so jobs blocked waiting for a slot were invisible - not in
  `pending`, not yet in `processing`. Under saturation the reported backlog read
  ~0 while hundreds of jobs were actually queued. Such slot-waiters are now
  counted in `pending`, so `getStats()` (and the gauge, and the runtime panel)
  reflect the true depth. `processing` still counts only executing jobs.

This surfaced from a scale harness driving the real hot path: 20% unreachable
checks (which pin a concurrency slot for the full timeout) drove the backlog from
0 to 700+ in 35s while lock-pool waiting stayed at 0 - i.e. the first scaling
ceiling is concurrency-slot saturation by slow checks, not the database.
