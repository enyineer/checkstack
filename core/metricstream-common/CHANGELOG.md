# @checkstack/metricstream-common

## 0.2.2

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
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/signal-common@0.3.2
  - @checkstack/otlp-wire@0.1.1

## 0.2.1

### Patch Changes

- @checkstack/telemetry-common@0.1.1

## 0.2.0

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

- 6c8b36b: Prometheus scraping now runs on the telemetry platform as the pull source
  type `metricstream.prometheus-scrape` - the canonical reference for
  external source types. Existing scrape targets are migrated in place: a
  guarded cross-schema data migration copies every target into
  `telemetry_sources` (bindings, interval, satellite assignment, state), and
  a one-shot re-keys encrypted bearer tokens under the platform's secret
  store; `${{ secrets.NAME }}` references pass through unchanged. The
  per-stream Sources tab keeps one UX: the platform's sources section.

  Parity and correctness details: the telemetry pull seam gains optional
  `onRunFailure`/`onRunRecovery` health hooks (invoked with the stored
  consecutive-failure count on both core-scheduled and satellite-reported
  runs), which the scrape source type uses to keep emitting the
  `scrape_failing` important event exactly when three consecutive
  failures are crossed - once per outage episode, as before the
  migration. Satellite execution honors the instance's own `timeoutMs`
  (previously hard-capped at the platform's 30s default), resolves
  just-in-time secrets fresh per run so a rotated `${{ secrets.NAME }}`
  reference takes effect on the next scrape, and shares one
  size/series-capped response reader with the core path. The bearer
  re-key pass isolates per-source failures so one broken source cannot
  stall the rest, and a satellite still configured with the removed
  `CHECKSTACK_SATELLITE_SCRAPE` env var logs an explicit startup warning.
  Telemetry listener sources additionally only bind on the DEFAULT
  instance, so a namespaced secondary instance (PR preview) can never
  race the primary for listener ports.

  BREAKING CHANGES (platform is BETA): metricstream's private source
  extension point (`metricSourceExtensionPoint`) and the scrape-target CRUD
  procedures, schemas, and UI are REMOVED outright - manage scrape targets
  as telemetry sources instead. The satellite `scrape` capability
  (`CHECKSTACK_SATELLITE_SCRAPE`) is removed; satellites execute Prometheus
  scrapes through the `telemetry-pull` capability
  (`CHECKSTACK_SATELLITE_TELEMETRY_PULL`) via the statically-linked pull
  executor - update satellite deployment env accordingly. The legacy
  `metric_scrape_targets` table is DROPPED in the same release: plugin
  migrations run in dependency order, so the platform's promotion migration
  is guaranteed to precede metricstream's drop, and the bearer re-key
  one-shot now also deletes each migrated internal secret after re-keying
  it, leaving no orphans.

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

### Patch Changes

- 6c8b36b: Fix important-events pagination losing same-millisecond events at page
  boundaries. The timeline paged on `ts` alone (`before`/`nextBefore`), so when a
  page boundary fell inside a cluster of events sharing a millisecond (cap / rate
  / throttle / pattern events fire in bursts at the same `ts`), rows were skipped
  or served twice. Both plugins now use a tuple keyset cursor `{ ts, id }` with
  `(ts DESC, id DESC)` ordering and a strict tuple comparison, matching
  tracestream.

  BREAKING CHANGE: the `listImportantEvents` contract shape changes -
  `before` -> `cursor: { ts, id }` on input and `nextBefore` -> `nextCursor:
{ ts, id }` on output (no back-compat alias). Timeline UIs that only read the
  first page are unaffected; any paginating caller must pass and read the new
  cursor.

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/otlp-wire@0.1.1
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1

## 0.1.0

### Minor Changes

- 4568dcc: New package: contracts and shared types for Metric Streams. Carries the stream /
  token / scrape-target / autocomplete / bucket-read RPC contract with per-proc
  instance-access modes, the metric stream config schema (series-cardinality cap,
  retention tiers, ingest budgets), normalized datapoint and series DTOs, the
  `ckms_` source-token format helpers (browser-safe), resource-scoped activity and
  important-event signals, and the health-editor resolver name constants.
- 4568dcc: Add satellite telemetry for metric streams: forward push telemetry through
  satellites and scrape Prometheus targets FROM a satellite instead of core.

  metricstream-backend now contributes two handlers to satellite-backend's
  capability extension point (dependency inversion - the domain plugin
  contributes; satellite-backend never imports metricstream):

  - **kind `metricstream`**: a satellite receiver forwards push telemetry it
    accepted for one or more streams (payload is an array of `{ streamToken,
datapoints }` groups). Authorized end to end by each stream's `ckms_` source
    token (verified on core exactly like the HTTP push path); a bad/revoked token
    drops that group non-retryably. Forwarded datapoints go through the SAME
    ingest sink the HTTP push + scrape paths use (no duplicated fold logic).
  - **kind `metric-scrape`**: a scrape target can be BOUND to a satellite
    (`metric_scrape_targets.satellite_id`). `buildCapabilityConfig` tells each
    satellite which targets to scrape (`{ targets: [{ id, name, url,
intervalSeconds, timeoutMs, maxSeries, hasBearer }] }`). Forwarded scrape
    batches (`[{ targetId, datapoints }]`) are authorized by the target BINDING:
    core accepts an entry only when the target belongs to the sending satellite,
    rejecting mismatched/unknown targets. `handleCapabilityStatus`
    (`[{ targetId, lastScrapeAt, lastError, consecutiveFailures? }]`) mirrors
    per-target scrape health and fires the `scrape_failing` event on the threshold
    crossing, reusing the core reconciler's one-event-per-episode semantics.

  BEARER SECRETS: the bearer NEVER rides the config push. The config only flags
  `hasBearer`; the agent fetches the token just-in-time via a
  `capability_secret_request`, which the core handler's `resolveSecret` answers -
  binding-authorized (resolved ONLY when the target is bound to the requesting
  satellite) and returned over the authenticated channel, never persisted or
  logged. This reuses the health-check JIT secret pattern.

  The core Prometheus scrape reconciler EXCLUDES satellite-bound targets from its
  scheduling (they are scraped on the satellite) and cancels a target's core job
  when it rebinds core -> satellite; a rebind back reschedules it. Scrape-target
  CRUD notifies BOTH the old and new satellite so each converges its scrape set.

  Two new forward-only migrations: `metric_scrape_targets.satellite_id` (+ index),
  and `metric_stream_activity.dropped_in_transit_count` - a new counter of
  telemetry a SATELLITE dropped from its bounded buffer during a disconnect /
  slow-consumer episode (reported per stream via each batch's `droppedByGroup`,
  keyed by scrape target id for the scrape path and stream token for the forward
  path), surfaced on the `StreamActivity` / overview read model (distinct from
  cardinality-cap and buffer-full drops).

  metricstream-common gains: an optional `satelliteId` on the scrape-target DTOs
  (create/update/read); the shared satellite capability wire schemas
  (`MetricScrapeConfigSchema`, `MetricScrapeBatchSchema`, `MetricScrapeStatusSchema`,
  `MetricstreamForwardBatchSchema`, `WireDatapoint` + `wireDatapointToNormalized`)
  so the agent and frontend validate the same payloads; and the pure
  `parseOtlpMetricsJson` (moved from metricstream-backend so the satellite agent's
  `/v1/metrics` receiver can import it - backend now re-exports it).

  `@checkstack/satellite-backend` (minor, additive): the `handleTelemetryBatch`
  capability-handler ctx now carries the envelope's optional per-group
  `droppedByGroup`, and the WS handler forwards it, so a domain handler can
  attribute in-transit drops to the exact stream that lost data.

  SECURITY: authorize the caller-supplied `satelliteId` when creating/updating a
  scrape target. Previously the only gate was the stream `manage` grant, so a
  team-scoped stream manager could bind their target to another team's satellite +
  an internal URL in that satellite's zone, turning core into a cross-zone SSRF
  pivot. Binding a non-null satellite now requires (over a caller-scoped RPC) that
  the satellite EXISTS, the CALLER can READ it (`satellite.read`, else FORBIDDEN),
  and it advertises the `scrape` capability (else BAD_REQUEST) - applied on both
  create and update (rebind). A null binding (scrape from core) is unaffected.

- 4568dcc: Harden and correct the Metric Streams backend from the review sweep.

  - SSRF egress guard on Prometheus scrapes: before every scrape the target host
    is resolved and validated through the platform egress guard
    (`resolveAndValidateHost` with the default cloud-metadata/link-local denylist,
    the same foundation guard the HTTP healthcheck collector uses), and a denied
    destination fails the scrape as a transport error. Scrape-target URLs are now
    restricted to the `http`/`https` schemes in the create/update contract and
    re-checked at scrape time. RFC1918 targets stay reachable by default (scraping
    an internal Prometheus is legitimate); operators harden further by extending
    the denylist. Mirrors the healthcheck DNS-rebind caveat (pre-flight validation,
    original-URL fetch).
  - Cross-tier health reads: the `metric-window` collector now reads BOTH storage
    tiers for a window wider than the stream's `minuteRetentionHours` - the recent
    part from the minute tier and the older part from the hourly tier, folded
    together - instead of silently truncating to the minute tier and dividing the
    counter rate/increase by the full window. Cumulative-counter points are
    stitched contiguously across the rollup boundary so reset-aware differencing
    stays correct, and a series present in both tiers is counted once.
  - Series-count drift fix: a flush now advances a metric name's `seriesCount` by
    the series it ACTUALLY inserted (the `ON CONFLICT DO NOTHING ... RETURNING`
    set), so a cross-pod duplicate insert can no longer permanently over-count a
    name and block its retention cleanup. Duplicate-series datapoints still fold
    into their buckets.
  - Documented the cardinality cap as best-effort per-pod-flush (bounded,
    self-correcting cross-pod overshoot; no advisory lock) in the config schema and
    the partitioning helper.

- 4568dcc: Relocate the pure log/metric parsing and normalization code into the correct
  layers so it can be shared beyond the backends (e.g. by a satellite telemetry
  agent). This is an internal refactor: log-stream and metric-stream behavior is
  unchanged (token formats, HTTP status semantics, buffer/flush timing, parser
  output, ids, and migrations are all byte-identical). The full backend suites -
  unit, integration, and both load guards - pass unchanged, and the `*-common`
  browser-safety guards still pass.

  `@checkstack/otlp-wire` (new foundation leaf, ZERO node builtins so it is safe
  to import from browser-shipped `*-common` packages - enforced by a guard test)
  now owns the dependency-free protobuf wire codec (`ProtoReader` / `ProtoWriter`
  / `WireType`, the depth guard) and the signal-agnostic OTLP structure readers
  (`AnyValue` / `KeyValue` / `Attribute` / `Resource`, `encodeExportServiceResponse`,
  `bytesToHex`), moved out of `@checkstack/ingest-utils`.

  `@checkstack/ingest-utils` (still BACKEND-ONLY) re-exports everything it
  previously exported from `@checkstack/otlp-wire`, so its consumers keep
  compiling unchanged; it now depends on `@checkstack/otlp-wire`.

  `@checkstack/metricstream-common` gains the pure ingest halves, moved from the
  backend and kept browser-safe: the Prometheus text parser, the per-scrape
  max-series shaping (`capScrapeSeries`), OTLP metrics decode (over the
  `@checkstack/otlp-wire` readers), native metrics JSON parse, the OTLP-metrics
  datapoint normalization, and the datapoint timestamp-clamp helper.

  `@checkstack/logstream-common` gains the equivalent pure halves: OTLP logs
  decode/encode, the OTLP-logs and native NDJSON/JSON normalization, the RFC 5424
  syslog parser and the RFC 6587 framer, and the shared severity/attribute/clamp
  normalization helpers.

  `@checkstack/metricstream-backend` and `@checkstack/logstream-backend` now
  import those parsers/normalizers from their `*-common` package instead of
  owning them; the backends keep the endpoints, auth, gzip/body handling,
  buffers/flush, SSRF-guarded scrape fetch executor, and syslog listeners.

### Patch Changes

- 4568dcc: Harden parsing and dispatch flagged by CodeQL (5 high-severity alerts):

  - Ingest-token extraction (`ckls_`/`ckms_`/generic source tokens) matched the
    `Authorization` header with `^Bearer\s+(.+)$`, whose `\s+` and `.+` overlap on
    whitespace and backtrack polynomially on crafted input (ReDoS). It now matches
    only the `Bearer ` scheme prefix and slices the remainder - linear time, same
    behavior.
  - The Prometheus text parser's `# TYPE`/`# HELP` line regex had the same
    overlapping-quantifier shape (`\s*(.*)$`); it now matches through the metric
    name and slices the rest.
  - The satellite client resolved a pending capability-secret callback from a map
    keyed by the untrusted `requestId` and invoked it directly, which reads as an
    unvalidated dynamic dispatch. The pending entry is now an object with a
    statically-named `settle` method, so the invocation is never a callee derived
    purely from external input.

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
  - @checkstack/otlp-wire@0.1.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0
