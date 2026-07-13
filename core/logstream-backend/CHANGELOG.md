# @checkstack/logstream-backend

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

- 4568dcc: Add log streams: push high-volume application and infrastructure logs to
  Checkstack and monitor them as health checks. Operators create a stream, mint a
  per-stream source token (`ckls_...`, shown once, sha256 at rest), and ship logs
  over OTLP/HTTP (`/api/logstream/v1/logs`, JSON + protobuf + gzip), a native
  NDJSON/JSON endpoint (`/api/logstream/ingest`), or RFC 5424 syslog over TCP/TLS
  (enabled with `CHECKSTACK_LOGSTREAM_SYSLOG_PORT`).

  Ingestion is event-driven and cheap: a bounded per-pod write buffer flushes each
  stream in one transaction, folding every line into complete per-minute severity
  and pattern aggregates while keeping a capped, sampled subset of raw lines
  (WARN+ always, INFO/DEBUG sampled) for the log explorer. The Drain engine groups
  lines into message patterns whose ids are deterministic hashes of the template,
  so per-pod parse trees converge across a horizontally-scaled deployment without
  coordination.

  Per-stream `severityRules.valueMap` remapping is honored by every protocol,
  keyed on the source's native severity value: OTLP `severityText`, the native
  `level`/`severity` field, and (for syslog) the RFC 5424 severity keyword derived
  from the PRI (`err`, `warning`, ...), so `{ "err": "fatal" }` re-bands syslog
  error lines.

  A `logstream` health-check strategy exposes the stream to the existing pipeline.
  Its `window-metrics` collector surfaces assertable windowed metrics
  (`errorCount`, `errorRatePerMinute`, `secondsSinceLastLog`, pattern counts, and
  more) and a `pattern-occurrence` collector counts a single pattern. Health is a
  periodic read of pre-aggregated buckets that emits one run per tick, with a
  debounced error fast-path for near-real-time reaction to bursts and absence
  asserted via `secondsSinceLastLog`. Streams are a team-scopable RLAC resource;
  retention and minute-to-hour rollup run as recurring maintenance jobs. The
  frontend adds a Log Streams area under Reliability with stream list, overview,
  explorer, patterns, and settings (token minting plus copy-paste shipper
  snippets).

