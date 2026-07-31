# @checkstack/metricstream-frontend

## 0.3.2

### Patch Changes

- Updated dependencies [c83d0d1]
  - @checkstack/ui@1.33.0
  - @checkstack/healthcheck-frontend@0.40.0
  - @checkstack/auth-frontend@0.16.2
  - @checkstack/catalog-frontend@0.22.2
  - @checkstack/telemetry-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/auth-frontend@0.16.1
  - @checkstack/catalog-frontend@0.22.1
  - @checkstack/healthcheck-frontend@0.39.1
  - @checkstack/telemetry-frontend@0.2.1
  - @checkstack/catalog-common@2.8.3
  - @checkstack/telemetry-common@0.2.1
  - @checkstack/tracestream-common@0.1.3
  - @checkstack/metricstream-common@0.2.3

## 0.3.0

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
  - @checkstack/metricstream-common@0.2.2
  - @checkstack/tracestream-common@0.1.2
  - @checkstack/ui@1.31.0
  - @checkstack/catalog-frontend@0.22.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/healthcheck-frontend@0.39.0
  - @checkstack/telemetry-frontend@0.2.0
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/catalog-common@2.8.2
  - @checkstack/signal-common@0.3.2

## 0.2.2

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

- be74b01: Migrate the automation surfaces onto the shared filter bar, and dedupe useDebouncedValue

  Follows the native `DataTable` facet API with the first wave of migrations.

  - `DataTableFacet` gains `kind: "select" | "pills"`. A segmented pill row is the
    right control for two or three short options a reader benefits from seeing at
    a glance, and several surfaces had independently built one - so the shared bar
    renders that variant rather than forcing every list into a dropdown. Both
    variants share one state, sentinel and URL round-trip, and the pills set
    `aria-pressed`, which two of the hand-rolled groups they replace had omitted.
  - `parsedFacetValue` reads a facet's selection back as a domain value by parsing
    it against the schema that defines it. Facet state is stringly-typed because
    it round-trips through the URL, but a server-side filter needs the narrow union
    its query input declares; parsing rather than casting means a stale link
    degrades to unconstrained instead of smuggling an unknown value into a request.
  - The automation list and run-history pages drop their hand-rolled status pill
    rows for the shared bar. Their filters now persist to the URL, so a link to
    "the failed runs of this automation" reopens filtered. The run-history table
    also gains the `surface={false}` it was missing, fixing a panel-in-panel.
  - `useDebouncedValue` had been copied verbatim into six plugin packages, each
    with a comment noting no shared version existed. All six now import the one in
    `@checkstack/ui` and the copies are deleted.

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
  - @checkstack/frontend-api@0.17.0
  - @checkstack/catalog-common@2.8.1
  - @checkstack/telemetry-common@0.1.1
  - @checkstack/tracestream-common@0.1.1
  - @checkstack/metricstream-common@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [53081bd]
  - @checkstack/catalog-frontend@0.21.1
  - @checkstack/healthcheck-frontend@0.37.1

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
  - @checkstack/metricstream-common@0.2.0
  - @checkstack/tracestream-common@0.1.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1

## 0.1.2

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

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/healthcheck-frontend@0.36.2
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/metricstream-common@0.1.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/signal-common@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/auth-frontend@0.13.5
  - @checkstack/healthcheck-frontend@0.36.1

## 0.1.0

### Minor Changes

