---
"@checkstack/ingest-utils": minor
"@checkstack/tracestream-backend": minor
"@checkstack/satellite": patch
"@checkstack/logstream-backend": patch
"@checkstack/metricstream-backend": patch
---

Satellite forwarding hardening:

- tracestream now persists per-stream satellite in-transit drop counts at
  parity with logstream/metricstream: a `dropped_in_transit_count` column
  on the activity table (additive migration) incremented durably by the
  capability handler (best-effort; an accounting failure can never change
  a batch's ack).
- The satellite receivers' batch chunking and byte-budget estimation now
  live once in `@checkstack/ingest-utils` (`chunkTelemetryBatchItems`,
  `estimateTelemetryItemBytes`); the log/metric/trace receivers keep only
  their per-signal item shapes and caps. Behavior is pinned unchanged by
  the receivers' existing tests.
