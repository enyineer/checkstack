---
title: Metric streams backend
description: Architecture of metric ingestion, push endpoints and telemetry-platform sources, series storage and counter math, cardinality bounds, and the health integration.
---

The metric-stream plugin ingests metrics from pluggable sources, folds them into per-minute series aggregates, and exposes each stream as a health-check strategy. It lives in `metricstream-{common,backend,frontend}` and deliberately mirrors the [log streams backend](/checkstack/developer-guide/backend/logstream/): the same package shape, RLAC model, token scheme, flush design, retention tiers, and reference-protection lessons. Shared ingest primitives (source-token kit, authenticator with negative caching, pre-auth rate limiting, capped body reading, the bounded buffer and flush loop, and the OTLP wire codec) come from `@checkstack/ingest-utils`, extracted from logstream so both plugins run one implementation.

## Where metrics enter

Metrics reach a stream two ways, both feeding the one shared `MetricIngestSink` so clamping, buffering, cardinality caps and folding apply uniformly no matter the entry path:

- **Push endpoints.** `metricstream-backend` wires its two push handlers directly against the shared sink and the `ckms_` authenticator: OTLP/HTTP (`/api/metricstream/v1/metrics`, protobuf + JSON + gzip, `partialSuccess` accounting) and native JSON (`/api/metricstream/ingest`). The authenticator's token lookup is the platform's push-token verifier scoped to the `metricstream.push` [push source type](/checkstack/developer-guide/backend/telemetry-sources/#push-sources) and the `metrics` signal, so metricstream owns no token storage; tokens are minted, rotated, and revoked on the push source, and the ingest cache converges on the `telemetry.push-token.invalidated` hook (filtered to `metricstream.push`). A single pod-local soft rate limiter is shared by both handlers so a stream's per-minute budget is counted across them.
- **Telemetry-platform sources.** Configured ingestion (a Prometheus scrape) is a [telemetry source type](/checkstack/developer-guide/backend/telemetry-sources/), not a metricstream-owned mechanism. metricstream contributes the `metricstream.prometheus-scrape` pull source type, the `metricstream.push` push source type, and a `metrics` sink to the telemetry platform; the platform owns scheduling (its core reconciler) and satellite dispatch (the generic `telemetry-pull` capability), and routes the parsed series into the bound stream through the sink.

> [!NOTE]
> The old metricstream-owned scrape-target feature is GONE: there is no `metricstream.source` extension point, no `metricstream-scrape` queue, no scrape-target CRUD/UI, and no private satellite `metric-scrape` capability. Existing scrape targets auto-migrate into `metricstream.prometheus-scrape` telemetry source instances (telemetry-backend drizzle `0001`), and a metricstream boot one-shot re-keys any inline-secret bearer into the telemetry platform's own secret channel. The legacy `metric_scrape_targets` table is retained read-only as the migration source and can be dropped in a future release.

The Prometheus scrape's URL passes the foundation SSRF egress guard (scheme allowlist plus the metadata/link-local deny ranges), whether it runs on core or a satellite; private RFC1918 space is deliberately allowed because internal exporters are the primary use case - the same trust model as the HTTP health check.

## Datapoints, series, and counter math

Every source normalizes to one shape: name, type (gauge or counter - histograms and summaries are decomposed at the parser into `_sum`/`_count` counters), labels (with a small allowlist of OTLP resource attributes folded in), a value, and a clamped timestamp. Series identity is a deterministic hash of stream, name, and canonical labels, so any pod computes the same id.

Minute buckets per series carry `count/sum/min/max/last/lastTs/deltaSum`. Counters store their cumulative value in `last`; **rates and increases are computed at read time** by differencing successive buckets' cumulative values with reset detection (a decrease means the process restarted; the new value is the delta). Delta-temporality OTLP sums fold into `deltaSum` instead, and the series' counter flavor picks the read branch. This keeps ingestion stateless and multi-pod safe: no per-series memory anywhere. Reads that span the minute-to-hourly rollup boundary stitch both tiers (with the distinct-series union for series counts), so long windows never silently underreport.

## Bounds

- **Cardinality**: new series past the stream's `seriesCap` are dropped at flush (best-effort per pod-flush; bounded, self-correcting cross-pod overshoot), counted on the activity row, and surfaced as a deduplicated `series_cap` important event.
- **Requests**: per-request datapoint caps, body-size and gzip-inflation caps, per-stream soft rate limits, and the pre-auth per-IP limiter mirror logstream exactly.
- **Storage**: minute buckets roll into hourly atomically and age out per the stream's retention config; series and name registry rows are removed once their data is gone - unless a health check references the metric name, which protects the registry entries (the logstream protected-pattern lesson applied from day one).
- A responsiveness load guard (`load-guard.it.test.ts`) locks in event-loop and same-pool probe latency bounds at 20k+ datapoints per second offered, with exact accepted-versus-persisted accounting.

## Health integration

The `metricstream` strategy (Observability) probes nothing; `createClient` verifies the stream exists and hands the collector a windowed reader. The `metric-window` collector selects series by metric name plus exact label filters, aggregates across them (sum-weighted average, min-of-mins, max-of-maxs, latest-by-timestamp last), and exposes `lastValue/avgValue/minValue/maxValue/sampleCount/seriesCount/ratePerSecond/increase/secondsSinceLastSample` - all numeric and assertable, all anomaly-disabled (arbitrary domains), with zero-sample windows reporting zeros plus `sampleCount: 0` so users pair value assertions with a sample-count guard. Collector rule: only a database failure throws.

The editor's dropdowns are contributed through healthcheck's options-resolver slot: stream picker, searchable metric-name picker, and per-row label key/value pickers. The label-filter rows use DynamicForm's row-scoped resolver values (`scopeArrayItemFormValues` in `@checkstack/ui`), so each row's value options follow that row's key - the mechanism is guarded by a rendering test with a mutation-detection proof.