- 4568dcc: Add the metric-streams management and viewer UI. A "Metric Streams" surface
  under Reliability lists every stream with its last-received time, datapoint
  rate, series-cap usage (with a warning tone from 80% and a dropped-series
  indicator) and a coaching empty state; creating a stream is gated on the
  contract-derived create verdict and picks an owning team.

  The stream detail page has four URL-synced tabs:

  - Overview: stat tiles (datapoints/min, last received, series used vs cap with
    cap-usage tone, dropped counters), an important-events timeline (series-cap,
    scrape-failing, silence icons and tones) and a searchable metric quick-chart
    (per-bucket average with a dashed max envelope over a date range, null-filled
    across the full bucket axis so gaps stay honest).
  - Metrics: a server-side searchable browser over the stream's metric names
    (type, unit, series count, last seen) that expands to a metric's label keys
    and a bounded sample of concrete series.
  - Sources: push-endpoint snippets (OTLP + native JSON, `ckms_` token hint),
    mint-once/revoke source tokens, and Prometheus scrape-target CRUD (name, URL,
    interval, optional bearer-token secret with a stored/keep/clear affordance,
    enable toggle, last-scrape status with errors surfaced).
  - Settings: caps/retention policy form and a typed-name delete danger zone.

  Contributes the `metricstream` health-check strategy/collector config dropdown
  resolvers (stream, searchable metric name, and label key/value pickers - the
  label-value picker reads its own filter row's key via the DynamicForm
  row-scoped form values). List-page queries opt into whole-plugin signal scope;
  detail-page queries auto-scope to their stream.

- 4568dcc: Surface satellite telemetry in the frontend: satellite-side scraping and
  capability advertisement.

  - **Scrape target "Scrape from" selector** (metricstream): the create/edit
    scrape-target dialog now offers Core (the default) or a specific satellite as
    the scrape source, so a target can be pulled from inside its own network zone
    instead of opening a firewall hole for the core. Satellites that have not
    advertised the "scrape" capability are listed but disabled with a hint
    ("This satellite has not enabled scraping"). The binding persists via the
    extended `createScrapeTarget` / `updateScrapeTarget` contract (`satelliteId`,
    `null` = core). The selector is gated on satellite read access; a stream
    manager without it still edits the target, and an existing binding is
    preserved on save. The scrape-targets table gains a "Source" column badge
    showing Core vs which satellite scrapes each target (a generic "Satellite"
    fallback when the bound satellite is unavailable or not visible to the
    caller). Bearer-authenticated targets ARE scrapable from satellites: the
    token is delivered just-in-time over the secure channel per scrape and is
    never stored on the satellite, so no operator warning is needed.
  - **In-transit drop tile** (metricstream): the stream overview adds a "Dropped
    in transit" stat tile bound to `activity.droppedInTransitCount`, with a hover
    explanation ("datapoints dropped in transit from a satellite during a
    disconnect"). This is a distinct failure mode from the cardinality-cap and
    buffer-full drops - telemetry a satellite dropped from its bounded buffer
    during a disconnect, which never reached core.
  - **Satellite capability badges** (satellite): the satellite list, mobile card
    and edit ("detail") surface render the satellite's advertised capabilities
    (Telemetry, Scrape, Log receivers, Syslog) as badges, with a per-capability
    explainer on the detail surface. Unrecognised capability ids from a newer
    agent degrade gracefully to a raw-id badge.

  The id -> label mapping and the scrape-source selector state (core vs
  satellite, disabled-satellite filtering, row badge resolution) are pure and
  unit-tested.

### Patch Changes

- 4568dcc: Fix the chart-card toolbar clipping its controls off the right edge. `ChartCard`
  rendered its `actions` slot in a non-wrapping, `shrink-0` header row inside an
  `overflow-hidden` card, so a wide actions cluster (notably a `DateRangeFilter` in
  "Custom" mode, which reveals two datetime pickers) ran past the clipped edge -
  the end datetime picker was unreachable and the card title was squeezed to
  nothing.

  - `ChartCard`: the header now wraps (`flex-wrap` + `min-w-0` on the actions
    wrapper), so a wide actions cluster drops onto its own line instead of
    overflowing. This also fixes the log-stream overview's "Severity over time"
    card, which uses the same pattern.
  - Metric stream overview (`MetricQuickChart`): the search + metric-select
    controls are grouped as one wrapping unit and the time-range filter as another,
    so the toolbar wraps into tidy groups and both custom datetime pickers stay
    reachable at every viewport (they stack vertically on mobile).

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
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-frontend@0.36.0
  - @checkstack/ui@1.28.0
  - @checkstack/metricstream-common@0.1.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/common@0.22.0
