---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": patch
---

feat(healthcheck): contribute health problems to the backend system.issues aggregator

The healthcheck plugin now registers a `system.issues` contributor (sourceId
`healthcheck`) from its backend `init`, so the AI assistant surfaces degraded
and unhealthy systems alongside incidents, SLOs, anomalies, and dependency
problems.

The contributor enforces its own `healthcheck.status` access gate (returning an
empty map - never throwing - when the principal lacks access; service users get
no signals), then reads the current problem rows for every system from the
shared, durable `health_check_runs` / `system_health_checks` tables via a new
global `getAllUnhealthySystemStatuses` service method (every system with an
enabled check association, evaluated with the same per-system evaluator the
dashboard uses, healthy systems omitted). The answer is therefore identical on
every pod, and only systems with a current problem appear in the result.

The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
extracted into a new pure `deriveHealthcheckSignals` deriver in
`@checkstack/healthcheck-common`, shared by both the backend contributor and the
frontend `HealthSignalsFiller` so the two surfaces stay in lockstep. The
frontend filler now delegates to that deriver with unchanged behavior.
