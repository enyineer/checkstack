---
"@checkstack/tracestream-common": minor
"@checkstack/tracestream-backend": minor
"@checkstack/tracestream-frontend": minor
"@checkstack/ui": minor
---

Introduce tracestream: distributed-tracing streams with OTLP ingestion,
tail-based sampling, trace search and waterfalls.

- `tracestream-common`: team-scoped stream contract (mirrors the reviewed
  log/metric stream RLAC modes), fully-defaulted stream config (retention
  tiers, sampling policy, caps, rate limits), `cktr_` source-token format,
  trace/span/summary DTOs, browser-safe OTLP + native span decoding
  (hostile-input hardened), realtime signals.
- `tracestream-backend`: port-based storage (spans, tri-state trace summaries,
  per-operation minute/hourly buckets with t-digest p95, service/operation
  catalog with caps), tail-based sampling jobs (keep all error traces, slow
  traces over the configured threshold, and a deterministic baseline sample;
  hot sweep, rollup, cleanup, silence detection), OTLP/HTTP + native ingest
  endpoints with per-stream tokens, buffering and caps, the full query API
  (keyset trace search, waterfall reads, RED buckets, overview, cross-stream
  `findTraceById`), and the TRACES sink for the telemetry platform (trace
  streams are now bindable telemetry source targets).
- `tracestream-frontend`: stream list + detail (Overview / Traces / Services /
  Settings), trace search with keyset paging, trace waterfall view with span
  detail panel, sampling policy editor with plain-language copy, tokens +
  ship-instructions (OTel SDK env vars, Collector YAML, native JSON), and the
  telemetry Sources embed.
- `ui`: new `TraceWaterfall` chart component (virtualized hierarchical span
  waterfall with service color lanes, collapse/expand and error highlighting)
  with Storybook story.
