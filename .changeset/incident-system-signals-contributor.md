---
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": patch
---

feat(incident): contribute incident signals to the backend system.issues aggregator

The incident plugin now registers a `system.issues` contributor (sourceId
`incident`) from its backend `init`, so the AI assistant surfaces open incidents
alongside SLOs, health checks, anomalies, and dependency problems.

The contributor enforces its own `incident.read` access gate (returning an empty
map - never throwing - when the principal lacks access; service users carry no
access rules and so get no signals), then reads every OPEN (not-resolved)
incident for all systems from the shared, durable `incidents` +
`incident_systems` tables via a new global `listOpenIncidentsBySystem` service
method. The answer is therefore identical on every pod, and only systems with an
open incident appear in the result.

The row->signal mapping (source/tone/label/detail/href/accessRule/since/iconName)
is extracted into a new pure `deriveIncidentSignals` deriver in
`@checkstack/incident-common`, shared by both the backend contributor and the
frontend `IncidentSignalsFiller` so the two surfaces stay in lockstep. The
frontend filler now delegates to that deriver with unchanged behavior.
