---
"@checkstack/healthcheck-backend": minor
---

fix: stop a single transient health check failure from escalating to "unhealthy"

In consecutive threshold mode, when a run failed but the failure streak had
not yet reached the configured degraded threshold (and there were not yet
enough successes to confirm healthy), the evaluator fell back to the raw
status of the latest run. A single failing run (e.g. a check timeout) that
recovered on the next run therefore flipped the system to "unhealthy" and
fired a spurious "System health critical" notification before the configured
consecutive-failure count (default 2 for degraded, 5 for unhealthy) was
reached.

The evaluator now falls back to "healthy" in this case, matching window mode's
behaviour and the intent of the thresholds: a transient blip below the
degraded threshold no longer escalates the system status.
