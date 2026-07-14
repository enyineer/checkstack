---
"@checkstack/satellite": minor
---

Add the `telemetry-pull` capability to the satellite agent: satellite-bound
telemetry pull-source instances execute at the edge. The agent receives a
per-satellite instance config (secrets excluded - fetched just-in-time per
field over the authenticated socket and cached only between config pushes),
schedules one timer per instance with a concurrency cap, runs the source
type's statically-linked `SatellitePullExecutor`, drops records for unbound
signals, forwards batches for binding-authorized re-ingestion on core, and
mirrors per-instance run status. A source type with no executor registered in
this satellite build reports a per-instance status error instead of failing.
Advertised via `CHECKSTACK_SATELLITE_TELEMETRY_PULL`.
