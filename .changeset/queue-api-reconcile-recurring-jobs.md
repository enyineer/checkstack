---
"@checkstack/queue-api": minor
"@checkstack/metricstream-backend": patch
"@checkstack/telemetry-backend": patch
---

Add `reconcileRecurringJobs`, a shared convergence helper for recurring queue
jobs. It (re-)schedules a desired set of jobs by stable jobId and cancels every
existing recurring job the caller owns (`ownsJobId`) that is no longer desired,
running schedules and cancels concurrently. The metricstream Prometheus scrape
scheduler and the telemetry pull reconciler now both use it instead of
hand-rolling the same list/schedule/cancel dance, with identical behaviour.
