---
"@checkstack/queue-memory-backend": patch
"@checkstack/queue-bullmq-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-frontend": patch
---

Cut health-check connection churn and de-cluster the scheduling "thundering
herd" so per-run durations stop varying wildly for the same check against the
same target. Grounded in live OpenTelemetry phase histograms: per-run wall time
was dominated by TCP/TLS connection setup under a self-inflicted burst, not by
slow targets, CPU, or the database.

- **In-memory queue now honors `startDelay` in `scheduleRecurring`.** It was
  silently dropped, so every recurring job (health checks included) fired
  immediately on boot and then on a boot-anchored interval grid - keeping all
  equal-interval checks phase-aligned forever. `scheduleRecurring` now defers the
  first execution by `startDelay` and anchors the recurrence to that first fire,
  matching the queue contract and the BullMQ backend's intent. Jobs scheduled
  without `startDelay` are unchanged (first run is immediate).
- **The BullMQ queue now honors `startDelay` in `scheduleRecurring` too.** It also
  dropped `startDelay`, and its `every` scheduler captures the grid phase from
  whenever `upsertJobScheduler` first runs - so a bootstrap loop scheduling many
  equal-interval jobs at ~the same instant handed them all the same phase.
  `scheduleRecurring` now pins the first fire to `now + startDelay` via the
  scheduler's `startDate`, which shifts the whole recurrence, so the same jittered
  `startDelay` de-clusters checks on the Redis backend identically to the
  in-memory one. Cron schedules (absolute times) are unaffected.
- **The health-check scheduler jitters each check's first fire** by a small,
  deterministic fraction of its interval (stable across restarts, keyed on the
  check). A synchronized set of checks now spreads across the interval instead of
  hammering their targets at the same instant. Because the queue anchors the
  recurrence to the first fire, this offset persists for every subsequent run.
- **The HTTP collector refreshes its TCP/TLS connect-timing probe in the
  background, per origin, and never awaits it.** Bun's `fetch` already pools and
  reuses connections across runs (verified: warm reuse survives 20s+ idle gaps),
  but the timing probe opened a fresh handshake on EVERY run - mis-reporting the
  reused request's real latency and doubling the connection count under a burst.
  The probe now refreshes a per-origin sample at most once per TTL (60s) and runs
  fully in the background: it is NEVER on a request's critical path. Pinned to one
  resolved IP, the probe can be far slower than the reused fetch (e.g. an
  intermittent IPv6 SYN retry the real request never pays), and per the collector
  contract best-effort timing must never delay the check - the previous code
  `await`ed it, so a slow probe's refresh run showed up as a latency outlier. The
  `connect`/`tls` phases are now explicitly a cached, per-host estimate.
- **The run detail UI now labels the estimate.** The timing-breakdown caption
  clarifies that DNS, wait, and transfer are measured on the request, while
  connection and TLS setup are an estimate sampled from a periodic per-host probe
  and cached briefly (about a minute), so an operator does not read the cached
  connect/TLS value as a per-run measurement.

Behaviour is otherwise unchanged: health status and assertions are the same;
there are simply far fewer connections, the herd is spread out, and the timing
breakdown can no longer be inflated by a slow best-effort probe. No configuration
or API changes.