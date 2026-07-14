---
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
"@checkstack/logstream-frontend": minor
"@checkstack/tracestream-common": minor
"@checkstack/tracestream-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Cross-signal trace correlation. Log events, traces, and health-check runs
now link to each other:

- logstream: `searchEvents` accepts an exact `traceId` filter (Explore gets
  a matching, deep-linkable filter input backed by a new partial
  `(trace_id, ts)` index), and the new cross-stream `findEventsByTraceId`
  returns per-stream match groups post-filtered by the caller's read grants.
  Streams can declare `config.traceExtraction` rules (attribute paths and a
  capture-group body regex, validated at save) that populate trace/span ids
  for non-OTLP sources at the ingest flush seam - OTLP and native reserved
  keys always win.
- Correlation slots: `LogEventDetailSlot` (logstream-common, expanded event
  row), `TraceCorrelationsSlot` (tracestream-common, trace detail view), and
  `RunDetailExtrasSlot` (healthcheck-common, run detail panel) with
  `extractRunTraceIds` owning the run-result trace-id shape.
- Fills: the trace view shows the trace's correlated log events grouped per
  readable stream; log events and health-check runs with a known trace id
  get a "View trace" jump resolved through `findTraceById`.
