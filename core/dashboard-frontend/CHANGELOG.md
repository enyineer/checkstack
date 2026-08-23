# @checkstack/dashboard-frontend

## 0.12.3

### Patch Changes

- Updated dependencies [68ef4b2]
  - @checkstack/ui@1.33.1
  - @checkstack/catalog-frontend@0.22.3
  - @checkstack/command-frontend@0.6.3
  - @checkstack/queue-frontend@0.8.3
  - @checkstack/tips-frontend@0.5.9
  - @checkstack/catalog-common@2.8.4
  - @checkstack/healthcheck-common@1.19.3
  - @checkstack/incident-common@1.11.2
  - @checkstack/maintenance-common@1.11.2

## 0.12.2

### Patch Changes

- Updated dependencies [c83d0d1]
  - @checkstack/ui@1.33.0
  - @checkstack/catalog-frontend@0.22.2
  - @checkstack/command-frontend@0.6.2
  - @checkstack/queue-frontend@0.8.2
  - @checkstack/tips-frontend@0.5.8

## 0.12.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/catalog-frontend@0.22.1
  - @checkstack/command-frontend@0.6.1
  - @checkstack/queue-frontend@0.8.1
  - @checkstack/tips-frontend@0.5.7
  - @checkstack/catalog-common@2.8.3
  - @checkstack/healthcheck-common@1.19.2
  - @checkstack/incident-common@1.11.1
  - @checkstack/maintenance-common@1.11.1

## 0.12.0

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
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/incident-common@1.11.0
  - @checkstack/maintenance-common@1.11.0
  - @checkstack/ui@1.31.0
  - @checkstack/catalog-frontend@0.22.0
  - @checkstack/command-common@0.4.0
  - @checkstack/command-frontend@0.6.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/notification-common@1.9.0
  - @checkstack/queue-frontend@0.8.0
  - @checkstack/tips-frontend@0.5.6
  - @checkstack/catalog-common@2.8.2
  - @checkstack/signal-frontend@0.3.8

## 0.11.2

### Patch Changes

- be74b01: Converge the status-tone exceptions that turned out to be drift

  Reviewing the four "deliberate exceptions" left by the tone de-duplication, three
  were drift wearing a comment, and one was genuine.

  - **`neutralToneStyle` is now exported from `@checkstack/ui`.** Three plugins had
    each written out the same three muted strings by hand. It sits beside
    `pillToneStyles` rather than in it, because the absence of a tone is not a
    tone; `StatusPill`'s `tone="neutral"` renders it.
  - **Dashboard signals use the status ladder's blue.** In one record `error` and
    `warn` came from the ladder while `info` reached for the general-purpose
    `--info` accent - so the same "Watch" signal rendered in two different blues
    depending on whether you looked at the problem card, its chip, or the fleet
    header bar. All three now use `--status-info`, which is also the darker L45
    blue chosen precisely so its text stays readable on a light card.
  - **The system incident panel borders at `/20`** like every other tinted border,
    removing the last class-string divergence in the tone system along with the
    one-off map that documented it.
  - **The queue's neutral pills use the shared neutral.** Its KPI tile and its job
    state pill each carried a slightly softer private variant, so "carries no
    signal" looked like two different things on one page.

  The one genuine exception kept: `--info` and `--status-info` remain separate
  tokens. The first is the general semantic palette (alongside `--success` /
  `--warning`), the second the colourblind-safe status ladder with its own
  contrast rationale. Non-status surfaces - the `Alert` component, plugin-type
  chips - keep the general accent.

- be74b01: Source every status tone from the one shared table

  Nineteen plugin modules each re-declared the tone-to-class table verbatim
  (`pill: "bg-status-ok/10 text-status-ok"`, `dot: "bg-status-ok"`, ...), some
  reproducing every field of the shared one. They now take those classes from
  `pillToneStyles` in `@checkstack/ui` while keeping their own domain mapping -
  which value means which tone - since that is real domain knowledge and is unit
  tested. A repo-wide search for a hand-written triad row now returns only the
  shared table.

  Several hand-rolled pills went with them, onto the shared `StatusPill`: the
  automation run pill, the satellite status badge, the notification channel pill,
  the SLO objective pill and both AI tool-card pills.

  Four rows are deliberately still local, each with a comment saying why, because
  they are NOT the shared tone despite looking like it:

  - The dashboard's `info` uses the `--info` token, a different hue from
    `--status-info` (light: `217 91% 60%` vs `214 90% 45%`).
  - Integrations' and notifications' `unknown`/`neutral` use the muted treatment -
    the ABSENCE of a tone - not the shared grey.
  - The queue's "processing" uses opacity-softened muted classes that match
    neither the shared table nor the pill's neutral.

  One genuine class divergence was found and NOT normalised: the system incident
  panel draws its borders at `/30` where the shared table uses `/20`. It is now a
  single documented map instead of a full private table.

  Pills whose geometry has no shared equivalent (the dependency canvas node with
  its animated halo, the incident panel's compact chips, the dashboard's
  non-triad signal tone) keep their markup and now only share the classes.

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
  - @checkstack/ui@1.30.0
  - @checkstack/queue-frontend@0.7.9
  - @checkstack/catalog-frontend@0.21.2
  - @checkstack/notification-common@1.8.0
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/command-frontend@0.5.15
  - @checkstack/tips-frontend@0.5.5
  - @checkstack/catalog-common@2.8.1
  - @checkstack/incident-common@1.10.5
  - @checkstack/maintenance-common@1.10.5

## 0.11.1

### Patch Changes

- Updated dependencies [53081bd]
  - @checkstack/catalog-frontend@0.21.1

## 0.11.0

### Minor Changes

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

### Patch Changes

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
  - @checkstack/catalog-frontend@0.21.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/queue-frontend@0.7.8
  - @checkstack/common@0.23.0
  - @checkstack/command-frontend@0.5.14
  - @checkstack/tips-frontend@0.5.4
  - @checkstack/incident-common@1.10.4
  - @checkstack/maintenance-common@1.10.4
  - @checkstack/command-common@0.3.12
  - @checkstack/notification-common@1.7.2
  - @checkstack/signal-frontend@0.3.7

## 0.10.11

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/catalog-frontend@0.20.2
  - @checkstack/command-frontend@0.5.13
  - @checkstack/queue-frontend@0.7.7
  - @checkstack/tips-frontend@0.5.3
  - @checkstack/catalog-common@2.7.3
  - @checkstack/command-common@0.3.11
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/incident-common@1.10.3
  - @checkstack/maintenance-common@1.10.3
  - @checkstack/notification-common@1.7.1
  - @checkstack/signal-frontend@0.3.6

## 0.10.10

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/catalog-frontend@0.20.1
  - @checkstack/command-frontend@0.5.12
  - @checkstack/queue-frontend@0.7.6
  - @checkstack/tips-frontend@0.5.2

