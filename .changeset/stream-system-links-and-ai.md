---
"@checkstack/telemetry-common": minor
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
"@checkstack/logstream-frontend": minor
"@checkstack/metricstream-common": minor
"@checkstack/metricstream-backend": minor
"@checkstack/metricstream-frontend": minor
"@checkstack/tracestream-common": minor
"@checkstack/tracestream-backend": minor
"@checkstack/tracestream-frontend": minor
"@checkstack/catalog-frontend": minor
---

Explicit stream-to-system links and AI tool projections for all three
observability streams:

- Every stream plugin declares the same four link procedures over its own
  junction table (shared schemas in `@checkstack/telemetry-common`):
  list/replace a stream's linked systems - the write verifies the caller
  can READ every NEWLY ADDED system (one user-scoped catalog `getSystems`
  membership pass before anything persists; retained or removed links need
  no readability, so a manager is never dead-locked by a link a
  broader-privileged user authorized) - plus two read-filtered reverse
  lookups powering the catalog system page and the dashboard (chunked
  client-side, so deployments beyond the 500-system lookup cap keep their
  signals).
- catalog-frontend ships the shared `StreamSystemLinksEditor`: a
  controlled system picker with "suggested from observed service names"
  chips that a human explicitly applies - suggestions are never
  auto-linked. Suggestion sources: tracestream's service catalog,
  metricstream label values, and logstream's new bounded
  `listServiceNames` scan.
- The catalog system page gains self-hiding Logs/Metrics/Traces cards
  (SystemDetailsSlot) and the dashboard gains conservative per-stream
  signals (SystemSignalsSlot, one bulk query per plugin).
- AI tool projections: logstream (`searchLogs` slimmed, `severityStats`,
  `listStreams`), metricstream (`listStreams`, `listMetricNames`,
  `metricBuckets` - the unbounded raw-series read is deliberately not
  projected), tracestream (`searchTraces`, `getTraceSummary` with spans
  reduced to seven scalar fields, `serviceStats`, `listServices`). All
  read-only, RLAC-enforced by routed re-entry as the caller.
