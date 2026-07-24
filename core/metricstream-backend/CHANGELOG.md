# @checkstack/metricstream-backend

## 0.2.1

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ai-backend@0.11.4
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/satellite-backend@0.9.4
  - @checkstack/auth-common@0.16.0
  - @checkstack/secrets-backend@0.3.9
  - @checkstack/telemetry-backend@0.1.1
  - @checkstack/catalog-common@2.8.1
  - @checkstack/backend-api@0.34.1
  - @checkstack/telemetry-common@0.1.1
  - @checkstack/metricstream-common@0.2.1

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

- 6c8b36b: Add the multi-signal binding editor and a global Sources management page.

  - The telemetry sink contract gains an optional `listBindableStreams({ user })`
    method: the owning plugin lists its streams and FILTERS them to the ones the
    caller may manage, so the binding editor only offers streams a bind will
    accept. logstream and metricstream implement it through the shared
    `createStreamBindAuthorizer` factory (service bypass, global rule, then a
    per-resource team-grant filter via `auth.listAccessibleObjectIds`), keeping
    the authorization rule in one place. A sink without the method yields an empty
    picker, so adoption is incremental.
  - The frontend add/edit dialogs route each emitted signal through a per-signal
    stream picker: at most one stream per signal, at least one binding overall, a
    signal may be left unrouted, and a bound-but-no-longer-listable stream stays
    visible as a synthetic option. The single-signal fast path (opened from a
    stream section) collapses to the embedding-stream preset with no extra
    interaction.
  - A new global Sources page (Reliability nav group) lists every source instance
    the caller may read with per-row enable/edit/rotate/delete gating, and "Add
    source" opens the full catalog with no preset binding.

- 6c8b36b: Integrate the log and metric streams with the new telemetry platform.

  - The backends contribute telemetry SINKS: normalized platform records enter
    the exact same ingest pipelines (severity rules, banding, clamping, caps) as
    the plugins' own push endpoints, and bind-time authorization is answered by
    each plugin's own stream access rules.
  - The frontends embed the platform's `StreamSourcesSection` (metricstream on
    the Sources tab, logstream on the Settings tab), so configured telemetry
    sources bound to a stream are managed next to the stream's other ingestion
    settings. The section self-hides while no source types are installed.

### Patch Changes

- 6c8b36b: Promote the SSRF-guarded, redirect-revalidating fetch into backend-api as
  `createGuardedFetch` / `GuardedFetchError`: scheme allow-list, host validation
  on EVERY redirect hop, spec-correct redirect semantics (301/302/303 downgrade
  to GET and drop the body; 307/308 preserve the method and refuse
  non-replayable stream bodies), and `maxRedirects: 0` returning the 3xx as-is
  for callers that must not follow.

  The Prometheus scrape executor now uses it: previously the scraper validated
  only the ORIGINAL host and then followed redirects blindly, so a compliant
  target could redirect a scrape to an internal address; every hop is now
  re-validated. (The AI probe-url tool and the notification egress validator
  deliberately keep their own guards - both are STRICTER than the shared
  default: probe-url blocks all private ranges and metadata hostnames by name,
  notification egress fails closed on any redirect.)

  Credential headers (`authorization`, `proxy-authorization`, `cookie`) are now
  stripped from the forwarded request when a redirect crosses to a different
  origin (scheme, host, or port), matching browser / undici behavior. Previously
  the manual follower re-sent every request header verbatim, so a redirecting
  target (e.g. a Prometheus scrape endpoint) could replay the configured bearer
  to another host. Same-origin redirects keep the credentials.

- 6c8b36b: Promote the health-check run-queue contract and the observability window
  math into `@checkstack/healthcheck-common`: `HEALTH_CHECK_QUEUE`,
  `HealthCheckJobPayload`, `fastPathJobId` (per-plugin prefix) and
  `computeWindowBounds`/`computeSecondsSinceLast` now have ONE definition
  that the queue owner (healthcheck-backend) and every observability
  strategy plugin import, replacing the per-plugin mirror copies that had
  to be kept in lock-step by convention. Enqueued job ids and window
  semantics are byte-identical; this is a drift-proofing refactor, not a
  behavior change.
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

