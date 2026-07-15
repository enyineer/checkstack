# @checkstack/tracestream-backend

## 0.1.0

### Minor Changes

- 6c8b36b: Metric exemplars and trace drop-counter surfacing:

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

- 6c8b36b: Push ingestion becomes a first-class telemetry PUSH source mode: a stream's
  OTLP/native push access is now a "Push (OTLP / native)" source instance on
  the stream's Sources tab - one instance per token, created with the token
  shown once, rotatable from the source row, revoked by disabling or deleting
  the instance, with "last received" liveness on the list. The seam is a
  generic platform surface any plugin can adopt for its own inbound endpoint:
  declare `push: { tokenPrefix, endpoints }` on the source type, and verify
  presented bearers with `createPushTokenLookup` (scoped to the source type -
  a token minted for one push type never authenticates another) composed with
  the shared ingest authenticator; cache convergence rides the new
  `telemetry.push-token.invalidated` cross-pod hook, which also fixes
  tracestream's previous mint-vs-negative-cache race.

  EXISTING SHIPPER TOKENS KEEP WORKING: every non-revoked stream token is
  promoted in place to a push source instance (same id, same sha256 hash,
  same `ckls_`/`ckms_`/`cktr_` prefixes), so nothing needs re-minting. A
  one-shot grant backfill mirrors each bound stream's team relations (and
  public visibility) onto the promoted instances, so team-scoped users who
  managed a stream's tokens keep managing its migrated push and scrape
  sources.

  Lifecycle correctness that shipped with the review round: deleting a
  stream now CASCADES through the platform (`handleStreamDeleted`) - bound
  sources lose that binding, sources left binding-less are fully deleted
  (secrets, schedule, team grants, push token revoked), so a deleted
  stream's shippers get 401s instead of black-holing data; a push
  instance's cached ingest verdict is evicted cluster-wide on any binding
  change, not only on disable/rotate.

  BREAKING CHANGES (platform is BETA): the per-plugin token CRUD procedures
  (`listTokens`/`mintToken`/`revokeToken`), their schemas, and the bespoke
  token UI (TokensSection, MintTokenDialog, PushEndpointsCard, ship-snippet
  components) are REMOVED from logstream, metricstream, and tracestream -
  manage push access as telemetry sources instead. The legacy
  `log_stream_tokens`/`metric_stream_tokens`/`trace_stream_tokens` tables are
  DROPPED (safe: plugin migrations run in dependency order, so the platform's
  promotion always precedes the owner's drop). All three stream detail pages
  now have a dedicated Sources tab.

- 6c8b36b: Satellite forwarding hardening:

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

- 6c8b36b: Explicit stream-to-system links and AI tool projections for all three
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

- 6c8b36b: Tracestream health checks and satellite forwarding:

  - New reader-only OBSERVABILITY health strategy (`tracestream`) with two
    collectors: `trace-window` (windowed span/trace totals, error counts,
    error rate per minute, seconds since last span) and the repeatable
    `operation-latency` (per service/operation `p95Ms`/`avgMs`/`maxMs` and
    error rate; the window p95 merges the minute buckets' t-digest states
    before computing the percentile). The check editor gets
    stream/service/operation dropdowns via shared resolver constants.
  - Fast-path re-evaluation: a flush that persists error spans enqueues the
    affected checks ahead of schedule (pod-local debounce + deterministic
    cluster-wide job id), and a new `error_spike` important event records
    trailing-average error spikes at most once per stream per 10 minutes.
  - Satellite trace forwarding: satellites with
    `CHECKSTACK_SATELLITE_TRACE_RECEIVERS=1` expose local `/v1/traces`
    (OTLP protobuf + JSON) and `/ingest/traces` (native) receivers; spans
    ride the new `tracestream` telemetry-channel wire schema (ISO dates,
    decimal-string nanosecond timestamps) and re-enter the core through a
    satellite capability handler that verifies the forwarded `cktr_` token
    with the same authenticator as direct pushes and re-clamps span times
    against the core clock before feeding the identical ingest pipeline.

- 6c8b36b: Introduce tracestream: distributed-tracing streams with OTLP ingestion,
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

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/auth-common@0.15.0
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/telemetry-backend@0.1.0
  - @checkstack/ai-backend@0.11.3
  - @checkstack/backend-api@0.34.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/tracestream-common@0.1.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/ingest-utils@0.2.0
  - @checkstack/common@0.23.0
  - @checkstack/satellite-backend@0.9.3
  - @checkstack/cache-api@0.3.20
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1