## 0.10.9

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/catalog-frontend@0.20.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/command-frontend@0.5.11
  - @checkstack/queue-frontend@0.7.5
  - @checkstack/tips-frontend@0.5.1
  - @checkstack/command-common@0.3.11
  - @checkstack/common@0.22.0
  - @checkstack/incident-common@1.10.3
  - @checkstack/maintenance-common@1.10.3
  - @checkstack/notification-common@1.7.1
  - @checkstack/signal-frontend@0.3.6

## 0.10.8

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/tips-frontend@0.5.0
  - @checkstack/command-frontend@0.5.10
  - @checkstack/catalog-frontend@0.19.1
  - @checkstack/queue-frontend@0.7.4
  - @checkstack/catalog-common@2.7.2
  - @checkstack/healthcheck-common@1.16.2
  - @checkstack/incident-common@1.10.2
  - @checkstack/maintenance-common@1.10.2

## 0.10.7

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
- Updated dependencies [bd41130]
  - @checkstack/ui@1.26.1
  - @checkstack/catalog-frontend@0.19.0
  - @checkstack/frontend-api@0.14.2
  - @checkstack/notification-common@1.7.0
  - @checkstack/command-frontend@0.5.9
  - @checkstack/queue-frontend@0.7.3
  - @checkstack/tips-frontend@0.4.12
  - @checkstack/catalog-common@2.7.1
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/incident-common@1.10.1
  - @checkstack/maintenance-common@1.10.1

## 0.10.6

### Patch Changes

- 43e4484: Catalog browse view: wrap rows in the bulk badge-data provider so
  health/incident/maintenance badges stop fetching per-row (performance-only,
  behavior unchanged).

  dashboard-frontend now fills catalog's `CatalogBrowseDataBoundarySlot` with an
  eager filler that wraps the boundary's `children` (the whole browse tree) in its
  existing `SystemBadgeDataProvider`, keyed on the visible `systemIds`. The
  per-row `SystemHealthBadge` / `SystemIncidentBadge` / `SystemMaintenanceBadge`
  already read `useSystemBadgeDataOptional()` and now resolve from that bulk
  context instead of each issuing a singular per-system RPC, eliminating the
  browse view's N+1. All cross-plugin coupling lives on the filler side; catalog
  gains no new dependency.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/catalog-common@2.7.0
  - @checkstack/catalog-frontend@0.18.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/ui@1.26.0
  - @checkstack/incident-common@1.10.0
  - @checkstack/maintenance-common@1.10.0
  - @checkstack/notification-common@1.6.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/command-frontend@0.5.8
  - @checkstack/queue-frontend@0.7.2
  - @checkstack/tips-frontend@0.4.11

## 0.10.5

### Patch Changes

- d0eddc9: Cut the per-tick database work of the health-check executor by batching
  scoped-database queries, and fix a dashboard "Recent activity" rendering bug.

  The scoped-database proxy has to wrap every standalone query in its own
  transaction so `SET LOCAL search_path` applies to it, which means a hot path
  issuing many sequential queries pays the `BEGIN` / `SET LOCAL` / `COMMIT`
  round-trips once per query and checks a connection out that many times. Two
  changes remove most of that overhead on the health-check path:

  - **New `withScopedTransaction` helper (`@checkstack/backend-api`).** A reusable
    primitive for running several scoped queries under a SINGLE `SET LOCAL
search_path` transaction, plus `ScopedTransaction` / `ScopedQueryRunner`
    types so a helper can accept either the scoped db or a transaction handle.
    Use it on any scoped-db hot path that issues 2+ queries in sequence.
  - **`getSystemHealthStatus` is now batched.** It was a `1 + N` read fan-out (one
    associations query, then one run-window query per enabled check) run as `1 +
N` separate proxy transactions. It now runs as ONE transaction. This is the
    hottest read on the platform - each check tick reads it several times, and the
    dashboard, RPC router, and AI system-signals all call it - so the reduction in
    transaction volume and connection churn is broad. The reads are also now a
    single consistent snapshot.
  - **The executor's run + aggregate writes are batched.** Each persisted run
    previously issued the run `INSERT`, the aggregate `SELECT`, and the aggregate
    `UPSERT` as three separate proxy transactions; they now run in one
    transaction and commit atomically (the run and the aggregate it feeds can no
    longer be persisted apart).

  Behaviour is unchanged: the derived health status, transition detection, and
  signals are identical; only the number of database transactions per tick drops.

  Also fixes a dashboard bug where the "Recent activity" feed generated React keys
  from `configurationName` plus a millisecond timestamp, so results from different
  systems sharing a check name that completed in the same millisecond collided on
  one key and React mis-reconciled the list (visually duplicated/omitted entries).
  Keys are now derived from the system, configuration, and environment ids.

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/catalog-frontend@0.17.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/incident-common@1.9.0
  - @checkstack/maintenance-common@1.9.0
  - @checkstack/command-common@0.3.11
  - @checkstack/command-frontend@0.5.7
  - @checkstack/notification-common@1.5.3
  - @checkstack/queue-frontend@0.7.1
  - @checkstack/tips-frontend@0.4.10
  - @checkstack/signal-frontend@0.3.5

## 0.10.4

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/incident-common@1.8.0
  - @checkstack/catalog-frontend@0.16.0
  - @checkstack/queue-frontend@0.7.0
  - @checkstack/ui@1.25.0
  - @checkstack/tips-frontend@0.4.9
  - @checkstack/command-frontend@0.5.6

## 0.10.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/catalog-frontend@0.15.3
  - @checkstack/command-frontend@0.5.5
  - @checkstack/queue-frontend@0.6.7
  - @checkstack/tips-frontend@0.4.8
  - @checkstack/catalog-common@2.6.2
  - @checkstack/command-common@0.3.10
  - @checkstack/frontend-api@0.13.2
  - @checkstack/incident-common@1.7.2
  - @checkstack/maintenance-common@1.8.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-frontend@0.3.4

## 0.10.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/ui@1.23.0
  - @checkstack/catalog-common@2.6.1
  - @checkstack/catalog-frontend@0.15.2
  - @checkstack/command-common@0.3.9
  - @checkstack/command-frontend@0.5.4
  - @checkstack/frontend-api@0.13.1
  - @checkstack/incident-common@1.7.1
  - @checkstack/maintenance-common@1.8.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/queue-frontend@0.6.6
  - @checkstack/tips-frontend@0.4.7
  - @checkstack/signal-frontend@0.3.3

## 0.10.1

### Patch Changes

- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/catalog-frontend@0.15.1
  - @checkstack/tips-frontend@0.4.6

## 0.10.0

### Minor Changes

- 259b93c: Surface scheduled (upcoming) maintenances on the dashboard.

  The dashboard now shows a "Planned maintenances" section listing the soonest
  scheduled maintenance windows (not yet started), each deep-linking to its
  detail page. Previously scheduled windows were invisible on the dashboard until
  they went live - operators had no at-a-glance view of upcoming planned work.

  Only `scheduled` windows are listed. In-progress windows continue to surface as
  per-system signals via the existing signals filler; showing them here too would
  duplicate. The section renders nothing when there are no upcoming windows, so
  the dashboard stays calm.

  Dashboard sections are now registered as individual `DashboardSlot` extensions
  with a `priority` metadata field, rendered sorted ascending. This replaces the
  single monolithic `dashboard-main` extension and lets plugins position their
  dashboard contributions relative to the platform-owned sections without a fixed
  slot per position. Priority layout:

  - 0: Welcome banner + getting-started checklist + queue-lag alert
  - 5: Active announcements
  - 10: System health overview
  - 20: Planned maintenances (new)
  - 30: Recent activity feed

  `SectionHeader` now accepts an optional `actions` prop for right-aligned
  controls, and both "System health" and "Planned maintenances" use it for
  consistent header styling.

