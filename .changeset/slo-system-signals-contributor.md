---
"@checkstack/slo-common": minor
"@checkstack/slo-backend": minor
"@checkstack/slo-frontend": patch
---

feat(slo): contribute SLO signals to the backend system.issues aggregator

The SLO plugin now registers a `system.issues` contributor (sourceId `slo`) from
its backend `init`, so the AI assistant surfaces breaching, degraded, and at-risk
objectives alongside incidents, anomalies, health checks, and dependency
problems.

The contributor enforces its own `slo.read` access gate (returning an empty map -
never throwing - when the principal lacks access; service users are trusted),
then reads every objective for all systems from the shared, durable
`slo_objectives` table via the existing global `listObjectives` service method and
computes each objective's current status with the engine. The answer is therefore
identical on every pod, and only systems with a current problem appear in the
result.

The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
extracted into a new pure `deriveSloSignals` deriver in `@checkstack/slo-common`,
shared by both the backend contributor and the frontend `SloSignalsFiller` so the
two surfaces stay in lockstep. The frontend filler now delegates to that deriver
with unchanged behavior.
