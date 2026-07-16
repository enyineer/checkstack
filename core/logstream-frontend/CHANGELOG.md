# @checkstack/logstream-frontend

## 0.3.1

### Patch Changes

- Updated dependencies [53081bd]
  - @checkstack/catalog-frontend@0.21.1
  - @checkstack/healthcheck-frontend@0.37.1

## 0.3.0

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

- 6c8b36b: Smooth out loading states so surfaces no longer flash a wrong resolved state or
  pop content in one piece at a time.

  - **Dashboard no longer flashes "all systems healthy".** The overview aggregates
    per-system signals from many plugins (health, incidents, SLOs, anomalies,
    dependencies, log/metric/trace streams), each reporting asynchronously - so
    before any had loaded, an empty problem list briefly read as an all-clear.
    `SystemSignalsSlot` gains an additive `onLoadingChange` report; every source
    filler reports its load state, and the dashboard holds its existing skeleton
    until all mounted sources have settled (bounded by a grace period so a
    non-reporting source cannot hang it).
  - **System detail overview cards reveal together.** Each `SystemDetailsSlot` card
    self-loads and several self-hide when empty, so they popped in one after
    another. The slot gains an additive `onLoadingChange`; each card reports, and
    the detail page keeps the cards mounted but behind a skeleton set until all
    have settled, then reveals them at once - no stagger, no layout shift, and
    cards with no content simply never appear.
  - **Catalog manage "Health" column no longer pops in.** `CatalogBrowseHealthSlot`
    gains an additive `onLoading` report (sourced from the health filler's bulk
    fetch); the manage Systems tab shows a per-row placeholder until the health
    data settles, so the status badges swap in instead of appearing onto an empty
    cell. The same tab also keeps its state badges on one row (side by side)
    instead of wrapping.
  - The system detail **Dependencies** and **Logs / Metrics / Traces** cards are now
    collapsed by default: each shows a compact "<title> N" summary and expands its
    detail on click, so the overview column stays short. They render through a new
    shared `CollapsibleDetailCard` (`@checkstack/ui`) that single-sources the header
    layout (icon + title + count + rotating chevron) so every collapsible overview
    card is vertically centred and behaves identically - the earlier per-card header
    markup had drifted and left the Logs/Metrics/Traces titles off-centre when
    collapsed.
  - Moved the system detail **SLO card** from the full-width alert strip into the
    left (monitoring) column, so it sits at the same width as the dependencies and
    health cards; only maintenances and incidents stay full width. It now joins the
    coordinated card reveal above.
  - Removed a dead, unreferenced duplicate dashboard component
    (`dashboard-frontend/src/Dashboard.tsx`); the live overview is
    `DashboardSystemHealthSection`.

  All slot-contract additions are optional/additive - existing fillers and
  consumers keep working unchanged.

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
  - @checkstack/ui@1.29.0
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/catalog-frontend@0.21.0
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/telemetry-frontend@0.1.0
  - @checkstack/healthcheck-frontend@0.37.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/logstream-common@0.4.0
  - @checkstack/tracestream-common@0.1.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1

## 0.2.0

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

- 56af572: Fix chart stretching and loading layout shift in the log-stream and
  metric-stream chart surfaces.

  - `TimeSeriesChart` now measures its container and projects the geometry at
    1 viewBox unit = 1 CSS px (re-measured on resize) instead of stretching a
    fixed 720-unit viewBox with `preserveAspectRatio="none"`, so y-axis tick
    labels and line weights render undistorted at every width. The SVG is only
    rendered once the real width is known, while the fixed-height wrapper
    reserves the space - no layout shift and no wrongly-scaled first paint.
  - The log explorer's "Pattern occurrences" chart keeps the last built chart on
    screen during refetches (`placeholderData`), quantizes its fallback
    "last 24h" window to the minute so re-renders no longer churn the query key
    (previously every parent re-render - a keystroke, expanding a log row -
    minted a new `Date`, triggering a refetch and a skeleton flash), and is
    memoized so unrelated explorer state changes skip the chart subtree
    entirely.
  - The pattern-occurrences and metric-explorer charts now use the shared 192px
    `chart` footprint, matching their skeleton and empty states so swapping
    between loading / empty / chart never shifts the layout.

- 56af572: Bound the log explorer's event search by the effective time range at all
  times. Previously the default "Last 24h" window was only applied to the
  pattern-occurrences chart while `searchEvents` was sent without `from`/`to`
  unless the user explicitly picked a range - so filtering to a pattern fetched
  its ENTIRE history, and the list could show days-old lines directly under a
  chart honestly reporting "no occurrences in this range". The search (and
  "Load older" pagination) now shares the exact window the chart uses - the
  explicit pick when set, otherwise the minute-quantized last-24h fallback - so
  the list and chart always agree and no query is ever unbounded. Pagination
  state deliberately keys on the user's explicit facets only, so the rolling
  fallback window doesn't reset loaded pages every minute.

  (Metric streams were audited for the same issue: all metricstream queries
  already require a time window or are limit-capped, so no change was needed
  there.)

- Updated dependencies [56af572]
- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/logstream-common@0.3.0
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/healthcheck-frontend@0.36.2
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/signal-common@0.3.0

## 0.1.1

### Patch Changes

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

- Updated dependencies [6540703]
- Updated dependencies [099045f]
  - @checkstack/ui@1.28.1
  - @checkstack/logstream-common@0.2.0
  - @checkstack/auth-frontend@0.13.5
  - @checkstack/healthcheck-frontend@0.36.1

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

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-frontend@0.36.0
  - @checkstack/ui@1.28.0
  - @checkstack/logstream-common@0.1.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0