- 6c8b36b: Add `reconcileRecurringJobs`, a shared convergence helper for recurring queue
  jobs. It (re-)schedules a desired set of jobs by stable jobId and cancels every
  existing recurring job the caller owns (`ownsJobId`) that is no longer desired,
  running schedules and cancels concurrently. The metricstream Prometheus scrape
  scheduler and the telemetry pull reconciler now both use it instead of
  hand-rolling the same list/schedule/cancel dance, with identical behaviour.
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
  - @checkstack/metricstream-common@0.2.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/ingest-utils@0.2.0
  - @checkstack/common@0.23.0
  - @checkstack/satellite-backend@0.9.3
  - @checkstack/secrets-backend@0.3.8
  - @checkstack/cache-api@0.3.20
  - @checkstack/secrets-common@0.3.3
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1

## 0.1.2

### Patch Changes

- @checkstack/auth-common@0.14.0
- @checkstack/backend-api@0.33.0
- @checkstack/cache-api@0.3.19
- @checkstack/cache-utils@0.3.0
- @checkstack/common@0.22.0
- @checkstack/healthcheck-common@1.17.0
- @checkstack/ingest-utils@0.1.0
- @checkstack/metricstream-common@0.1.0
- @checkstack/queue-api@0.3.19
- @checkstack/satellite-backend@0.9.2
- @checkstack/satellite-common@0.10.0
- @checkstack/secrets-backend@0.3.7
- @checkstack/secrets-common@0.3.2
- @checkstack/signal-common@0.3.0

## 0.1.1

### Patch Changes

- @checkstack/secrets-backend@0.3.7
- @checkstack/satellite-backend@0.9.1

## 0.1.0

### Minor Changes

- 4568dcc: Add the metric-stream health integration and management/read API.

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

- 4568dcc: Attribute satellite in-transit telemetry drops PER STREAM instead of a single
  connection-level count. Previously a satellite reported one aggregate
  `droppedSinceLast` per batch, and each core handler charged that full count to
  every stream the batch touched - so a multi-stream batch over-counted the loss
  on every stream, and a drop that belonged to one stream was smeared across the
  others.

  - Wire: `telemetry_batch.droppedSinceLast` (a single number) is replaced by
    `droppedByGroup` - a map of per-group drop counts, keyed by an opaque domain
    group string the capability handler interprets (the stream token for the
    forward paths, the scrape target id for `metric-scrape`). The whole satellite
    telemetry feature is unreleased, so this is a clean replacement, not a
    breaking change to any shipped agent.
  - Agent (`@checkstack/satellite`): the telemetry client buckets buffered items
    by a caller-supplied `groupKeyOf`, so drop-oldest eviction is naturally
    per-group; the loss rides the next batch's `droppedByGroup`. A terminal ack's
    `rejected` is no longer folded back into the agent's drop counter - that is a
    core-side outcome the core attributes itself, and folding it double-counted
    the loss and (for a bad token) misattributed it to unrelated streams.
  - `@checkstack/ingest-utils`: `IngestBuffer` (drop-oldest mode) now reports
    `droppedByKey` alongside the aggregate `dropped`, so a caller can attribute
    each eviction to the key it belonged to.
  - Core handlers (logstream forward, metricstream forward + scrape) resolve each
    `droppedByGroup` key to its stream - reusing the same token-verdict / target
    -binding lookups the payload uses - and record the loss against that stream
    alone. A key that no longer resolves to a stream (unknown/revoked token,
    unbound target) is left unattributed rather than charged elsewhere.

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/ingest-utils@0.1.0
  - @checkstack/metricstream-common@0.1.0
  - @checkstack/satellite-backend@0.9.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/common@0.22.0
  - @checkstack/queue-api@0.3.19
  - @checkstack/secrets-backend@0.3.7
  - @checkstack/secrets-common@0.3.2
