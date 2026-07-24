---
"@checkstack/healthcheck-backend": minor
"@checkstack/satellite": patch
---

Drive satellite health results through the same reactive/notify path as local runs

A satellite-detected health change previously did almost nothing on the core:
`ingestSatelliteResult` inserted the run row and invalidated the cache, and
stopped there. A LOCAL run additionally drives the whole reactive layer - the
`health` entity write (which fires the ENTITY_CHANGED that automations and
triggers key on), the state-transition record, the subscriber notification, the
checkCompleted/checkFailed automation hooks, and the realtime signals. So a
satellite that detected an outage fired **no notifications, no automations, no
transition record, and no realtime signal** - satellite monitoring was
effectively silent.

Both paths now run through ONE shared function, `persistRunAndReact`, so a
satellite result reacts exactly like a local one. The host binds the service
dependencies once and hands the router a narrowed reactor, so the local and
satellite callers cannot pass different dependencies and drift apart again
(`ingestSatelliteResult` was itself a duplicated-and-drifted copy of the local
persistence path - this removes the duplication that caused it). Ingest now
splits into `processSatelliteResult` (evaluate assertions, strip ephemeral
fields, resolve the check name) plus the shared reactive path.

Also fixed: a satellite collector's transport error is now annotated as
`_collectorError` on the stored result, matching a local run - the satellite
previously dropped that annotation.

Coverage: added tests that a satellite result is routed through the shared
reactor with its processed payload (guarding against a silent regression back
to insert-only), and extracted the satellite's `executeAssignment` into a
testable module with tests for custom-field template expansion, probe-measured
timings, the `_collectorError` annotation, and the strategy-not-loaded path.
