---
"@checkstack/slo-backend": minor
"@checkstack/slo-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
---

Count incident-forced downtime against SLOs. When an incident forces a system to
degraded/unhealthy via its health override, that downtime is now recorded as an
SLO downtime event for each of the system's objectives (consuming the error
budget and appearing in the downtime history) and is closed when the incident is
resolved, deleted, or its override is cleared - and only once the system's health
checks are also healthy. Downtime is never double-counted with a concurrent
health-check outage, and one cause never closes downtime the other is still
holding open (resolving an incident while checks still fail, or checks recovering
while an override is still active, both leave the outage open).

Adds a nullable `source` column (`healthcheck` | `incident`, NULL read as
`healthcheck`) to `slo_downtime_events` and a `DowntimeSource` schema in
slo-common, so the cause of each downtime event is recorded and the orphan
self-heal skips incident-owned events. incident-backend now emits an
`incident.lifecycle.changed` hook (contract in incident-common) on every incident
lifecycle change - including override-only edits that the reactive `incident`
entity change does not surface - which slo-backend subscribes to with
exactly-once delivery to reconcile downtime.
