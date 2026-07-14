# @checkstack/metricstream-frontend

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