- d2d49cf: Show the environment for fanned-out runs in the dashboard Recent Activity feed.
  The `healthcheck.run.completed` signal now carries optional `environmentId` and
  `environmentName` fields, populated at the two per-environment fan-out broadcast
  sites in the run executor. The Dashboard "Recent activity" terminal feed renders
  the environment name inline (`system (config) @ env -> status`) when a run was
  fanned out to an environment. Runs that are not environment-scoped omit both
  fields and render exactly as before, so their behavior is unchanged.

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d1b71b6]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [53666a7]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/catalog-frontend@0.15.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/incident-common@1.7.0
  - @checkstack/maintenance-common@1.8.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/tips-frontend@0.4.5
  - @checkstack/command-frontend@0.5.3
  - @checkstack/queue-frontend@0.6.5
  - @checkstack/command-common@0.3.8
  - @checkstack/signal-frontend@0.3.2

## 0.9.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/catalog-frontend@0.14.1
  - @checkstack/command-frontend@0.5.2
  - @checkstack/queue-frontend@0.6.4
  - @checkstack/tips-frontend@0.4.4

## 0.9.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/catalog-frontend@0.14.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/ui@1.20.0
  - @checkstack/incident-common@1.6.4
  - @checkstack/maintenance-common@1.7.4
  - @checkstack/command-common@0.3.7
  - @checkstack/command-frontend@0.5.1
  - @checkstack/frontend-api@0.12.1
  - @checkstack/notification-common@1.4.2
  - @checkstack/queue-frontend@0.6.3
  - @checkstack/tips-frontend@0.4.3
  - @checkstack/signal-frontend@0.3.1

## 0.9.2

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/command-frontend@0.5.0
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/catalog-frontend@0.13.2
  - @checkstack/command-common@0.3.6
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/incident-common@1.6.3
  - @checkstack/maintenance-common@1.7.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/queue-frontend@0.6.2
  - @checkstack/tips-frontend@0.4.2
  - @checkstack/common@0.17.0

## 0.9.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/catalog-frontend@0.13.1
  - @checkstack/command-frontend@0.4.1
  - @checkstack/queue-frontend@0.6.1
  - @checkstack/tips-frontend@0.4.1

## 0.9.0

### Minor Changes

- 8cad340: Design-system rework: a premium, consistent UI language across the platform.

  Foundation (`@checkstack/ui` + the shared Tailwind preset):

  - A token system wired into the shared preset so it generates app-wide: a
    surface elevation ramp (`surface` / `surface-2` / `surface-inset`), the
    aurora gradient stops, a colorblind-safe `status` triad, and `grid-line`.
  - A density model (`comfortable` / `compact`) via `--d-*` vars + `DensityProvider`
    / `useDensity`, with a user-menu density toggle, plus the polished
    skeleton / empty / error state set.
  - Honest, token-driven chart primitives (`TimeSeriesChart`, `Sparkline`,
    `RadialGauge` / aurora hero, `RequestWaterfall`, `UptimeRibbon`).
  - A signature aurora moment per page: `PageHeader` paints its icon strokes with
    the aurora gradient and adds a hairline; `Card` gains soft layered depth.

  Shell + surfaces:

  - The app shell adopts the elevation ramp (header `surface-2`, sidebar
    `surface`, content on the ambient base).
  - The system-health dashboard, health-check latency / single-run views, and the
    SLO dashboard are reskinned onto the primitives (aurora confidence gauge,
    honest p50/p95 latency, request waterfall, number-led status cards).

  App-wide adoption + premium rework:

  - Every plugin frontend adopts the tokens, status triad, density, and elevation.
  - The highest-impact surfaces in each plugin are then redesigned to a premium
    bar: real depth, number-led hierarchy, multi-encoded status (pill + dot +
    accent stripe), and refined list/table density. Several plugins extract pure
    tone/label/format logic into unit-tested modules.

  Alerts:

  - Every alert/callout is unified onto a single premium `Alert` (depth surface +
    status-accent stripe + toned icon chip, variant-driven).

  BREAKING CHANGE: the duplicate `InfoBanner` component (and its sub-components)
  is removed; use `Alert` instead - it is a drop-in replacement with the same
  variants and composable parts.

- 8cad340: Add persistent in-app help and a fresh-install getting-started checklist.

  - A persistent help affordance now lives in the navbar: a "?" icon button
    (accessible name "Help and documentation") opens a popover (sheet on mobile)
    containing a Documentation link to the user guide, a "Show tips again" action,
    and a one-line legend explaining the lightbulb (concept tip) vs tooltip
    (affordance hint) convention. Help is now reachable from every page rather
    than only via the sidebar's Docs link.
  - The documented "replay onboarding" capability is now wired: a new
    `useResetAllTips` hook in `@checkstack/tips-frontend` calls `TipsApi.reset`
    with no ids (clearing every dismissed tip for the user, server + localStorage),
    surfaced as the help menu's "Show tips again" action with a confirmation toast.
  - The dashboard now shows a dismissable "Getting started" checklist on fresh
    installs (zero catalog systems, derived from the existing entities query - no
    new queries). It links the next three steps: add a system, attach a health
    check, connect a notification channel. Dismissal persists per-user via the
    tips dismissal mechanism and is restorable from the help menu. The existing
    "Nothing to show on the dashboard yet" empty state is unchanged.

- 8cad340: Improve list-page feedback, loading, and formatting consistency.

  The dashboard, catalog browse, and status-pages list pages now render an
  explicit query-error state (`QueryErrorState` with a Retry button) when their
  list query fails, instead of silently falling through to the empty state. The
  error branch is additive: it only appears on a failed query, so the existing
  empty-state copy and behavior are unchanged.

  The dashboard system-health overview and the catalog browse list now show
  layout-mimicking `Skeleton` placeholders while loading (instead of a centered
  spinner), so the page no longer jumps when data resolves.

  Toast call sites in catalog and status-page now route error and success
  toasts through the shared `toastError` / `toastSuccess` helpers, giving error
  toasts the canonical "{action}: {message}" voice with length truncation. The
  public status-page uptime percentages now format through the shared
  `formatPercent` helper (output-equivalent). The dashboard tip-banner lightbulb
  accent uses the `text-warning` token instead of a hardcoded amber color.

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ui@1.17.0
  - @checkstack/command-frontend@0.4.0
  - @checkstack/catalog-frontend@0.13.0
  - @checkstack/queue-frontend@0.6.0
  - @checkstack/tips-frontend@0.4.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/incident-common@1.6.2
  - @checkstack/maintenance-common@1.7.2
  - @checkstack/command-common@0.3.5
  - @checkstack/signal-frontend@0.2.6

