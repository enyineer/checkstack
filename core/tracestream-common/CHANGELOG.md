# @checkstack/tracestream-common

## 0.1.3

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/frontend-api@0.19.0
  - @checkstack/telemetry-common@0.2.1

## 0.1.2

### Patch Changes

- 1deaac5: Make endpoint authorization self-documenting in the generated API docs

  Every procedure's authorization is now derived from its contract metadata (its
  `access` rules + `instanceAccess` mode) via a shared mode-descriptor registry and
  emitted into the OpenAPI spec - both structurally (`x-orpc-meta.authorization`)
  and as a human `**Authorization.**` sentence folded into the operation
  description. Previously the docs surfaced only a flat list of global rule ids, so
  an integrator (an API-key/application principal that CAN hold team grants) never
  saw the team-grant / per-object dimension, and endpoints gated purely in the
  handler showed no restriction at all.

  For authorization that no declarative mode can express and is therefore enforced
  in the handler (a compound OR, a graded verdict, a DB-derived id set), a new
  optional `accessNote` on the procedure metadata surfaces the real rule in the
  docs as an explicitly handler-enforced addendum. The note is documentation, not a
  guarantee: per `.claude/rules/rlac.md` the drift guard for such authz is
  behavioral tests over an extracted pure decision function, and the note must
  state exactly what those tests pin.

  Every handler-enforced authorization endpoint now carries such a note so the docs
  are complete: the team read/scoping and team-management endpoints
  (`@checkstack/auth-common`), the health-check assignment/history reads
  (`@checkstack/healthcheck-common`), the audience-graded incident/maintenance
  reads (`@checkstack/incident-common`, `@checkstack/maintenance-common`), status
  -page publish's bound-resource check (`@checkstack/status-page-common`), the
  stream `setSystemLinks` readable-additions check
  (`@checkstack/{metricstream,tracestream,logstream}-common`), and the automation
  `runAs` escalation guard (`@checkstack/automation-common`). These are
  metadata-only additions - no runtime behavior changed. The notes describe the
  rule for API-doc readers only; the drift guard is behavioral tests over the
  check's decision function (per `.claude/rules/rlac.md`), so the notes name no
  internal test files.

  The API docs viewer (`@checkstack/api-docs-frontend`) now renders each
  operation's description as Markdown, so the `**Authorization.**` block (and any
  inline `code`) formats correctly instead of showing raw markdown.

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/signal-common@0.3.2
  - @checkstack/otlp-wire@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [be74b01]
  - @checkstack/frontend-api@0.17.0
  - @checkstack/telemetry-common@0.1.1

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

- 6c8b36b: Cross-signal trace correlation. Log events, traces, and health-check runs
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
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/otlp-wire@0.1.1
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1
