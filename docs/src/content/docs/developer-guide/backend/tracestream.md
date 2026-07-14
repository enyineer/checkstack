---
title: "Trace streams"
description: "Distributed tracing in Checkstack: OTLP span ingestion into trace streams, tail-based sampling, storage tiers and the trace query API."
---

The tracestream plugin adds the third observability signal next to log streams and metric streams: a **trace stream** receives spans (OTLP or native JSON), keeps a searchable per-trace summary index, tail-samples which traces retain their full span data, and aggregates per-operation RED buckets with real p95 latency. Trace streams are team-scopable exactly like their siblings, and they contribute the `traces` sink to the [telemetry platform](/checkstack/developer-guide/backend/telemetry-sources/), so configured telemetry sources can route spans into a bound trace stream.

## Architecture

```text
core/tracestream-common    -> stream/span/summary contracts, config schema,
                              cktr_ token format, browser-safe OTLP + native
                              span decoding, signals
core/tracestream-backend   -> port-based storage, tail-sampling jobs, ingest
                              endpoints + pipeline, query API, traces sink
core/tracestream-frontend  -> stream list/detail, trace search, waterfall
                              view, sampling editor, ship instructions
@checkstack/ui             -> TraceWaterfall chart component
```

All storage access goes through **port interfaces** (`src/storage/ports.ts`); the Postgres adapters are the only drizzle consumers. This is the deliberate seam for a future alternative trace store.

## Ingestion

Two token-authenticated push endpoints (per-stream `cktr_` source tokens, hash-only storage, shown once):

- `POST /api/tracestream/v1/traces` - OTLP/HTTP `ExportTraceServiceRequest`, protobuf and JSON, gzip-aware, answering `ExportTraceServiceResponse` with `partialSuccess.rejectedSpans`.
- `POST /api/tracestream/ingest` - native JSON spans for shippers without OTel tooling.

Point an OTel SDK at a stream with the per-signal env vars (the stream's Settings tab renders ready-to-copy snippets):

```env
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://checkstack.example.com/api/tracestream/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer cktr_...
```

Ingest applies the stream's policy before anything is stored: soft rate limit (429 + Retry-After), `maxSpansPerTrace`, `maxSpanBytes` (oversized attribute payloads are dropped and surfaced as an important event), then a pod-local buffer with a 500 ms / 1000-span flush. Each stream's flush writes spans, upserts the trace summary, folds per-operation buckets and touches the service/operation catalog in one transaction.

## Tail-based sampling

Head sampling drops exactly the traces an operator cares about, so tracestream decides retention AFTER a trace completes:

- Every span updates the trace's summary row (`retained = null` while undecided). RED buckets fold ALL spans before sampling, so service/operation stats stay exact regardless of the sampling verdict.
- A decision job (every 60 s) picks summaries idle past `completionGraceSeconds` and applies the stream's policy: error traces are kept (`keepErrorTraces`), traces slower than `slowTraceThresholdMs` are kept, and a deterministic hash of the trace id keeps a `baselineSampleRate` sample. An optional `maxRetainedTracesPerHour` budget demotes baseline-sampled traces first - error and slow traces are never demoted.
- A hot sweep deletes span data of unretained traces after `hotRetentionHours`; retained spans live `retainedTraceRetentionDays`; summaries remain searchable for `summaryRetentionDays`; minute buckets roll up into hourly (t-digest merge preserves p95) and expire per the retention tiers.

> [!NOTE]
> Summaries outlive spans on purpose: a trace stays findable (and countable in overviews) after its span data expired; the UI marks it as no longer expanded.

## Query API

The contract (`@checkstack/tracestream-common`) mirrors the reviewed stream RLAC modes. The notable reads: `searchTraces` (keyset-paginated summary search by service, operation, status, duration and time), `getTrace` (summary + spans for the waterfall), `getOpBuckets` (per-operation RED buckets with digest-backed `p95Ms`), `listServices` / `listOperations`, `getStreamOverview`, and the cross-stream `findTraceById`, which post-filters matches by the caller's stream grants - it powers every "View trace" jump the correlation phase adds.

## Telemetry sink

tracestream registers the `traces` sink with the telemetry platform: normalized spans emitted by a telemetry source enter the exact same ingest pipeline (policy, caps, buckets) as the push endpoints, and bind-time authorization is answered by the stream's own access rules. With the sink in place, `traces` bindings are accepted in the sources UI and the trace stream's Settings tab embeds the platform's sources section.