## 0.8.11

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1
  - @checkstack/catalog-frontend@0.12.1
  - @checkstack/command-frontend@0.3.8
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/incident-common@1.6.1
  - @checkstack/maintenance-common@1.7.1
  - @checkstack/queue-frontend@0.5.8
  - @checkstack/tips-frontend@0.3.9
  - @checkstack/ui@1.16.2

## 0.8.10

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/catalog-frontend@0.12.0
  - @checkstack/incident-common@1.6.0
  - @checkstack/maintenance-common@1.7.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/command-common@0.3.4
  - @checkstack/command-frontend@0.3.7
  - @checkstack/queue-frontend@0.5.7
  - @checkstack/signal-frontend@0.2.5

## 0.8.9

### Patch Changes

- Updated dependencies [bb6f0fe]
  - @checkstack/maintenance-common@1.6.0

## 0.8.8

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/catalog-frontend@0.11.7
  - @checkstack/command-frontend@0.3.6
  - @checkstack/queue-frontend@0.5.6
  - @checkstack/tips-frontend@0.3.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/incident-common@1.5.2
  - @checkstack/maintenance-common@1.5.2

## 0.8.7

### Patch Changes

- @checkstack/catalog-common@2.3.5
- @checkstack/catalog-frontend@0.11.6
- @checkstack/tips-frontend@0.3.6
- @checkstack/healthcheck-common@1.6.1
- @checkstack/incident-common@1.5.1
- @checkstack/maintenance-common@1.5.1

## 0.8.6

### Patch Changes

- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/incident-common@1.5.0
  - @checkstack/maintenance-common@1.5.0

## 0.8.5

### Patch Changes

- 460ffd6: Align dashboard system-signal rows. Text (non-link) signals - shown when the
  viewer can't open the target - were indented ~0.5rem further right than link
  signals, because the link row used a negative horizontal margin (`-mx-2`) to let
  its hover background bleed past the text while the text row did not. The text row
  now uses the same horizontal box, so link and text signals line up.
- 56e7c75: Hide navigation, actions and links that the current user cannot use, so anonymous
  and read-only users no longer see entries that lead to "Access Denied" or to
  actions the server would reject.

  - **Sidebar**: a nav entry can now declare a dynamic `nav.isVisible({ accessRules, isAuthenticated })` predicate (in addition to the static `accessRule`). A group whose every entry is filtered out is no longer rendered. The filtering/grouping logic is extracted to a pure, unit-tested helper.
  - **Infrastructure**: its sidebar entry is shown only when the user can READ at least one contributed tab (queue, cache, …), instead of always (it previously had no static rule because tabs are contributed at runtime).
  - **Notification Settings**: hidden from anonymous users - notifications are per-user, so an anonymous visitor can't have any.
  - **Anomaly Mute / Suppress**: the "Mute" / "Mute all" controls (a per-user preference) are hidden from anonymous visitors; the "Suppress" control is gated on `anomalyAccess.feed.manage`. Both were previously always visible.
  - **Dashboard**: the "Open Catalog" actions (which open the manage-only Catalog config page) are hidden from users without `catalogAccess.system.manage`, and the "View catalog" link is gated on `catalogAccess.system.read`.
  - **Dashboard status signals**: the per-system status rows contributed by plugins (`SystemSignalsSlot`) now render as a LINK only when the user can open the target, and as plain text otherwise. `SystemSignal` gains an optional `accessRule`; the healthcheck, anomaly, and dependency fillers set it for their gated targets (check-history / assignments / dependency-map). Signals pointing at ungated pages (incident / maintenance / SLO detail) stay links.
  - **Plugin Manager**: the "Install plugin" button (which opens the install-gated page) is hidden from users with only `plugin` view access.
  - **Satellites**: the page is entirely manage-gated, but its route/sidebar entry was gated on `read`, so read-only users saw the nav item and hit "Access Denied" on click. The route and nav entry now require `satellite.manage`.

  The `@checkstack/ai-backend` bump is only the regenerated bundled docs index
  (the frontend routing guide gained the `nav.isVisible` section); no code change.

  **BREAKING (`@checkstack/frontend-api`):** the `AccessApi` interface gains a
  required `useIsAuthenticated()` method. Custom `AccessApi` implementations must
  add it (it returns `{ loading, isAuthenticated }`). The built-in auth
  implementation and the no-auth fallback already do. `NavEntry` also gains an
  optional `isVisible` predicate (purely additive).

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/incident-common@1.4.4
  - @checkstack/maintenance-common@1.4.4
  - @checkstack/catalog-frontend@0.11.5
  - @checkstack/tips-frontend@0.3.5
  - @checkstack/command-frontend@0.3.5
  - @checkstack/queue-frontend@0.5.5
  - @checkstack/command-common@0.3.3
  - @checkstack/signal-frontend@0.2.4

## 0.8.4

### Patch Changes