- 4568dcc: Add the `pattern-metric` health collector, custom-pattern API handlers, and
  referenced-pattern protection to the log-stream backend (v2 health + API).

  - **`pattern-metric` collector**: assert on the numeric `<*>` wildcard values
    of one Drain pattern (`avgValue` / `minValue` / `maxValue` / `sampleCount`)
    over the same complete-minute window as `window-metrics`. Values carry no
    unit (the logged number's domain is unknown) and a zero-sample window reports
    zeroed values, so pair a value threshold with `sampleCount > 0`. Follows the
    collector rule (only a DB read failure throws). A collector-DTO conformance
    test (mirroring the strategy-DTO guard) covers all three collectors so an
    enum-ish registration value can never 500 the collector picker.

  - **`maskLine` proc** (read-gated on the stream): mask a raw log line into its
    Drain template so the pattern builder can seed its chips from a pasted line in
    the exact backend mask space, instead of re-implementing the masker in the
    browser (which would drift from ingest classification).

  - **Custom-pattern handlers** (`createPattern` / `deletePattern` /
    `testPattern` / `listPatternVariables`): create a user-authored pattern
    (`origin: 'user'`, drain-consistent `sha256(streamId + ' ' + template)` id,
    all-wildcard templates rejected). Creating a template that Drain has ALREADY
    mined PROMOTES the mined row in place to `origin: 'user'` (keeping its counts
    and first/last-seen) rather than dead-ending, so "Create pattern from this
    line" always works; a second create of an existing USER template still 409s.
    User patterns are capped per stream (`MAX_USER_PATTERNS_PER_STREAM = 200`,
    enforced atomically inside the create transaction) since each is a protected,
    never-evicted cluster on every pod - past the cap the create returns a
    friendly, actionable 4xx. Delete only user patterns (mined patterns are
    refused, and a delete is refused with a 409 naming the health checks that
    still reference the pattern), dry-run a template against the newest raw lines
    with the drain-consistent matcher, and summarize each wildcard position's
    recent numeric samples + numeric share for the pattern-metric variable picker
    (reading BOTH the minute and hourly tiers so a pattern quiet past
    `minuteRetentionHours` keeps its sample hints). `listPatterns` orders
    user-authored patterns first (then by recency) so a quiet-but-pinned user
    pattern never sinks below the picker's page of chatty mined ones. Pattern
    templates are length-bounded to the ingest line ceiling, and a stream's
    `severityRules` (`valueMap` entries, `patternOverrides`) are count-bounded.

  - **Referenced-pattern protection**: retention no longer deletes a quiet
    pattern that is `origin: 'user'` OR referenced by a `pattern-occurrence` /
    `pattern-metric` collector, and the daily cleanup resolves the referenced set
    per stream (skipping the stale-pattern sweep for a stream when that lookup
    fails, rather than risk deleting a referenced pattern). Pattern-variable
    minute buckets now roll up to hourly and expire with the pattern buckets.

  - **Assertable-field label clarity**: every assertable result field across the
    three collectors now reads unambiguously in the assertion builder
    (`Since Last Seen` → `Minutes since last seen`, `Since Last Log` →
    `Seconds since last log`, band counts as `... lines`) with zod `.describe()`
    text stating each field's unit and never-seen fallback. Field keys are
    unchanged, so existing assertions and stored results round-trip as-is.

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

- 4568dcc: Satellite telemetry forwarding, agent side + the logstream core handler.

  `@checkstack/satellite` gains the local telemetry receivers and the metric
  scraper, each behind its capability env flag and forwarding into the ONE
  credit-window telemetry client (nothing touches the health-result path):

  - HTTP receivers on one port (`CHECKSTACK_SATELLITE_RECEIVER_PORT`, default 4318) when `CHECKSTACK_SATELLITE_LOG_RECEIVERS=1`: OTLP logs `/v1/logs`,
    native logs `/ingest`, OTLP metrics `/v1/metrics`, native metrics
    `/ingest/metrics`. The agent parses with the shared parsers, requires a
    `ckls_`/`ckms_`-SHAPED token (401 otherwise) and answers 202 after buffering;
    it does not (cannot) verify the token - the core handler does, so a
    core-rejected token is a documented "202-then-drop" surfaced as a counted
    drop.
  - A TCP/TLS syslog listener when `CHECKSTACK_SATELLITE_SYSLOG=1`
    (`CHECKSTACK_SATELLITE_SYSLOG_PORT` + `_TLS_CERT`/`_TLS_KEY`/`_HOST`), reusing
    the shared RFC 6587 framer + RFC 5424 parser and forwarding lines grouped by
    the token each message carried.
  - A metric-scrape scheduler when `CHECKSTACK_SATELLITE_SCRAPE=1`: consumes the
    `metric-scrape` capability config the core pushes (the targets bound to this
    satellite), reconciles one interval timer per target, and runs an SSRF-guarded
    scrape executor (same `resolveAndValidateHost` egress guard, timeout, size cap,
    and `capScrapeSeries` shaping as the core reconciler), forwarding datapoints
    and per-target status. Concurrent scrapes are capped (default 4); a transport
    failure is reported as `lastError` (never a metric).

  `@checkstack/logstream-backend` registers the "logstream" satellite capability
  handler against `satelliteCapabilityExtensionPoint`: it verifies each forwarded
  group's `ckls_` token with the existing ingest authenticator (revocation
  intact), re-clamps timestamps against the core clock, re-applies the stream's
  severity `valueMap`, and feeds the SAME ingest pipeline the HTTP endpoints use.
  Ack semantics mirror HTTP - a token rejection is terminal (dropped + counted);
  a whole-batch saturation that wrote nothing is retryable (safe, nothing was
  buffered); any partial accept is terminal so a resend never double-writes.

  `@checkstack/logstream-common` gains the shared `satellite-relay` wire contract
  (`SatelliteLogLine`/`SatelliteLogBatch` + `toWireLogLine`) used by both the
  agent receivers and the core handler.

