# @checkstack/tracestream-frontend

## 0.2.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/auth-frontend@0.16.1
  - @checkstack/catalog-frontend@0.22.1
  - @checkstack/healthcheck-frontend@0.39.1
  - @checkstack/telemetry-frontend@0.2.1
  - @checkstack/catalog-common@2.8.3
  - @checkstack/healthcheck-common@1.19.2
  - @checkstack/logstream-common@0.4.3
  - @checkstack/telemetry-common@0.2.1
  - @checkstack/tracestream-common@0.1.3

## 0.2.0

### Minor Changes

- 56e5375: Migrate the frontend from react-router-dom v7 to react-router v8

  Resolves GHSA-qwww-vcr4-c8h2 (HIGH): React Router before 8.3.0 has an RSC-mode
  CSRF bypass that lets an action execute before the 400 response. Checkstack runs
  a client-side SPA (`<BrowserRouter>`) and does not use RSC mode, so the platform
  was not exploitable through it - but the advisory kept the dependency-graph
  security gate red on every pull request, and the fix is only available in the 8.x
  line, which the auto-remediation deliberately will not reach (it refuses major
  bumps).

  `react-router-dom` has no v8: it was folded into `react-router` in v7 and v8
  ships as `react-router` only. So this is a package swap rather than a range bump:

  - 31 packages now depend on `react-router@^8.3.0` instead of
    `react-router-dom@^7.16.0`, and 97 source files import from `react-router`.
  - The Module Federation host share, `optimizeDeps` and `dedupe` entries move to
    `react-router` (shared singleton `requiredVersion` `^8.0.0`). Remotes never
    shared the router, so the remote contract is unchanged.
  - The syncpack unified-range group tracks `react-router`, keeping the enforced
    single-range guarantee that a past four-range regression motivated.

  The API surface Checkstack uses is unchanged between v7 and v8 - `BrowserRouter`,
  `MemoryRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useLocation`,
  `useNavigate`, `useParams` and `useSearchParams` are all exported by v8 with the
  same signatures - so no routing code changed beyond the import specifier. v8
  requires React >= 19.2.7, which the workspace already pins.

### Patch Changes

- 88f4333: Colour timeline dots, and fix the rail they hang from

  Status-update timeline dots were uniformly grey, so the rail carried no
  information. They are now toned:

  - **Maintenance** dots take the update's own status. Maintenance has no severity,
    so its lifecycle is the one coloured dimension and nothing competes with it.
  - **Incident** dots take the incident's SEVERITY, keeping status on a neutral
    pill. Incidents carry both an urgency and a lifecycle, and `status-tone.ts`
    gives the hue to the urgency - colouring both would put two competing scales on
    one row.
  - **Public status pages** now tone the dot to match the status label already
    rendered beside it.

  An update that changes nothing stays neutral, so a coloured dot always means "the
  status moved here".

  Also fixes the rail itself: it anchored its left EDGE at `left-4`, putting its
  centre at 16.25px while every dot centres at 16px, so each dot sat a hair off the
  line. The rail is now centred on the same axis, and a new exported `TimelineDot`
  owns the positioning so the four separate copies of that maths cannot diverge
  again.

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
  - @checkstack/auth-frontend@0.16.0
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/tracestream-common@0.1.2
  - @checkstack/logstream-common@0.4.2
  - @checkstack/ui@1.31.0
  - @checkstack/catalog-frontend@0.22.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/healthcheck-frontend@0.39.0
  - @checkstack/telemetry-frontend@0.2.0
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/catalog-common@2.8.2

## 0.1.2

### Patch Changes

- be74b01: Stop anonymous page loads from logging authentication errors in the backend

  Opening the app unauthenticated printed an error-level stack trace per stream
  plugin:

  ```
  error: [core] RPC /api/metricstream/listLinkedStreamStatuses failed: Authentication required
  error: [core] Stack trace: Error: Authentication required ...
  ```

  Two independent causes, both fixed:

  - The dashboard is reachable anonymously (the catalog read is public, as are
    the health-check, incident, SLO and anomaly signal sources), but the three
    stream plugins' `listLinkedStreamStatuses` is authenticated-only. Their
    dashboard signal fillers queried it regardless of the caller, so every
    anonymous page load fired three requests that could only ever come back 401.
    The fillers now gate the lookup on the caller being authenticated.
  - A contract-level 4xx (401/403/404/409/...) was logged at error level with a
    full stack trace. That is the authorization layer working as designed, not a
    server fault, and the access-log middleware already reports every 4xx
    response at warn with its method, path and status. Contract 4xx responses now
    log at debug without a stack; a 5xx stays as loud as before.

  The three fillers were byte-for-byte the same component apart from their
  client, source id and deriver, so the fetch/chunk/merge/report machinery moved
  into a shared `useLinkedStreamSignals` hook exported by
  `@checkstack/telemetry-frontend`. As a side effect the tracestream filler's
  query is now namespaced under its plugin id like the other two, so the plugin's
  signal auto-invalidator actually refreshes it.

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be5c907]
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
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ui@1.30.0
  - @checkstack/telemetry-frontend@0.1.1
  - @checkstack/catalog-frontend@0.21.2
  - @checkstack/healthcheck-frontend@0.38.0
  - @checkstack/auth-frontend@0.15.0
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/catalog-common@2.8.1
  - @checkstack/logstream-common@0.4.1
  - @checkstack/telemetry-common@0.1.1
  - @checkstack/tracestream-common@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [53081bd]
  - @checkstack/catalog-frontend@0.21.1
  - @checkstack/healthcheck-frontend@0.37.1

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
- Updated dependencies [6c8b36b]
  - @checkstack/ui@1.29.0
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/catalog-frontend@0.21.0
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/telemetry-frontend@0.1.0
  - @checkstack/healthcheck-frontend@0.37.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/logstream-common@0.4.0
  - @checkstack/tracestream-common@0.1.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
