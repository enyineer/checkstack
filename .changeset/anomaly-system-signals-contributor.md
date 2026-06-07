---
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-frontend": patch
---

feat(anomaly): contribute anomaly signals to the backend system.issues aggregator

The anomaly plugin now registers a `system.issues` contributor (sourceId
`anomaly`) from its backend `init`, so the AI assistant surfaces confirmed
anomalies and suspicious states alongside incidents, SLOs, health checks, and
dependency problems.

The contributor enforces its own `anomaly_feed.read` access gate (returning an
empty map - never throwing - when the principal lacks access; service users are
trusted), then reads the current problem rows for every system from the shared,
durable `anomalies` table via a new global `getActiveSignalAnomalies` service
method (state = anomaly | suspicious, suppressed rows excluded). The answer is
therefore identical on every pod, and only systems with a current problem appear
in the result.

The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
extracted into a new pure `deriveAnomalySignals` deriver in
`@checkstack/anomaly-common`, shared by both the backend contributor and the
frontend `AnomalySignalsFiller` so the two surfaces stay in lockstep. The
frontend filler now delegates to that deriver with unchanged behavior.
