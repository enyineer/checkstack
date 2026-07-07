---
"@checkstack/queue-memory-backend": patch
"@checkstack/queue-bullmq-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-http-backend": patch
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
- **The HTTP collector caches its TCP/TLS connect-timing probe per origin.** Bun's
  `fetch` already pools and reuses connections across runs (verified: warm reuse
  survives 20s+ idle gaps), but the timing probe opened a fresh handshake on
  EVERY run - mis-reporting the reused request's real latency and doubling the
  connection count under a burst. The probe now runs at most once per origin per
  TTL (60s) and the sample is reused in between, so steady-state runs pay only the
  reused fetch while the `connect`/`tls` metrics stay populated. Measured: probe
  handshakes dropped from one-per-run to one-per-origin-per-minute.

Behaviour is otherwise unchanged: health status, assertions, and the reported
timing phases are the same; there are simply far fewer connections and the herd
is spread out. No configuration or API changes.