# @checkstack/metricstream-backend

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
