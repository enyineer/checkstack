---
"@checkstack/metricstream-common": minor
"@checkstack/metricstream-backend": minor
"@checkstack/metricstream-frontend": minor
"@checkstack/tracestream-common": minor
"@checkstack/tracestream-backend": minor
"@checkstack/tracestream-frontend": minor
---

Metric exemplars and trace drop-counter surfacing:

- Metric points now carry OTLP/OpenMetrics EXEMPLARS (trace-context samples,
  capped at 4 per point): decoded from OTLP protobuf and JSON and from the
  OpenMetrics text `# {trace_id=...}` suffix that was previously stripped,
  stored as the newest few per series (`last_exemplars`, additive
  migration), returned windowed on the chart read, and rendered as a
  diamond lane under the metric chart - clicking an exemplar resolves the
  trace via tracestream's `findTraceById` and jumps to the waterfall.
  Exemplars ride the satellite wire with full fidelity on both the
  metric-forward and telemetry-pull channels (wire schemas serialize
  exemplar timestamps as strings, so an exemplar-bearing batch parses
  cleanly core-side), flow through the metricstream telemetry sink, and
  persist by MERGING with a series' stored exemplars (newest few,
  deduped by trace id, written in one batched update per flush) so a
  chart window keeps jump-offs from earlier flushes. The chart-to-trace
  helper (`buildViewTraceHref`) is exported once from
  `@checkstack/tracestream-common`.
- The trace stream Overview now surfaces the three drop counters
  (dropped spans, dropped traces, dropped in transit) as warn-toned stat
  tiles, mirroring logstream's precedent.