### Patch Changes

- 4568dcc: Surface satellite in-transit log drops on the log stream overview, mirroring
  metricstream. When a satellite forwards logs and its bounded in-memory buffer
  drops lines during a disconnect / slow-consumer episode, the agent reports the
  per-stream counts as `droppedByGroup` on the telemetry batch (keyed by stream
  token). The logstream satellite handler previously ignored it, so operators got
  no signal that forwarded logs were lost.

  - `log_stream_activity` gains a `dropped_in_transit_count` column (additive
    forward-only migration; safe on populated tables).
  - The satellite telemetry handler resolves each `droppedByGroup` token to its
    stream and records the loss against THAT stream via a best-effort
    `addInTransitDrops` upsert (atomic, cross-pod safe; a bookkeeping write never
    fails an accepted batch). A token that no longer resolves to a stream is left
    unattributed rather than charged to another stream.
  - The stream overview read model exposes `droppedInTransitCount`, and the
    overview tab renders a "Dropped in transit" tile (warn tone when > 0).

- 4568dcc: Harden log-stream ingest protection durability and memory bounds under the
  Phase-D worker pool:

  - **Referenced-pattern protection now survives a worker reset.** The ingest
    pipeline only re-pushed a stream's healthcheck-referenced protected set when
    the set CHANGED, so a respawned worker (fresh, empty tree) or a dead worker's
    streams handed to the in-process fallback lost that protection indefinitely -
    the referenced mined patterns became evictable and re-minable under fresh
    ids. The flush executor now exposes a per-stream `protectionEpoch` that the
    worker pool bumps on respawn AND on the dead->fallback transition; the
    pipeline folds that epoch into its re-push key, so the next flush re-pushes
    the last-known set to the fresh tree WITHOUT re-resolving (the in-process
    executor is trivially epoch-0, unchanged). User-origin patterns already
    self-healed via hydration; this closes the gap for referenced mined patterns.
  - **The global 50k-cluster cap is enforceable again for protected-holding
    streams.** Whole-tree eviction skips any stream holding a protected cluster,
    so a pod with many such streams grew unboundedly past `maxTotalClusters`.
    Eviction now runs in two phases: whole non-protected trees first (as before),
    then - when only protected-holding streams remain - it sheds their
    NON-protected clusters (globally least-recently-updated first) down to their
    protected cores. Protected clusters are never dropped, so the bound becomes
    `maxTotalClusters + (resident protected clusters)` and converges instead of
    growing without limit.
  - **Hydration is bounded to avoid OOM on a pathological table.** Seeding a
    stream's parse tree loaded its pattern rows with no limit. It now loads the
    `HYDRATION_ROW_LIMIT` (10,000) most-recently-seen rows
    (`lastSeenAt DESC`, served by `log_patterns_stream_last_seen_idx`) and
    warn-logs on truncation; the dropped tail is the coldest patterns, which
    re-mine on their next line and converge.

  Behavior for the common single-tree/in-process path is unchanged. Added
  regression tests: worker respawn / dead-fallback re-push (pool + pipeline),
  the global-cap bound with protected-holding streams present, the hydration
  truncation warning, worker/in-process FlushPlan parity over a real Bun worker,
  and the `patterns.changed` consumer's effect on classification.

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
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/ingest-utils@0.1.0
  - @checkstack/logstream-common@0.1.0
  - @checkstack/satellite-backend@0.9.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/common@0.22.0
  - @checkstack/queue-api@0.3.19
