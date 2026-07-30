# @checkstack/ingest-utils

## 0.2.1

### Patch Changes

- @checkstack/cache-api@0.3.21
- @checkstack/cache-utils@0.3.2
- @checkstack/otlp-wire@0.1.1

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [6c8b36b]
  - @checkstack/otlp-wire@0.1.1
  - @checkstack/cache-api@0.3.20
  - @checkstack/cache-utils@0.3.1

## 0.1.0

### Minor Changes

- 4568dcc: Extract the source-agnostic ingest primitives into a new foundation-layer
  package `@checkstack/ingest-utils`, and refactor log-stream ingest to consume
  them. This is an internal refactor: log-stream behavior is unchanged (token
  format `ckls_`, cache-key strings, HTTP status semantics, buffer/flush timing,
  worker offload, ids, and migrations are all byte-identical), and
  `@checkstack/logstream-common`'s public exports are untouched.

  `@checkstack/ingest-utils` (BACKEND-ONLY - it imports `node:crypto` /
  `node:zlib`, so it must never be imported by a browser bundle) provides:

  - `createSourceTokenKit({ prefix })` - the node:crypto side of a source-token
    scheme (generate/hash + the format helpers), parameterized by prefix so each
    ingest plugin mints its own tokens. The browser-safe FORMAT half stays in each
    plugin's `*-common`.
  - `createIngestAuthenticator` + `NegativeTokenCache` + the coordinated
    `ingest-token:` / `ingest-token-miss:` cache-key builders and the
    plugin-scoped `createIngestTokenCache`.
  - `RateLimiter` (per-key soft limit) and `PreAuthRateLimiter` (per-IP pre-auth
    abuse limiter).
  - `readCappedBody` (size-capped body reader with async gunzip + inflated cap).
  - A generic bounded line+byte `IngestBuffer<T>` with per-key fair share.
  - `createFlushLoop` (the timer + single-inflight flush skeleton).
  - The OTLP wire codec (`ProtoReader` / `ProtoWriter`) and the signal-agnostic
    OTLP structure readers (`AnyValue` / `KeyValue` / `Resource`, the recursion
    depth guard) plus `encodeExportServiceResponse`.

  `@checkstack/logstream-backend` now delegates to these: its `token-crypto`,
  `ingest/auth`, `api/token-cache`, `ingest/buffer`, `ingest/rate-limit`,
  `ingest/http/body`, and `ingest/protobuf/wire` become thin re-export/adapter
  shims that preserve their existing names and shapes; the OTLP logs decoder keeps
  only its logs-specific message decoding; and the ingest pipeline consumes
  `createFlushLoop` for its timer/inflight mechanism while keeping its
  drain/worker-specific orchestration. The full log-stream backend suite (unit +
  integration + the load guard) passes unchanged.

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

- 4568dcc: Add the satellite telemetry protocol + capability foundation (log/metric
  forwarding and satellite-side scraping build on this). All additions are
  additive and version-skew safe - every new field is optional and old peers
  ignore unknown message types and fields, so mixed-version fleets keep working.
  The existing health-result path is untouched.

  - `@checkstack/satellite-common`: new generic telemetry envelopes on the WS
    protocol - `telemetry_batch` / `capability_status` (satellite -> core) and
    `telemetry_ack` / `capability_config` (core -> satellite). `authenticate` and
    `heartbeat` gain an optional `capabilities` list. New flow-control constants
    (max in-flight, batch item/byte caps, per-connection dedupe window and
    bytes/min budget, ack timeout, pump interval).
  - `@checkstack/satellite-backend`: a `satellite.capability` extension point so
    domain plugins contribute a handler per `kind` (ingest a batch, build the
    pushed config, handle a status update) without satellite-backend depending on
    any domain plugin. The WS handler routes telemetry by kind, dedupes resent
    batchIds per connection, enforces a per-connection byte budget (over-budget =
    retryable ack, never a disconnect), acks every batch, and pushes
    `capability_config` on connect and on `notifyCapabilityConfigChanged`
    (cross-pod via a broadcast domain event). Advertised capabilities are
    persisted on a new `satellites.capabilities` column and surfaced on the read
    model.
  - `@checkstack/satellite` (agent): a `TelemetryClient` that buffers per-kind
    (bounded, drop-oldest, counted) and forwards over a credit window (at most N
    unacked batches, chunked to the item/byte caps, monotonic per-connection
    batchId, resend-until-ack, drop-and-count on a terminal ack). Capabilities are
    advertised from env flags; an agent capability registry routes pushed
    `capability_config` to a consumer and sources `capability_status` back.
  - `@checkstack/ingest-utils`: `IngestBuffer` gains an opt-in `dropOldest` mode
    (evict oldest to admit new items, report how many were dropped) and a
    `drainChunk` for bounded FIFO draining. The default reject-new behavior the
    backend ingest endpoints rely on is unchanged.

  BREAKING CHANGE: none. The platform is in beta; this is purely additive.

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

- Updated dependencies [4568dcc]
  - @checkstack/otlp-wire@0.1.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
