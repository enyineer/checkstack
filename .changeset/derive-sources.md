---
"@checkstack/telemetry-common": minor
"@checkstack/telemetry-backend": minor
"@checkstack/telemetry-frontend": minor
"@checkstack/logstream-backend": minor
---

Signal-to-signal DERIVE sources: the telemetry platform gains a fourth
source mode - a derive source consumes one signal's already-ingested
records from a configured input stream and emits another signal. Two
built-in types ship: `log-to-metric` (count matching lines per flush as a
delta counter, or extract a numeric attribute as a gauge; substring +
severity filters only - no user regex on the ingest hot path) and
`log-to-trace` (logs already carrying full W3C trace context become
spans; span ids are never synthesized). Sink-owning plugins feed the
dispatcher through a buffered record tap; logstream connects its
post-flush batches (best-effort and error-isolated - a deriver can never
fail or slow ingest: the dispatch is detached from the flush cycle, and
the tap passes records as a lazy thunk the dispatcher only materializes
when a derive instance actually matches the stream, so streams without
derive sources pay zero conversion cost). The dispatcher's pod-local
source cache is generation-guarded so an invalidation during an
in-flight rebuild can never wedge a pod on a stale derive set, and
`log-to-metric` caps distinct label tuples per batch (100) so a
high-cardinality attribute path cannot mint unbounded series. The
source editor gets bespoke config forms with a proper input-stream
picker.
