# @checkstack/logstream-common

## 0.4.2

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

## 0.4.1

### Patch Changes

- Updated dependencies [be74b01]
  - @checkstack/frontend-api@0.17.0
  - @checkstack/telemetry-common@0.1.1

## 0.4.0

### Minor Changes

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
- Updated dependencies [6c8b36b]
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/otlp-wire@0.1.1
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1

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

### Patch Changes

- @checkstack/common@0.22.0
- @checkstack/otlp-wire@0.1.0
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

## 0.1.0

### Minor Changes

- 4568dcc: Render the log-stream health-check config as real dropdowns. The check editor
  now forwards dynamic-option resolvers to its strategy and collector config
  forms, so the `logstream` strategy's **stream** field and the
  `pattern-occurrence` collector's **pattern** field become pickers instead of
  plain text inputs.

  The health-check editor gains a contribution point,
  `HealthCheckConfigOptionsResolverSlot`: a plugin that registers a strategy whose
  config declares `x-options-resolver` fields contributes a factory that turns the
  editor's generic context (the RPC api plus the current strategy config) into the
  concrete resolvers. The editor stays ignorant of any specific strategy - the
  owning plugin supplies the resolvers, mirroring the backend extension-point
  pattern. Because the editor passes the strategy config down to the collector
  forms, a collector-field resolver can read a selection made in the sibling
  strategy form (the pattern picker lists the chosen stream's Drain patterns).

  `logstream-frontend` contributes the `logstreamStreamId` and
  `logstreamPatternId` resolvers, backed by the `typeScoped` `listStreamsForPicker`
  and `listPatterns` procedures, and `logstream-common` now exports the shared
  strategy id and resolver-name constants so the backend annotations and the
  frontend resolvers reference one source and cannot drift.

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

- 4568dcc: Add per-resource scoping to realtime signal auto-invalidation. Signals may now
  declare an optional `resourceKey` extractor (`createSignal({ ..., resourceKey })`);
  when a received signal carries one and it yields an id, `SignalAutoInvalidator`
  narrows invalidation from the whole owning plugin's react-query cache to only
  the queries whose key contains that resource id, plus queries that opted into
  whole-plugin refresh with `meta: { signalScope: "plugin" }` (exported as
  `signalScopeMeta`). A plugin registers its resource-scoped signal defs on its
  frontend config's new `signals` field so the invalidator can recover the
  extractor from a received signal's id. The invalidation coalescer now buckets on
  `pluginId` + `resourceId`, so bursts for different resources stay independent.

  This is fully backward compatible: a signal WITHOUT a `resourceKey` keeps the
  original blanket-plugin invalidation, so every existing signal behaves exactly
  as before. Foreign (`foreignSignals`) invalidation also stays blanket.

  Logstream adopts it: `LOGSTREAM_ACTIVITY` and `LOGSTREAM_IMPORTANT_EVENT` scope
  to their `streamId`, so a viewer on one stream's detail page is no longer
  refetched (including the heavy list-page summaries) whenever any other stream
  ingests. The stream list page opts its two resource-agnostic queries back into
  whole-plugin refresh with `signalScopeMeta`.

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

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
  - @checkstack/otlp-wire@0.1.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0
