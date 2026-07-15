# @checkstack/logstream-backend

## 0.4.0

### Minor Changes

- 6c8b36b: Signal-to-signal DERIVE sources: the telemetry platform gains a fourth
  source mode - a derive source consumes one signal's already-ingested
  records from a configured input stream and emits another signal. Two
  built-in types ship: `log-to-metric` (count matching lines per flush as a
  delta counter, or extract a numeric attribute as a gauge; substring +
  severity filters only - no user regex on the ingest hot path) and
  `log-to-trace` (logs already carrying full W3C trace context become
  spans; span ids are never synthesized). Sink-owning plugins feed the
  dispatcher through a buffered record tap; logstream connects its
  post-flush batches (best-effort and error-isolated - a deriver can never
  fail or slow ingest: the dispatch is detached from the flush cycle, and
  the tap passes records as a lazy thunk the dispatcher only materializes
  when a derive instance actually matches the stream, so streams without
  derive sources pay zero conversion cost). The dispatcher's pod-local
  source cache is generation-guarded so an invalidation during an
  in-flight rebuild can never wedge a pod on a stale derive set, and
  `log-to-metric` caps distinct label tuples per batch (100) so a
  high-cardinality attribute path cannot mint unbounded series. The
  source editor gets bespoke config forms with a proper input-stream
  picker.
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

- 6c8b36b: Syslog ingestion becomes the platform's first LISTENER source type
  (`logstream.syslog`): create a syslog source instance with port/TLS
  config and a log-stream binding instead of setting
  `CHECKSTACK_LOGSTREAM_SYSLOG_PORT`. The instance binding is the
  authorization and routing - no in-message `ckls_` tokens. A TLS
  listener validates its cert/key paths at start (a bad path surfaces as
  the instance's lastError instead of a silently-dead intake), and a
  deployment still setting the removed env var gets an explicit startup
  warning pointing at the new source flow.

  BREAKING CHANGES (BETA): the env-var syslog listener and its per-message
  token resolution are REMOVED from the core (the satellite's edge syslog
  receiver keeps the token-prefix protocol unchanged). Recreate any
  env-configured syslog intake as a syslog source instance bound to the
  target stream.

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

### Patch Changes

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
  - @checkstack/logstream-common@0.4.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/ingest-utils@0.2.0
  - @checkstack/common@0.23.0
  - @checkstack/satellite-backend@0.9.3
  - @checkstack/cache-api@0.3.20
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1

## 0.3.0

### Minor Changes

- 56af572: Hideable log patterns and a severity filter for the Top patterns card.

  - A pattern (mined or user-authored) can now be hidden (`setPatternHidden`,
    manage-gated on the stream). A hidden pattern leaves every default listing
    (Top patterns card, explorer pattern picker, Patterns tab default view) and
    its matched lines are NO LONGER stored as raw log lines - while every
    aggregate keeps counting them (severity totals, pattern/variable buckets,
    spike detection, health checks pinned to the pattern), so hiding noise like
    fully-wildcarded access logs never falsifies stream volume or breaks a
    check. The hide flag propagates to every pod's in-memory Drain engine
    (including worker-hosted trees) via the existing patterns-changed broadcast,
    with hydration as the convergence backstop.
  - The Patterns tab shows a "Show hidden (N)" toggle revealing hidden patterns
    (dimmed, badged) with a per-row hide/unhide action; unhiding resumes raw
    line storage immediately.
  - `listPatterns` accepts `includeHidden` (default false), `bands` (filter by
    the pattern's derived severity band, computed in SQL exactly like the DTO's
    `bandFromSeverityNumber`) and `orderBy: "lastSeenAt" | "totalCount"`.
  - The overview's Top patterns card is now severity-filterable via the same
    band pills the explorer uses (extracted into a shared `SeverityBandPills`
    component) and queries `listPatterns` ordered by volume.

- 56af572: Stop masking digits that are part of an identifier in the Drain
  preprocessor. The number rule masked every digit run as a substring, so
  constant names like `S3`, `utf8`, `sha256`, or `TLSv1.2` were wildcarded
  ("TechDocs S3 router failed" mined as "TechDocs S<_> router failed"). The
  rule now only fires after a non-alphanumeric separator (`key=42` -> `key=<_>`,
`db-9`->`db-<_>`, `took 250ms`->`took <_>ms`all keep working): a digit
run attached to a preceding letter, or continuing an identifier across a dot,
stays literal. A letter-attached token that genuinely varies across lines
(worker ids, version tags) is still generalized to`<\*>` by the Drain tree's
  own clustering, which is exactly what it exists for.

  BREAKING CHANGES: pattern identity is `sha256(streamId + template)`, so
  templates that previously contained a letter-attached wildcard change under
  the new masking and are re-mined under a NEW pattern id. The old mined
  patterns stop matching and age out normally. User-authored patterns whose
  templates contain such a wildcard produced by the old masking (e.g. `S<*>`)
  no longer match incoming lines and should be re-authored from a current
  line. Health checks referencing an affected pattern will read zero new
  occurrences until they are pointed at the re-mined pattern.

### Patch Changes

- Updated dependencies [56af572]
  - @checkstack/logstream-common@0.3.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/common@0.22.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/ingest-utils@0.1.0
  - @checkstack/queue-api@0.3.19
  - @checkstack/satellite-backend@0.9.2
  - @checkstack/signal-common@0.3.0

## 0.2.0

### Minor Changes

- 099045f: Make the pattern-metric VariableIndex picker self-explanatory:

  - Each variable option now shows its TEMPLATE CONTEXT (one token each side,
    `…`-elided), e.g. `Variable 0 (… after <*> retries) - samples: 3`. This
    disambiguates which `<*>` a variable is when the template also contains
    embedded wildcards (`db-<*>`) - those keep their static text during masking,
    their values are never captured, and they are NOT variables. The
    `variableIndex` field description now explains this too.
  - A position with no numeric buckets in the summary window now reads
    `no samples in the last 24h` (using the backend-reported
    `summaryWindowSeconds`, not a hardcoded claim) instead of the misleading
    `no recent samples (not numeric)` - an empty window says nothing about
    whether the values are numeric.
  - Contract: `PatternVariableSample` gains `context`, and
    `listPatternVariables` returns `summaryWindowSeconds`.
  - Docs: the logstream developer guide now documents the standalone-vs-embedded
    wildcard rule (docs index regenerated).

### Patch Changes

- 6540703: Fix the log-stream pattern-metric collector's VariableIndex picker, which
  stayed at "No options available" even after a pattern with `<*>` variables was
  selected. Two defects combined:

  - The `variableIndex` config field did not declare
    `x-depends-on: ["patternId"]`, so the editor fetched the variable options
    exactly once at mount (before a pattern was chosen) and never re-fetched.
    The schema now declares the dependency, and the picker reloads whenever the
    sibling pattern selection changes.
  - `DynamicOptionsField` assumed resolver-backed fields hold string values.
    `variableIndex` is the first `number`/`integer` field with an
    `x-options-resolver`, and picking an option would have stored the string
    `"0"` (rejected by the backend's `z.number().int()`), while a stored numeric
    `0` never matched its option and rendered as unselected. The field now
    receives the schema value type from `FormField` and coerces in both
    directions: picked options emit real numbers, and stored numbers are
    stringified for option matching.

  Regression tests cover the number/string round-trip, the sibling-driven
  refetch, and the schema annotation.

- Updated dependencies [099045f]
  - @checkstack/logstream-common@0.2.0
  - @checkstack/satellite-backend@0.9.1

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
