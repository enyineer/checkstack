---
"@checkstack/metricstream-backend": minor
---

Add the metric-stream health integration and management/read API.

Health: a `metricstream` health-check strategy (`StrategyCategory.OBSERVABILITY`,
config `{ streamId }` via the `metricstreamStreamId` resolver) that resolves the
stream and hands the collector a windowed read handle, and one `metric-window`
collector. The collector selects the series matching a
`(metricName, labelFilters)` exact-match selection, reads pre-aggregated minute
buckets over a complete-minute plus in-progress-minute window, and exposes
`lastValue`, `avgValue` (sample-weighted), `minValue`, `maxValue`, `sampleCount`,
`seriesCount`, `ratePerSecond`, `increase` and `secondsSinceLastSample` as
numeric, chart-annotated, assertable fields. Counter rate/increase are computed
at read time - reset-aware cumulative differencing, or the summed per-interval
`deltaSum` for delta-temporality counters - and are 0 for gauges; anomaly
detection is disabled on every field because a metric stream carries arbitrary
domains. Never-seen selections fall back to stream age for staleness. DTO
conformance tests guard the strategy/collector picker shapes.

API: the RPC router + service for stream CRUD, `ckms_` source-token mint/revoke
(with ingest-auth cache + cross-pod invalidation), Prometheus scrape-target CRUD
(bearer token stored encrypted via the internal secret store), metric-name /
label-key / label-value / series autocomplete, windowed chart buckets (with
minute↔hour cross-tier merge), important-events and stream overview reads, and a
full delete-stream cascade (all stream-scoped tables, ReBAC grants, token caches
and scrape-target secrets). RLAC follows the frozen contract's instanceAccess
modes (`listKey` id, `idParam`, `create`, `typeScoped`).

Maintenance: a `metricstream-maintenance` queue running per-stream minute→hourly
rollup (atomic batches), reference-aware hourly/event/series/name retention
(referenced metric names are spared while a check points at them), and silence /
silence-recovered detection.

Ingestion: three built-in metric sources registered through the new
`metricstream.source` extension point (so future source types plug in without
core changes) - OTLP/HTTP metrics push (`/v1/metrics`, protobuf + JSON + gzip,
`partialSuccess` accounting; histogram/summary datapoints decomposed to
`_sum`/`_count` counters, delta vs cumulative temporality tracked per series),
a native JSON push endpoint (`/ingest`), and Prometheus scraping (text
exposition parser, per-target recurring jobs with a convergence reconciler,
cluster-consistent failure tracking surfacing `scrape_failing` events).
All sources feed one sink: `ckms_` source-token auth with negative caching and
pre-auth rate limiting, timestamp clamping, a bounded line+byte buffer, and a
batched per-stream flush that upserts series/name registries and per-minute
aggregates while enforcing the per-stream series-cardinality cap (overflow
series are dropped, counted and surfaced as `series_cap` events). A
responsiveness load guard (integration test) locks in event-loop and
control-path latency bounds at 20k+ datapoints/s.
