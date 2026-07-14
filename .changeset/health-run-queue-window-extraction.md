---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/logstream-backend": patch
"@checkstack/metricstream-backend": patch
---

Promote the health-check run-queue contract and the observability window
math into `@checkstack/healthcheck-common`: `HEALTH_CHECK_QUEUE`,
`HealthCheckJobPayload`, `fastPathJobId` (per-plugin prefix) and
`computeWindowBounds`/`computeSecondsSinceLast` now have ONE definition
that the queue owner (healthcheck-backend) and every observability
strategy plugin import, replacing the per-plugin mirror copies that had
to be kept in lock-step by convention. Enqueued job ids and window
semantics are byte-identical; this is a drift-proofing refactor, not a
behavior change.