- fb705df: Upgrade React 18 to React 19 across the platform.

  **BREAKING (runtime frontend plugins):** React is shared as a Module Federation
  singleton, so the host now provides **React 19** to every runtime plugin.
  Frontend plugins built against React 18 must be rebuilt against React 19
  (`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
  `requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
  to a single version across the workspace via syncpack so the singleton can never
  skew (react and react-dom must match exactly).

  The React 19 removed-API surface was audited - the codebase used only no-arg
  `useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
  legacy context, string refs, or function-component `defaultProps`. This also
  clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
  `React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

  The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
  receive only the mechanical `react` dependency bump (`patch`); the framework
  packages carrying the shared-singleton change are bumped `minor`.

- Updated dependencies [9d8961c]
- Updated dependencies [fb705df]
  - @checkstack/ui@1.15.0
  - @checkstack/frontend-api@0.8.0
  - @checkstack/catalog-frontend@0.11.4
  - @checkstack/command-frontend@0.3.4
  - @checkstack/queue-frontend@0.5.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/catalog-common@2.3.3
  - @checkstack/incident-common@1.4.3
  - @checkstack/maintenance-common@1.4.3
  - @checkstack/command-common@0.3.2
  - @checkstack/common@0.14.1
  - @checkstack/healthcheck-common@1.5.3

## 0.8.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/catalog-frontend@0.11.3
  - @checkstack/command-frontend@0.3.3
  - @checkstack/queue-frontend@0.5.3
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/catalog-common@2.3.2
  - @checkstack/command-common@0.3.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/maintenance-common@1.4.2
  - @checkstack/signal-frontend@0.2.2

## 0.8.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/catalog-frontend@0.11.2
  - @checkstack/command-common@0.3.2
  - @checkstack/command-frontend@0.3.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/maintenance-common@1.4.2
  - @checkstack/queue-frontend@0.5.2
  - @checkstack/tips-frontend@0.3.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.8.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/catalog-common@2.3.1
  - @checkstack/catalog-frontend@0.11.1
  - @checkstack/command-common@0.3.1
  - @checkstack/command-frontend@0.3.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/incident-common@1.4.1
  - @checkstack/maintenance-common@1.4.1
  - @checkstack/queue-frontend@0.5.1
  - @checkstack/tips-frontend@0.3.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.8.0

### Minor Changes

- 9dcc848: Redesign the dashboard as an extensible "needs attention" overview, and normalize system state badges.

  The dashboard now surfaces ONLY systems that need attention (degraded, unhealthy, breaching/at-risk SLO, under an incident or active maintenance, anomalous, or with a dependency problem) and hides everything healthy. A compact header summarises fleet health and filters by severity; each problem renders as an elevated card with one row per issue that deep-links to where the issue originates. A calm "all clear" state shows when nothing needs attention, a live "recent activity" feed sits below, and a "View catalog" link replaces the duplicated system list.

  New platform contract `SystemSignalsSlot` (`@checkstack/catalog-common`): a headless, render-once slot where any plugin bulk-fetches and reports structured `SystemSignal[]` per system via `onSignals(sourceId, map)`. The dashboard aggregates every source agnostic to which plugins contribute; each core reliability plugin (healthcheck, incident, SLO, maintenance, anomaly, dependency) ships a filler, and third-party plugins add new per-system state the same way with no dashboard change. Signals carry an `iconName` rendered via `DynamicIcon` so the contract stays React-free. The dashboard's old summary tiles and overview sheets are removed, so it no longer depends on those plugins' packages. The group "subscribe" control moved onto the catalog browse page's group headers.

  System state badges are normalized into one icon-only `@checkstack/ui` `StatusBadge` primitive - a small tinted icon chip with the full label on hover/focus (and via `aria-label`). Each signal uses its feature's navbar icon (health = Activity, incident = AlertTriangle, SLO = Target, maintenance = Wrench, dependency = GitBranch; anomaly = ChartSpline). Badges self-sort by severity via CSS `order` (error -> warn -> info), tooltips are scoped to a named group, and in catalog browse rows the cluster moved to the right edge.

  This is a beta minor.

- 9dcc848: Cut initial-load JS: lazy plugin contributions, a hardened lazy-by-default contribution contract, on-demand Monaco, and a lighter icon/chart load.

  - Lazy plugin route pages: each plugin's route `element` references a `React.lazy`-wrapped page rendered inside a shared `<Suspense>` boundary. Plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are available on first paint. This moves ~37 route-page chunks (~600 KB) out of the entry; the entry chunk drops from ~2.4 MB to ~190 KB. Auth flow pages stay eager. The `@checkstack/scripts` scaffold template generates lazy route pages too.
  - Hardened contribution contract (BREAKING, frontend plugin contract): plugins declare contributions lazily and let the framework own code-splitting, Suspense, and per-plugin error isolation. Routes use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />` (`element` is still accepted for the rare page that must paint without a chunk fetch; provide exactly one). Slot extensions accept either an eager `component` or a lazy `load`; new `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind. This also fixes runtime-installed plugins: `ExtensionSlot` subscribes to the plugin registry, and the API registry rebuilds when the plugin set changes (`getPlugins()` returns an immutable snapshot via `useSyncExternalStore`). A per-plugin error boundary contains a bad contribution.
  - On-demand Monaco: the `@checkstack/ui` barrel no longer pulls the `@codingame/*` / `monaco-languageclient` stack into the initial load. `CodeEditor` lazy-loads its Monaco-backed editor behind `React.lazy` + Suspense, `validateTypeScriptSources` imports the editor API via in-body `await import(...)`, and the "vscode services ready" signal moved to a Monaco-free module. The ~10 MB editor body loads only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was added for stable vendor caching.
  - lucide-react 1.x + lighter icons/charts (BREAKING for icon consumers): lucide-react unified from three drifting ranges to `^1.17.0`. lucide v1 removed brand icons, so the GitHub/GitLab marks are vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`); a new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is canonical, accepted by `AuthStrategy.icon` and the card components, so data-driven brand names keep working. `DynamicIcon` no longer eagerly imports lucide's ~1600-icon map (~1 MB) - it lives in a `React.lazy` `iconRegistry` chunk fetched on first data-driven render, while statically named-imported icons tree-shake normally. The recharts-backed health-check charts (~300 KB) and the `HealthCheckSystemOverview` drawer leave the initial load.

  BREAKING CHANGES:

  - Frontend plugin contract: routes/slot contributions are lazy-by-default (`load` instead of `element`/eager elements) as described above.
  - Any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/catalog-frontend@0.11.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/command-frontend@0.3.0
  - @checkstack/queue-frontend@0.5.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/command-common@0.3.0
  - @checkstack/incident-common@1.4.0
  - @checkstack/maintenance-common@1.4.0
  - @checkstack/signal-frontend@0.2.0

## 0.7.8

### Patch Changes

- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/maintenance-common@1.3.0
  - @checkstack/auth-frontend@0.6.7
  - @checkstack/catalog-frontend@0.10.7
  - @checkstack/command-frontend@0.2.42
  - @checkstack/notification-frontend@0.4.7
  - @checkstack/queue-frontend@0.4.7
  - @checkstack/tips-frontend@0.2.7

## 0.7.7

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
- Updated dependencies [c39ee69]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/ui@1.11.0
  - @checkstack/common@0.12.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/auth-frontend@0.6.6
  - @checkstack/catalog-common@2.2.3
  - @checkstack/catalog-frontend@0.10.6
  - @checkstack/command-frontend@0.2.41
  - @checkstack/incident-common@1.3.1
  - @checkstack/maintenance-common@1.2.3
  - @checkstack/notification-frontend@0.4.6
  - @checkstack/queue-frontend@0.4.6
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/anomaly-common@1.2.3
  - @checkstack/command-common@0.2.14
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-frontend@0.1.5

## 0.7.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/incident-common@1.3.0

## 0.7.5

### Patch Changes

- f23f3c9: Gate decorative motion and blur effects behind
  `usePerformance().isLowPower` on a focused set of high-traffic plugin
  pages (Dashboard, Dependency map, System node, Notification bell,
  Announcement banner / cards, Anomaly field overrides editor, SLO
  attribution chart, Catalog droppable group). Hover scales, backdrop
  blurs, `animate-pulse`/`animate-ping` accents, and entry transitions
  now drop to static states on low-power devices; functional UX
  transitions (Drawer/Dialog open-close, colour transitions) are left
  alone.

  Standardise the post-mutation error-toast voice on plugin pages by
  migrating multi-clause `toast.error(extractErrorMessage(error, "Failed
to X"))` call sites onto the `toastError(toast, "Failed to X", error)`
  helper from `@checkstack/ui`. The helper applies the canonical
  `"action: message"` prefix and 100-character truncation in one place,
  and the now-orphaned `extractErrorMessage` imports are dropped from
  the affected files. No business logic or component APIs changed.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/notification-frontend@0.4.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/catalog-frontend@0.10.5
  - @checkstack/queue-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/anomaly-common@1.2.2
  - @checkstack/catalog-common@2.2.2
  - @checkstack/command-common@0.2.13
  - @checkstack/command-frontend@0.2.40
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/incident-common@1.2.2
  - @checkstack/maintenance-common@1.2.2
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.7.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/ui@1.9.0
  - @checkstack/anomaly-common@1.2.1
  - @checkstack/catalog-common@2.2.1
  - @checkstack/catalog-frontend@0.10.4
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/incident-common@1.2.1
  - @checkstack/maintenance-common@1.2.1
  - @checkstack/notification-frontend@0.4.4
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/command-frontend@0.2.39
  - @checkstack/queue-frontend@0.4.4
  - @checkstack/tips-frontend@0.2.4

## 0.7.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/catalog-frontend@0.10.3
  - @checkstack/command-frontend@0.2.38
  - @checkstack/notification-frontend@0.4.3
  - @checkstack/queue-frontend@0.4.3
  - @checkstack/tips-frontend@0.2.3

## 0.7.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/catalog-frontend@0.10.2
  - @checkstack/command-frontend@0.2.37
  - @checkstack/notification-frontend@0.4.2
  - @checkstack/queue-frontend@0.4.2
  - @checkstack/tips-frontend@0.2.2

## 0.7.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/maintenance-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/anomaly-common@1.2.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/catalog-frontend@0.10.1
  - @checkstack/command-common@0.2.12
  - @checkstack/command-frontend@0.2.36
  - @checkstack/frontend-api@0.5.1
  - @checkstack/notification-frontend@0.4.1
  - @checkstack/queue-frontend@0.4.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.7.0

### Minor Changes

- 3547670: Wire the new tips infrastructure across the frontends:

  **Empty-state coaching.** Replace generic "no items" copy with onboarding
  guidance — short description, three numbered steps and a primary CTA — on
  every EmptyState that has a meaningful next action. Affects: catalog
  (systems + groups), dashboard, health-check page, integrations (subscriptions

  - provider connections), GitOps providers + secrets, GitOps provenance,
    SLO config + overview, maintenance config, satellites, plugin manager,
    incident config, announcements. Read-only EmptyStates (incident history,
    maintenance history, plugin events) get clearer descriptions explaining
    what would populate them.

  **First-run anchored tips.** Add `<Tip>` popovers to the most important
  "Create" affordances so first-time users see a one-line explanation of
  what they're about to make and why it matters: catalog “Add System” /
  “Add Group”, healthcheck “Create Check”, integrations “New Subscription”,
  GitOps “Add Provider”, SLO “Create SLO”, maintenance “Create Maintenance”,
  satellite “Create Satellite”, plugin-manager “Install plugin”, incident
  “Report Incident”, announcement “New Announcement”. Each tip is dismissed
  per user (server-backed when signed in, localStorage otherwise) and
  namespaced through `qualifyTipId(plugin, …)` so it cannot escape the
  plugin's own namespace.

  **Welcome banner on the dashboard.** A `<TipBanner>` at the top of the
  dashboard introduces Checkstack's main flow ("add a system, then a health
  check") with a one-click jump into the catalog.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/anomaly-common@1.1.0
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/catalog-frontend@0.10.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/maintenance-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/queue-frontend@0.4.0
  - @checkstack/notification-frontend@0.4.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/command-common@0.2.11
  - @checkstack/command-frontend@0.2.35
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.6.1

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/catalog-frontend@0.9.1
  - @checkstack/command-common@0.2.10
  - @checkstack/common@0.8.0
  - @checkstack/maintenance-common@1.0.1
  - @checkstack/notification-frontend@0.3.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/anomaly-common@1.0.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/command-frontend@0.2.34
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/incident-common@1.0.1
  - @checkstack/notification-common@1.0.1
  - @checkstack/queue-frontend@0.3.3

## 0.6.0

### Minor Changes

- 32d52c6: feat: unified notification-subscription manager dialog driven by spec registry

  Replaces the bell-toggle UX (which only managed a single legacy
  catalog group) with a modal that lists every notification type
  registered against a target — system or group — and exposes both
  per-type toggles and a bulk "Subscribe to all / Unsubscribe from all"
  action. Both surfaces (system detail page header bell, dashboard group
  header bell) now open the same `NotificationSubscriptionsManager`
  component.

  **Key change vs. the prior slot-based approach**: rows are now driven
  by `notificationClient.listSubscriptionSpecs` — the backend's spec
  registry is the single source of truth. Previously, a row only
  appeared if a frontend plugin had remembered to register a
  `createNotificationSubscriptionExtension`; this caused silent drift
  (healthcheck and dependency registered backend specs without frontend
  extensions, so the dialog counted them but never rendered rows). Now,
  every spec the platform knows about renders a row using the spec's
  `display` metadata (title, description, iconName resolved via
  `DynamicIcon`).

  **Sub-controls registry** (`@checkstack/notification-frontend`):
  plugins that want sub-granularity (anomaly's per-field mute list,
  future severity / channel filters) call
  `registerSubscriptionSubControls(spec, Component)` at module load —
  the manager looks the component up by `specId` when expanding a row.

  **Removed (no compat)**:

  - `createNotificationSubscriptionExtension` (replaced by the
    spec-driven manager + the SubControls registry)
  - `target.slot` field on `NotificationTarget` and the
    `NotificationTargetInput.slot` parameter on
    `defineNotificationTarget`
  - `SystemNotificationSubscriptionsSlot` and
    `GroupNotificationSubscriptionsSlot` from `@checkstack/catalog-common`
  - `SystemNotificationsCard` from the system detail page's main column
  - `SubscribeButton` wiring on dashboard group cards and the system
    detail page header

  **Migrated frontends**: anomaly (now registers `AnomalyFieldMuteList`
  via the SubControls registry), incident, maintenance — all dropped
  their `createNotificationSubscriptionExtension` calls. healthcheck and
  dependency now show up automatically via the spec registry — no
  frontend changes needed for them to render.

  The trigger button reflects aggregate state — filled bell when at
  least one spec is subscribed for the resource, ghost bell when none.

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/anomaly-common@1.0.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/notification-frontend@0.3.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/catalog-frontend@0.9.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0
  - @checkstack/command-frontend@0.2.33
  - @checkstack/queue-frontend@0.3.2

## 0.5.1

### Patch Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

- Updated dependencies [208ad71]
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/anomaly-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/maintenance-common@0.5.0
  - @checkstack/notification-common@0.3.0
  - @checkstack/queue-frontend@0.3.1
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-frontend@0.8.7
  - @checkstack/command-frontend@0.2.32
  - @checkstack/ui@1.6.1

## 0.5.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/anomaly-common@0.2.0
  - @checkstack/common@0.7.0
  - @checkstack/queue-frontend@0.3.0
  - @checkstack/ui@1.6.0
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/catalog-common@1.5.2
  - @checkstack/catalog-frontend@0.8.6
  - @checkstack/command-common@0.2.9
  - @checkstack/command-frontend@0.2.31
  - @checkstack/frontend-api@0.3.11
  - @checkstack/incident-common@0.4.9
  - @checkstack/maintenance-common@0.4.11
  - @checkstack/notification-common@0.2.9
  - @checkstack/signal-frontend@0.0.16

## 0.4.6

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29
  - @checkstack/catalog-common@1.5.1
  - @checkstack/catalog-frontend@0.8.5
  - @checkstack/command-frontend@0.2.30
  - @checkstack/incident-common@0.4.8
  - @checkstack/maintenance-common@0.4.10
  - @checkstack/queue-frontend@0.2.31

## 0.4.5

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-frontend@0.8.4

## 0.4.4

### Patch Changes

- @checkstack/catalog-frontend@0.8.3

## 0.4.3

### Patch Changes

- Updated dependencies [019e659]
  - @checkstack/queue-frontend@0.2.30
  - @checkstack/auth-frontend@0.5.28
  - @checkstack/catalog-common@1.4.1
  - @checkstack/catalog-frontend@0.8.2

## 0.4.2

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27
  - @checkstack/catalog-frontend@0.8.1
  - @checkstack/command-frontend@0.2.29
  - @checkstack/queue-frontend@0.2.29

## 0.4.1

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/catalog-frontend@0.8.0

## 0.4.0

### Minor Changes

- bb1fea0: feat: implement active incident and maintenance overview sheets on dashboard

  - Replaces direct routing on status cards with slide-out overview sheets to gracefully degrade for users without manage permissions
  - Refactors dashboard system groups into a clean table-style list layout for better density
  - Makes global status cards more compact

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-frontend@0.7.0
  - @checkstack/auth-frontend@0.5.26
  - @checkstack/command-frontend@0.2.28
  - @checkstack/queue-frontend@0.2.28

## 0.3.35

### Patch Changes

- @checkstack/catalog-frontend@0.6.2

## 0.3.34

### Patch Changes

- @checkstack/catalog-frontend@0.6.1

## 0.3.33

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [4b0934d]
  - @checkstack/catalog-frontend@0.6.0
  - @checkstack/ui@1.3.6
  - @checkstack/auth-frontend@0.5.25
  - @checkstack/command-frontend@0.2.27
  - @checkstack/queue-frontend@0.2.27

## 0.3.32

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24
  - @checkstack/catalog-frontend@0.5.14
  - @checkstack/command-frontend@0.2.26
  - @checkstack/queue-frontend@0.2.26

## 0.3.31

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23
  - @checkstack/catalog-frontend@0.5.13
  - @checkstack/command-frontend@0.2.25
  - @checkstack/queue-frontend@0.2.25

## 0.3.30

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22
  - @checkstack/catalog-frontend@0.5.12
  - @checkstack/command-frontend@0.2.24
  - @checkstack/queue-frontend@0.2.24

## 0.3.29

### Patch Changes

- 0388000: Implemented a global performance-aware UI infrastructure that detects hardware capabilities (using heuristics and frame-budget benchmarks) to automatically disable expensive CSS animations, backdrop-blurs, and glassmorphism effects on low-power or non-hardware-accelerated devices.
- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/command-frontend@0.2.23
  - @checkstack/auth-frontend@0.5.21
  - @checkstack/catalog-frontend@0.5.11
  - @checkstack/queue-frontend@0.2.23

## 0.3.28

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20
  - @checkstack/catalog-frontend@0.5.10
  - @checkstack/command-frontend@0.2.22
  - @checkstack/queue-frontend@0.2.22

## 0.3.27

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/auth-frontend@0.5.19
  - @checkstack/catalog-frontend@0.5.9
  - @checkstack/command-frontend@0.2.21
  - @checkstack/queue-frontend@0.2.21

## 0.3.26

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/catalog-frontend@0.5.8
  - @checkstack/frontend-api@0.3.9
  - @checkstack/queue-frontend@0.2.20
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-common@0.2.8
  - @checkstack/command-frontend@0.2.20
  - @checkstack/incident-common@0.4.7
  - @checkstack/maintenance-common@0.4.9
  - @checkstack/notification-common@0.2.8
  - @checkstack/signal-frontend@0.0.15

## 0.3.25

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0

## 0.3.24

### Patch Changes

- 1f191cf: Add SYSTEM_STATUS_CHANGED signal and dependency-driven notification improvements

  **healthcheck-common:**

  - New `SYSTEM_STATUS_CHANGED` signal that fires only on system-level health status transitions (healthy ↔ degraded ↔ unhealthy), providing a low-noise alternative to `HEALTH_CHECK_RUN_COMPLETED` for coarse-grained reactivity

  **healthcheck-backend:**

  - Broadcast `SYSTEM_STATUS_CHANGED` signal at both status transition code paths in the queue executor

  **healthcheck-frontend:**

  - Switch `SystemHealthBadge` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` to reduce unnecessary refetch noise

  **dashboard-frontend:**

  - Switch `SystemBadgeDataProvider` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` for more efficient badge updates

  **maintenance-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

  **incident-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/catalog-common@1.3.0
  - @checkstack/catalog-frontend@0.5.7

## 0.3.23

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/catalog-frontend@0.5.6
  - @checkstack/command-frontend@0.2.19
  - @checkstack/queue-frontend@0.2.19

## 0.3.22

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16
  - @checkstack/catalog-frontend@0.5.5

## 0.3.21

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15
  - @checkstack/catalog-frontend@0.5.4
  - @checkstack/command-frontend@0.2.18
  - @checkstack/queue-frontend@0.2.18

## 0.3.20

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-common@1.2.11
  - @checkstack/catalog-frontend@0.5.3
  - @checkstack/command-frontend@0.2.17
  - @checkstack/queue-frontend@0.2.17

## 0.3.19

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-common@1.2.10
  - @checkstack/catalog-frontend@0.5.2
  - @checkstack/command-common@0.2.7
  - @checkstack/command-frontend@0.2.16
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/incident-common@0.4.6
  - @checkstack/maintenance-common@0.4.8
  - @checkstack/notification-common@0.2.7
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3
  - @checkstack/queue-frontend@0.2.16

## 0.3.18

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-common@1.2.9
  - @checkstack/catalog-frontend@0.5.1
  - @checkstack/command-frontend@0.2.15
  - @checkstack/incident-common@0.4.5
  - @checkstack/maintenance-common@0.4.7
  - @checkstack/queue-frontend@0.2.15
  - @checkstack/ui@1.1.2

## 0.3.17

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/catalog-frontend@0.5.0
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-common@0.2.6
  - @checkstack/command-frontend@0.2.14
  - @checkstack/frontend-api@0.3.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/incident-common@0.4.4
  - @checkstack/maintenance-common@0.4.6
  - @checkstack/notification-common@0.2.6
  - @checkstack/queue-frontend@0.2.14
  - @checkstack/signal-frontend@0.0.13

## 0.3.16

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10
  - @checkstack/catalog-frontend@0.4.2
  - @checkstack/command-frontend@0.2.13
  - @checkstack/queue-frontend@0.2.13

## 0.3.15

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/catalog-frontend@0.4.1
  - @checkstack/command-frontend@0.2.12
  - @checkstack/queue-frontend@0.2.12
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-common@0.2.5
  - @checkstack/frontend-api@0.3.5
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/incident-common@0.4.3
  - @checkstack/maintenance-common@0.4.5
  - @checkstack/notification-common@0.2.5
  - @checkstack/signal-frontend@0.0.12

## 0.3.14

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-frontend@0.4.0
  - @checkstack/catalog-common@1.2.6
  - @checkstack/ui@0.5.3
  - @checkstack/incident-common@0.4.2
  - @checkstack/maintenance-common@0.4.4
  - @checkstack/auth-frontend@0.5.8
  - @checkstack/command-frontend@0.2.11
  - @checkstack/queue-frontend@0.2.11

## 0.3.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-common@1.2.5
  - @checkstack/catalog-frontend@0.3.11
  - @checkstack/command-common@0.2.4
  - @checkstack/command-frontend@0.2.10
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/incident-common@0.4.1
  - @checkstack/maintenance-common@0.4.3
  - @checkstack/notification-common@0.2.4
  - @checkstack/queue-frontend@0.2.10
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.3.12

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.3.11

### Patch Changes

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0
  - @checkstack/ui@0.5.1
  - @checkstack/auth-frontend@0.5.6
  - @checkstack/catalog-frontend@0.3.10
  - @checkstack/command-frontend@0.2.9
  - @checkstack/queue-frontend@0.2.9

## 0.3.10

### Patch Changes

- Updated dependencies [11d2679]
- Updated dependencies [cce5453]
- Updated dependencies [223081d]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/incident-common@0.4.0
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/catalog-frontend@0.3.9
  - @checkstack/queue-frontend@0.2.8
  - @checkstack/command-frontend@0.2.8

## 0.3.9

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/catalog-frontend@0.3.8
  - @checkstack/command-common@0.2.3
  - @checkstack/command-frontend@0.2.7
  - @checkstack/frontend-api@0.3.3
  - @checkstack/incident-common@0.3.4
  - @checkstack/maintenance-common@0.4.2
  - @checkstack/notification-common@0.2.3
  - @checkstack/queue-frontend@0.2.7
  - @checkstack/signal-frontend@0.0.10

## 0.3.8

### Patch Changes

- 1f1f6c2: Fixed layout issue where multiple system status badges would push the system name out of view on dashboard cards
- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3
  - @checkstack/catalog-frontend@0.3.7
  - @checkstack/command-frontend@0.2.6
  - @checkstack/queue-frontend@0.2.6

## 0.3.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/incident-common@0.3.3
  - @checkstack/maintenance-common@0.4.1
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/catalog-frontend@0.3.6
  - @checkstack/command-common@0.2.2
  - @checkstack/command-frontend@0.2.5
  - @checkstack/frontend-api@0.3.2
  - @checkstack/notification-common@0.2.2
  - @checkstack/queue-frontend@0.2.5
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.3.6

### Patch Changes

- Updated dependencies [18fa8e3]
  - @checkstack/maintenance-common@0.4.0

## 0.3.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/catalog-frontend@0.3.5
  - @checkstack/command-frontend@0.2.4
  - @checkstack/queue-frontend@0.2.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/command-common@0.2.1
  - @checkstack/frontend-api@0.3.1
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/incident-common@0.3.2
  - @checkstack/maintenance-common@0.3.2
  - @checkstack/notification-common@0.2.1
  - @checkstack/signal-frontend@0.0.8

## 0.3.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/catalog-frontend@0.3.4
  - @checkstack/command-frontend@0.2.3
  - @checkstack/queue-frontend@0.2.3

## 0.3.3

### Patch Changes

- cad3073: Fixed notification group subscription for catalog groups:
  - Fixed group ID format using colon separator instead of dots and missing entity type prefix
  - Fixed subscription button state not updating after subscribe/unsubscribe by using refetch instead of invalidateQueries

## 0.3.2

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/catalog-frontend@0.3.3
  - @checkstack/command-frontend@0.2.2
  - @checkstack/queue-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/catalog-frontend@0.3.2

## 0.3.0

### Minor Changes

- 4eed42d: Fix "No QueryClient set" error in containerized builds

  **Problem**: The containerized application was throwing "No QueryClient set, use QueryClientProvider to set one" errors during plugin registration. This didn't happen in dev mode.

  **Root Cause**: The `@tanstack/react-query` package was being bundled separately in different workspace packages, causing multiple React Query contexts. The `QueryClientProvider` from the main app wasn't visible to plugin code due to this module duplication.

  **Changes**:

  - `@checkstack/frontend-api`: Export `useQueryClient` from the centralized React Query import, ensuring all packages use the same context
  - `@checkstack/dashboard-frontend`: Import `useQueryClient` from `@checkstack/frontend-api` instead of directly from `@tanstack/react-query`, and remove the direct dependency
  - `@checkstack/frontend`: Add `@tanstack/react-query` to Vite's `resolve.dedupe` as a safety net

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/catalog-frontend@0.3.1
  - @checkstack/command-frontend@0.2.1
  - @checkstack/incident-common@0.3.1
  - @checkstack/maintenance-common@0.3.1
  - @checkstack/queue-frontend@0.2.1
  - @checkstack/ui@0.2.2

## 0.2.0

### Minor Changes

- 180be38: # Queue Lag Warning

  Added a queue lag warning system that displays alerts when pending jobs exceed configurable thresholds.

  ## Features

  - **Backend Stats API**: New `getStats`, `getLagStatus`, and `updateLagThresholds` RPC endpoints
  - **Signal-based Updates**: `QUEUE_LAG_CHANGED` signal for real-time frontend updates
  - **Aggregated Stats**: `QueueManager.getAggregatedStats()` sums stats across all queues
  - **Configurable Thresholds**: Warning (default 100) and Critical (default 500) thresholds stored in config
  - **Dashboard Integration**: Queue lag alert displayed on main Dashboard (access-gated)
  - **Queue Settings Page**: Lag alert and Performance Tuning guidance card with concurrency tips

  ## UI Changes

  - Queue lag alert banner appears on Dashboard and Queue Settings when pending jobs exceed thresholds
  - New "Performance Tuning" card with concurrency settings guidance and bottleneck indicators

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-frontend@0.2.0
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/command-frontend@0.2.0
  - @checkstack/command-common@0.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/incident-common@0.3.0
  - @checkstack/maintenance-common@0.3.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.1.1

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/catalog-frontend@0.2.0
  - @checkstack/command-common@0.1.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/incident-common@0.2.0
  - @checkstack/maintenance-common@0.2.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.1.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

### Patch Changes

- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/ui@0.1.0
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/command-frontend@0.0.5
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/command-common@0.0.4
  - @checkstack/frontend-api@0.0.4
  - @checkstack/notification-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-frontend@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/command-common@0.0.3
  - @checkstack/command-frontend@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/maintenance-common@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/maintenance-common@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.0

### Minor Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/command-common@0.0.3
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/incident-common@0.1.2
  - @checkstack/maintenance-common@0.1.2
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1
  - @checkstack/catalog-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/catalog-common@0.1.1
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3
  - @checkstack/incident-common@0.1.1
  - @checkstack/maintenance-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/frontend-api@0.0.2
