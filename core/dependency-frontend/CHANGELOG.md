# @checkstack/dependency-frontend

## 0.9.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/dashboard-frontend@0.12.1
  - @checkstack/gitops-frontend@0.8.1
  - @checkstack/catalog-common@2.8.3
  - @checkstack/dependency-common@1.7.9
  - @checkstack/healthcheck-common@1.19.2

## 0.9.0

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
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/dashboard-frontend@0.12.0
  - @checkstack/gitops-frontend@0.8.0
  - @checkstack/catalog-common@2.8.2
  - @checkstack/dependency-common@1.7.8
  - @checkstack/gitops-common@0.7.5
  - @checkstack/signal-frontend@0.3.8

## 0.8.10

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

- be74b01: Consolidate eight status pills into one

  `StatusPill` moves into `@checkstack/ui`. It replaces six near-identical local
  components (announcements, incidents, maintenance, health checks, notifications,
  script packages) and three hand-rolled inline chips (the public status page's
  event card and event detail page, the announcements status widget). They
  differed only in whether they took `label` or `children`, whether they forwarded
  `className`, and whether they set `shrink-0` - they agreed on everything that
  mattered, which is why they collapse cleanly.

  The shared pill absorbs the variations rather than flattening them:

  - `tone="neutral"` for a state that deliberately carries no hue, read from its
    label alone. This was hand-rolled in three places after the "at most one
    coloured dimension per row" rule landed. It drops the dot, since with no hue
    to encode a grey dot adds nothing.
  - `size="sm"` for dense contexts - a public event card, a widget list - which
    previously meant inline `text-[11px]` chips.
  - `shrink-0` is now unconditional: a pill squashed by a greedy sibling is
    unreadable, and its text is the accessible encoding of the status.

  Domain plugins keep their thin wrappers (`HealthStatusPill`,
  `getIncidentSeverityBadge`, ...) because mapping a domain value to a tone and a
  label IS domain knowledge - only the chip moved.

  Also removes two related duplications found in the same sweep: the dependency
  plugin hand-wrote the pill's classes inline in a `getImpactBadge` switch
  duplicated across its alert banner and its editor (now one `ImpactBadge`
  component over the tone mapping its own logic module already owned), and its
  private tone table now sources the triad from the shared one.

  `status-page-frontend`'s local `StatusPill` is renamed `PublicStatusPill`: it is
  keyed by the public status enum and draws from that enum's own visual tokens, so
  it is a genuinely different component and the name now says so.

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
  - @checkstack/ui@1.30.0
  - @checkstack/dashboard-frontend@0.11.2
  - @checkstack/gitops-frontend@0.7.9
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/catalog-common@2.8.1
  - @checkstack/dependency-common@1.7.7

## 0.8.9

### Patch Changes

- @checkstack/dashboard-frontend@0.11.1

## 0.8.8

### Patch Changes

- 6c8b36b: The Logs, Metrics, and Traces cards on the system overview page now match the
  other cards. They had drifted to a flat `bg-card` background with a
  hairline-only shadow, so they rendered visibly flatter than their siblings
  (health, dependency, SLO, incident, anomaly, maintenance), which all use the
  detail-page gradient plus a soft two-layer elevation shadow.

  The shared card surface is now a single primitive - `DetailCard` (and the
  `detailCardSurface` / `detailCardSurfaceFlat` class constants) in
  `@checkstack/ui` - instead of a className that was copy-pasted (and could
  diverge) in every system-overview card. All of those cards now render from the
  one primitive, so they cannot drift apart again. A new `error`-level ESLint
  rule `checkstack/no-inline-detail-card-chrome` fails the build if a card in that
  family re-declares the surface inline instead of using `DetailCard`.

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
  - @checkstack/ui@1.29.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/dashboard-frontend@0.11.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/gitops-frontend@0.7.8
  - @checkstack/common@0.23.0
  - @checkstack/dependency-common@1.7.6
  - @checkstack/gitops-common@0.7.4
  - @checkstack/signal-frontend@0.3.7

## 0.8.7

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/dashboard-frontend@0.10.11
  - @checkstack/gitops-frontend@0.7.7
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/dependency-common@1.7.5
  - @checkstack/frontend-api@0.16.0
  - @checkstack/gitops-common@0.7.3
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/signal-frontend@0.3.6

## 0.8.6

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/dashboard-frontend@0.10.10
  - @checkstack/gitops-frontend@0.7.6

## 0.8.5

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
  - @checkstack/catalog-common@2.7.3
  - @checkstack/dashboard-frontend@0.10.9
  - @checkstack/gitops-frontend@0.7.5
  - @checkstack/common@0.22.0
  - @checkstack/dependency-common@1.7.5
  - @checkstack/gitops-common@0.7.3
  - @checkstack/signal-frontend@0.3.6

## 0.8.4

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/dashboard-frontend@0.10.8
  - @checkstack/gitops-frontend@0.7.4
  - @checkstack/catalog-common@2.7.2
  - @checkstack/dependency-common@1.7.4
  - @checkstack/healthcheck-common@1.16.2

## 0.8.3

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/dashboard-frontend@0.10.7
  - @checkstack/gitops-frontend@0.7.3
  - @checkstack/catalog-common@2.7.1
  - @checkstack/dependency-common@1.7.3
  - @checkstack/healthcheck-common@1.16.1

## 0.8.2

### Patch Changes

- 43e4484: Eliminate the catalog browse view's per-row dependency-warning N+1.

  The per-system `DependencyBadge` previously fetched its own `getWarningsForSystem` RPC on every catalog browse row, so a catalog with N systems issued O(N) dependency-warning requests on open.

  dependency-frontend now fills catalog's `CatalogBrowseDataBoundarySlot` with `CatalogBrowseDependencyDataFiller`, which wraps the whole browse tree in a `DependencyBadgeDataProvider` that bulk-fetches warnings for every visible system via `getWarnings` and exposes them through context. When that provider is mounted, `DependencyBadge` reads its warning from context and disables its own per-system query. This is behavior-preserving and frontend-only: the bulk record's per-system entry is equivalent to the singular endpoint's result (both derive from the same warning evaluation), so a system with a warning renders identically and a system without one renders nothing. On surfaces with no filler (e.g. the system detail page) the fallback per-system query still runs exactly as before.

- 43e4484: Clarify the dependency impact chips on the system overview so they read as an
  impact classification, not a live status.

  The Dependencies panel showed a red "Critical" / amber "Degraded" pill next to
  each neighbour, which - beside the live health dot and using the same status
  colours - looked like the dependency was down or degraded right now. It actually
  describes what the edge does to the system if the neighbour fails.

  The chip now:

  - Drops the status (red/amber) palette entirely - impact is a static edge
    attribute, so it uses a neutral chip ranked by emphasis, and the row's health
    dot stays the only colour-coded live signal.
  - Uses impact-framed labels ("Critical impact", "Degrading impact",
    "Informational") instead of the bare status words.
  - Leads with an impact icon (lightning / info) instead of a status dot.
  - Carries a direction-aware tooltip spelling out the exact consequence with both
    system names, e.g. "Critical dependency. If Payments goes down, Checkout is
    treated as down." for an upstream edge, and the reverse for a "depended on by"
    edge.

  The wording lives in a new pure `presentDependencyImpact` helper with unit tests.
  No behavior, API, or data changes.

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
  - @checkstack/dashboard-frontend@0.10.6
  - @checkstack/catalog-common@2.7.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/dependency-common@1.7.2
  - @checkstack/gitops-frontend@0.7.2

## 0.8.1

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/dashboard-frontend@0.10.5
  - @checkstack/dependency-common@1.7.1
  - @checkstack/gitops-common@0.7.3
  - @checkstack/gitops-frontend@0.7.1
  - @checkstack/signal-frontend@0.3.5

## 0.8.0

### Minor Changes

- fc64fad: Dependency map layout is now dependency-aware, and system detail pages gain a
  read-only up/downstream dependency panel.

  The map's automatic layout replaces the old square grid with a layered
  (Sugiyama-style) arrangement: upstream systems are placed to the right of the
  systems that depend on them, columns are ordered to minimise edge crossings, and
  systems with no dependencies are parked off to the side so they never tangle
  with the wired graph. Saved positions are still honoured verbatim - only
  unplaced boxes are arranged, and when some boxes are already positioned the new
  ones drop into a tidy block in the free space below them rather than overlapping
  your existing layout.

  Two new toolbar controls build on this:

  - **Center on box** - select a system, then rebuild the layout around it, with
    everything it depends on fanning out to one side and everything that depends
    on it to the other. Handy when you only care about one central system.
  - **Reset layout** - re-arrange every box with the automatic layered layout,
    overriding saved positions.

  System detail pages now show a **Dependencies** panel listing what the system
  depends on (upstream) and what depends on it (downstream), each neighbour
  linking to its own detail page with a live health dot and the edge's impact
  severity. The panel is visible to anyone allowed to read the system's
  dependencies: holders of the global dependency-map rule, or users who can manage
  the system via a team grant - mirroring how map edge editing is gated.

- fc64fad: Dependencies can now be scoped to a specific environment and/or health check of
  the upstream system, each with its own severity - a "matrix" of scope cells.

  Previously a dependency watched the upstream's overall health (any check, any
  environment) at the edge's impact type, with optional per-check rules. That
  default is unchanged: with no scope cells configured, the dependency behaves
  exactly as before. Now each cell pins a check (a specific configuration, or
  "any"), an environment (a specific environment, or "any"), and a severity
  (informational / degraded / critical). When a dependency has any cells, only
  those slices are watched (they replace the whole-system watch) and the worst
  result across cells wins. This lets you express, e.g., "System A depends on
  System B only in `prod`", or "only when B's TLS check in `prod` fails", and lets
  different cells carry different severities.

  Because each environment is evaluated on its own slice, a scoped dependency
  catches an environment-specific outage that the upstream's overall status
  (worst-wins across environments) would otherwise hide. The dependency evaluator
  now reads per-(check, environment) health via a new
  `@checkstack/healthcheck-common` bulk contract `getBulkSystemHealthMatrix` (and
  its `@checkstack/healthcheck-backend` implementation), which returns each
  system's cross-environment rollup plus a per-environment slice. Incident
  overrides still fold into the overall rollup, so incident-forced statuses keep
  propagating through dependencies.

  The scope-cell store gains a nullable `environment_id` column and makes
  `health_check_id` nullable (forward-only migration; existing rows keep working
  as "any check, any environment"). The dependency editor's per-check panel
  becomes a scope-matrix editor with check + environment + severity rows.

  Transitive (multi-hop) dependencies still cascade using the upstream's overall
  status; per-environment cascades across multiple hops are not yet propagated.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/dependency-common@1.7.0
  - @checkstack/gitops-frontend@0.7.0
  - @checkstack/ui@1.25.0
  - @checkstack/dashboard-frontend@0.10.4

## 0.7.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/dashboard-frontend@0.10.3
  - @checkstack/gitops-frontend@0.6.8
  - @checkstack/catalog-common@2.6.2
  - @checkstack/dependency-common@1.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/gitops-common@0.7.2
  - @checkstack/signal-frontend@0.3.4

## 0.7.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/ui@1.23.0
  - @checkstack/gitops-common@0.7.1
  - @checkstack/catalog-common@2.6.1
  - @checkstack/dashboard-frontend@0.10.2
  - @checkstack/dependency-common@1.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/gitops-frontend@0.6.7
  - @checkstack/signal-frontend@0.3.3

## 0.7.1

### Patch Changes

- 0cac684: Fix dependency-map edges being invisible to users without manage access on the
  systems. React Flow silently drops every edge whose source node has no source
  handle, and the source handle was only rendered for systems the user may MANAGE
  (the drag-to-connect gate from the RLAC frontend-gating change) - so a read-only
  viewer with `dependency.dependency.read` + `dependency.map.read` saw all the
  system nodes but zero edges. The source handle is now always rendered; manage
  access gates only its connectability (`isConnectable` / `isConnectableStart`),
  with the muted styling and explanatory tooltip kept for unmanaged systems.
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/dependency-common@1.6.0
  - @checkstack/gitops-common@0.7.0
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/gitops-frontend@0.6.6
  - @checkstack/dashboard-frontend@0.10.1

## 0.7.0

### Minor Changes

- 19d7afd: Color the whole dependency-map edge by its impact type, not just the arrowhead.
  Previously the arrowhead was filled with the impact hex color but the edge line
  was colored via a Tailwind `stroke-*` class on React Flow's `BaseEdge`, which
  lost to `@xyflow/react`'s default `.react-flow__edge-path` stroke rule at equal
  CSS specificity (the selected state needed a `!stroke-primary` override to win).
  That made the line's impact ambiguous when several edges fed one system's input.

  The edge stroke, its opacity, and the arrowhead marker now come from one pure
  `edgeImpactStyle` mapping applied inline, so the whole edge reads a single impact
  color (sky/amber/red) end-to-end and matches the legend, with a selected edge
  turning the whole line the primary color. No animation was added, so no
  performance (`isLowPower`) branch is needed.

- 0d912a3: Make the frontend fully RLAC-aware so team-scoped users see and can use exactly
  what the backend already authorises - no more, no less. Previously every nav
  entry, route, management page, create button, per-row action, and resource
  picker gated purely on a user's GLOBAL access rule, so a user whose team manages
  a system saw none of the surfaces the backend would happily let them use, and
  (where a page did render) could select systems they don't manage and only fail
  after submit.

  Platform primitives (on `AccessApi`, from `@checkstack/frontend-api`, implemented
  in `@checkstack/auth-frontend`). Each ORs the global RBAC rule with team-derived
  (ReBAC) grants, so a global-rule holder always sees everything:

  - `useCanCreate({ accessRule, objectType, parentType? })` - may the user create
    this type (global rule, a team `creator` grant, or managing a parent resource).
  - `useCanAccessType({ accessRule, objectType, parentType? })` - may the user
    reach a management SURFACE for this type at all (create capability OR managing
    any existing object of the type / its parent). Powers route guards, sidebar
    entries, and a management page's top-level `allowed`.
  - `useResourceAccess({ accessRule, objectType, resourceIds })` - a `canAccess(id)`
    predicate for per-row controls and for filtering resource pickers.

  Backed by three authenticated `auth` RPC procedures - `canCreate`,
  `myManageableTypes`, and `listMyAccessibleResources` - the frontend-facing
  mirrors of the existing S2S authorization endpoints, resolved against the
  caller's own team grants.

  Route/nav gating is now capability-aware: a route may declare
  `manageCapability: { objectType, parentType? }`; the route guard and sidebar then
  show/allow it for team-scoped users via `myManageableTypes`. Applied to the
  catalog, incident, maintenance, SLO, healthcheck, automation, and status-page
  management routes. The route guard resolves this through a single
  `useRouteAccess` hook with a constant hook count, since the guard is reconciled
  in place as the URL changes (a conditional hook there would trip the rules of
  hooks).

  Resource types are now typed, plugin-qualified constants. A new
  `resourceType(pluginMetadata, localType)` factory in `@checkstack/common` mints a
  nominal `ResourceType`, and each `*-common` package exports its constants (e.g.
  `catalogResourceTypes.system`, `incidentResourceTypes.incident`). The capability
  APIs accept `ResourceType`, so a mistyped `"catalog.system"` string now fails
  typecheck instead of silently breaking a gate.

  Resource pickers now offer only what the backend will accept:

  - Incident and maintenance "Affected Systems" pickers show only systems the user
    manages (or all with the global rule), matching the backend's requirement of
    MANAGE on every referenced system.
  - SLO creation is now system-scoped end to end: `createObjective` gains a
    `catalog.system` parent gate (managing the target system authorises creating an
    SLO for it, like incident/maintenance), and the SLO editor's system picker is
    filtered to manageable systems.
  - Catalog group and environment membership (add-to-group / add-to-environment,
    per-row and bulk) is gated on managing the system being (re)assigned.
  - The health-check assignment surface (Assignment IDE + the system-detail
    "Health Checks" action) requires MANAGE on the target system.

  Catalog membership chips only render a removable "x" for systems the user
  manages (removing a group/environment membership requires managing the system),
  and the Dependency Map only lets a user originate an edge from a system they
  manage (the source is access-checked; the target is not).

  Owning-team correctness: a parent-gated creator (team member, no global rule)
  who left the owning team unset previously created an object with no team grant -
  which they then could not edit. The `authorizeCreate` parent-gate path now
  resolves an owning team instead of silently orphaning the object (auto-assigns
  when the caller belongs to exactly one team, requires an explicit choice when
  several), and the `TeamOwnershipPicker` marks the field required and
  auto-selects the sole eligible team.

  Dependency writes are fixed to authorize on the SOURCE system. `createDependency`
  / `updateDependency` / `deleteDependency` previously used `instanceAccess:
{ idParam: "systemId" }`, which made the middleware look for a `dependency` grant
  keyed by the system id - a grant that never exists - so every team-scoped source
  manager was denied ("Access denied to resource dependency:<systemId>"). They now
  `parentScope` on `catalog.system` manage, so managing the source system
  authorises editing its dependencies (the target is not access-checked), matching
  health-check assignment.

  The backend authorization changes are limited to: the new read-only capability
  procedures (`canCreate` / `myManageableTypes` / `listMyAccessibleResources`), the
  SLO create parent gate, the `authorizeCreate` owning-team resolution, and the
  dependency source-scope fix. Everything else only aligns the UI with
  authorization the backend already enforced.

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/dashboard-frontend@0.10.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/dependency-common@1.5.0
  - @checkstack/gitops-frontend@0.6.5
  - @checkstack/gitops-common@0.6.8
  - @checkstack/signal-frontend@0.3.2

## 0.6.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/dashboard-frontend@0.9.4
  - @checkstack/gitops-frontend@0.6.4

## 0.6.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/ui@1.20.0
  - @checkstack/dashboard-frontend@0.9.3
  - @checkstack/dependency-common@1.4.4
  - @checkstack/frontend-api@0.12.1
  - @checkstack/gitops-common@0.6.7
  - @checkstack/gitops-frontend@0.6.3
  - @checkstack/signal-frontend@0.3.1

## 0.6.2

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
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/dashboard-frontend@0.9.2
  - @checkstack/dependency-common@1.4.3
  - @checkstack/gitops-common@0.6.6
  - @checkstack/gitops-frontend@0.6.2
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/common@0.17.0

## 0.6.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/dashboard-frontend@0.9.1
  - @checkstack/gitops-frontend@0.6.1

## 0.6.0

### Minor Changes

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

### Patch Changes

- 8cad340: Improve form quality and accessibility of the dependency editor.

  The "Depends on (upstream)" system picker and the impact-type select are now
  associated with proper `<Label htmlFor>`/`id` pairings, so clicking a label
  focuses its control and assistive tech announces the field name. Both mandatory
  fields carry the `required` affordance (visible `*` plus screen-reader
  "(required)"). Opening the add-dependency panel now autofocuses the system
  picker so keyboard users can start selecting immediately. No behavioral change
  beyond focus, labeling, and the required marker.

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

- 8cad340: Make the dependency map overlay panels responsive on small screens. The edge
  editor and legend panels now cap their width to the viewport
  (`w-[calc(100vw-2rem)] sm:w-72` / `max-w-[calc(100vw-2rem)] sm:max-w-64`) and the
  top-right action buttons wrap instead of overflowing, so the chrome no longer
  covers the canvas on phones. No behavior change on desktop.
- 8cad340: Adopt the canonical `toastError` helper from `@checkstack/ui` for error toasts.

  Error toasts that previously called `toast.error(extractErrorMessage(error, "Failed to X"))`
  (or interpolated `Failed to X: ${extractErrorMessage(error)}` strings) now use
  `toastError(toast, "Failed to X", error)`. This centralizes the
  "Failed to <action>: <message>" voice and applies the shared 100-character
  truncation. Error toasts that did not previously prefix the action now gain the
  canonical prefix; success toasts and terse validation one-liners are unchanged.

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
  - @checkstack/dashboard-frontend@0.9.0
  - @checkstack/gitops-frontend@0.6.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/dependency-common@1.4.2
  - @checkstack/gitops-common@0.6.5
  - @checkstack/signal-frontend@0.2.6

## 0.5.12

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1
  - @checkstack/dashboard-frontend@0.8.11
  - @checkstack/dependency-common@1.4.1
  - @checkstack/gitops-frontend@0.5.9
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/ui@1.16.2

## 0.5.11

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/dependency-common@1.4.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/dashboard-frontend@0.8.10
  - @checkstack/gitops-common@0.6.4
  - @checkstack/gitops-frontend@0.5.8
  - @checkstack/signal-frontend@0.2.5

## 0.5.10

### Patch Changes

- @checkstack/dashboard-frontend@0.8.9

## 0.5.9

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/dashboard-frontend@0.8.8
  - @checkstack/gitops-frontend@0.5.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/dependency-common@1.3.2
  - @checkstack/healthcheck-common@1.6.2

## 0.5.8

### Patch Changes

- @checkstack/catalog-common@2.3.5
- @checkstack/dashboard-frontend@0.8.7
- @checkstack/dependency-common@1.3.1
- @checkstack/healthcheck-common@1.6.1
- @checkstack/gitops-frontend@0.5.6

## 0.5.7

### Patch Changes

- 0b6f01b: feat(dependency): contribute dependency warnings to the backend system.issues aggregator

  The dependency plugin now registers a `system.issues` contributor (sourceId
  `dependency`) from its backend `init`, so the AI assistant surfaces upstream
  dependency problems alongside incidents, SLOs, health checks, and anomalies.

  The contributor enforces its own `dependency.read` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users are
  trusted), then evaluates dependency warnings for every system that participates
  in a dependency edge by reading the shared, durable `dependencies` table. The
  answer is therefore identical on every pod. Only systems with an actual warning
  appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveDependencySignals` deriver in
  `@checkstack/dependency-common`, shared by both the backend contributor and the
  frontend `DependencySignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/dependency-common@1.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/dashboard-frontend@0.8.6

## 0.5.6

### Patch Changes

- f9cfdae: fix(dependency): gate the dependency map behind its own non-public access rule

  Anonymous users could see the "Dependency Map" nav entry and open the page
  (which then rendered empty) because the map was gated by `dependency.read`,
  which is public so that dependency _warning_ badges stay visible on the
  catalog and dashboard.

  The full topology map is now gated by a dedicated `dependency.map` access
  rule that is granted to authenticated users by default but is NOT public, so
  anonymous visitors no longer see the nav entry or reach the page. The
  `getAllDependencies`, `getNodePositions`, and `saveNodePositions` endpoints
  move to this rule too, and the dashboard dependency signal now renders as
  plain text (not a map link) for users without map access. Per-system
  dependency warnings stay on the public `dependency.read` rule, so warning
  badges/alerts/signals remain visible to everyone as before.

  Admins can still grant `dependency.map` to the anonymous role to make the
  map public again.

  Note: the default-rule sync is add-only, so on existing deployments the
  anonymous role keeps any rules already granted. Since `dependency.map` is a
  brand-new rule the anonymous role never had it, so the map is hidden from
  anonymous users immediately after upgrade with no admin action required.

- Updated dependencies [f9cfdae]
  - @checkstack/dependency-common@1.2.5

## 0.5.5

### Patch Changes

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

- Updated dependencies [460ffd6]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/dashboard-frontend@0.8.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/dependency-common@1.2.4
  - @checkstack/gitops-common@0.6.3
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/gitops-frontend@0.5.5
  - @checkstack/signal-frontend@0.2.4

## 0.5.4

### Patch Changes

- 50123c7: Fix the dependency map page's scrolling and make its header consistent with the
  rest of the app. The page sized its canvas with a fixed `calc(100vh - 12rem)`,
  which could overshoot the available space (double-scroll) depending on viewport
  chrome, and it used a bespoke `<h1>` header with no icon. It now renders through
  `PageLayout` (with the `GitBranch` nav icon and `fillHeight`), so the React Flow
  canvas fills the app shell's bounded flex content area and only it scrolls/pans -
  the page itself never scrolls.
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
  - @checkstack/dashboard-frontend@0.8.4
  - @checkstack/gitops-frontend@0.5.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/dependency-common@1.2.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.3

## 0.5.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/dashboard-frontend@0.8.3
  - @checkstack/gitops-frontend@0.5.3
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/dependency-common@1.2.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/dashboard-frontend@0.8.2
  - @checkstack/dependency-common@1.2.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/gitops-frontend@0.5.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/catalog-common@2.3.1
  - @checkstack/dashboard-frontend@0.8.1
  - @checkstack/dependency-common@1.2.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/gitops-frontend@0.5.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.5.0

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

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

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
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/dashboard-frontend@0.8.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/gitops-frontend@0.5.0
  - @checkstack/dependency-common@1.2.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/signal-frontend@0.2.0

## 0.4.8

### Patch Changes

- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
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
  - @checkstack/ui@1.12.0
  - @checkstack/gitops-common@0.5.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/dashboard-frontend@0.7.8
  - @checkstack/gitops-frontend@0.4.7

## 0.4.7

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
  - @checkstack/catalog-common@2.2.3
  - @checkstack/dashboard-frontend@0.7.7
  - @checkstack/dependency-common@1.1.3
  - @checkstack/gitops-frontend@0.4.6
  - @checkstack/gitops-common@0.4.2
  - @checkstack/signal-frontend@0.1.5

## 0.4.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/dashboard-frontend@0.7.6

## 0.4.5

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
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/dashboard-frontend@0.7.5
  - @checkstack/gitops-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/dependency-common@1.1.2
  - @checkstack/gitops-common@0.4.1
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-frontend@0.1.4

## 0.4.4

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dashboard-frontend@0.7.4
  - @checkstack/dependency-common@1.1.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/gitops-frontend@0.4.4

## 0.4.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/dashboard-frontend@0.7.3
  - @checkstack/gitops-frontend@0.4.3

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/dashboard-frontend@0.7.2
  - @checkstack/gitops-frontend@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/dependency-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/dashboard-frontend@0.7.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/gitops-frontend@0.4.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.4.0

### Minor Changes

- f6f9a5c: Add a GitOps `System.dependencies` extension and lock the matching UI.

  Each entry references an upstream system by ref and tunes the impact:

  ```yaml
  apiVersion: checkstack.io/v1alpha1
  kind: System
  metadata: { name: payments-api }
  spec:
    dependencies:
      - targetRef: { kind: System, name: payments-db }
        impactType: critical
        transitive: false
        label: "primary store"
  ```

  The reconciler diffs the YAML-declared edges against the persisted ones
  where this system is the source and converges via
  create / update / delete. GitOps is the source of truth, so any edges
  no longer listed are removed. Refs that resolve to the source system
  itself are rejected; refs that fail to resolve abort the diff before
  any mutation.

  UI gates:

  - The `DependencyEditor` (system editor drawer) hides Add and disables
    Edit/Delete on upstream rows when the source system is GitOps-managed.
    Downstream rows are gated per-row by the _other_ system's lock.
  - The `DependencyMap` blocks `onConnect` when the source is locked,
    surfaces a "Managed by GitOps" notice in the edge editor panel, and
    disables Save/Delete there.

### Patch Changes

- 950d6ec: Fix mobile UserMenu items rendering at zero height, group menu items by
  section, and unstack cramped card headers on small viewports.

  - **UserMenu mobile bug**: On mobile, the user-menu Sheet rendered every
    menu item as a grid row, which combined with `flex-shrink: 1` on each
    item collapsed the buttons whose internal layout uses `display: flex`
    (the items registered with `useNavigate` rather than `<Link>`) to zero
    content height. Switched the mobile container to a flex column with
    `[&>*]:shrink-0` and added `min-h-0` so the sheet scrolls correctly
    when the list overflows.

  - **UserMenu grouping**: Slot extensions now accept an optional `group`
    field. The user menu buckets `UserMenuItemsSlot` extensions by `group`
    and renders each group under a labeled header (`Workspace`,
    `Reliability`, `Configuration`, `Documentation`, `Account`). Existing
    core plugins are tagged with the appropriate group; third-party plugins
    can pick any of these or supply their own label. Untagged extensions
    render last with no header. `UserMenuItemsBottomSlot` is unaffected.

  - **Card header responsiveness**: `CardHeaderRow` (the primitive shared by
    Incident, Maintenance, Auth, Catalog, GitOps and other config cards) now
    stacks vertically on narrow viewports and only switches to a single row
    at the `sm` breakpoint, so titles and adjacent filter controls (e.g.
    status `Select`, "Show resolved" checkbox) no longer cram together on
    mobile. Refactored the Incident and Maintenance config pages to use the
    primitive instead of a hand-rolled `flex items-center justify-between`
    row, and made their `Select` triggers full-width on mobile.

- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-frontend@0.4.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/dashboard-frontend@0.7.0
  - @checkstack/dependency-common@1.0.2
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.3.5

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/dashboard-frontend@0.6.1
  - @checkstack/dependency-common@1.0.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1

## 0.3.4

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/dashboard-frontend@0.6.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/ui@1.7.0

## 0.3.3

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
  - @checkstack/dependency-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/dashboard-frontend@0.5.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/ui@1.6.1

## 0.3.2

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/dashboard-frontend@0.5.0
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/dependency-common@0.2.3
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-frontend@0.0.16

## 0.3.1

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/dashboard-frontend@0.4.6
  - @checkstack/ui@1.5.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2

## 0.3.0

### Minor Changes

- 35463ef: Improve dependency map directional clarity

  - Redesigned system nodes with a split footer bar showing directional dependency counts (`← N used by | depends N →`), making each node self-documenting
  - Color-coded connection handles: teal for incoming ("used by") and violet for outgoing ("depends on")
  - Fixed invisible edge arrows by implementing custom SVG marker definitions with impact-type-matched colors (sky for informational, amber for degraded, red for critical)
  - Updated the legend panel to explain handle colors alongside the existing impact type guide

## 0.2.18

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/dashboard-frontend@0.4.5

## 0.2.17

### Patch Changes

- @checkstack/dashboard-frontend@0.4.4

## 0.2.16

### Patch Changes

- a7b7081: Fixed a race condition in the Dependency Map where an auto-layout calculation could permanently override saved user locations when system data loaded faster than position data.
  - @checkstack/dashboard-frontend@0.4.3
  - @checkstack/catalog-common@1.4.1

## 0.2.15

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/dashboard-frontend@0.4.2

## 0.2.14

### Patch Changes

- @checkstack/dashboard-frontend@0.4.1

## 0.2.13

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/dashboard-frontend@0.4.0
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0

## 0.2.12

### Patch Changes

- @checkstack/dashboard-frontend@0.3.35

## 0.2.11

### Patch Changes

- @checkstack/dashboard-frontend@0.3.34

## 0.2.10

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/dashboard-frontend@0.3.33

## 0.2.9

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/dashboard-frontend@0.3.32

## 0.2.8

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/dashboard-frontend@0.3.31

## 0.2.7

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/dashboard-frontend@0.3.30

## 0.2.6

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29

## 0.2.5

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/dashboard-frontend@0.3.28

## 0.2.4

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/dashboard-frontend@0.3.27

## 0.2.3

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
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/dependency-common@0.2.1
  - @checkstack/signal-frontend@0.0.15

## 0.2.2

### Patch Changes

- c0935d8: Fix dependency map node positions resetting when connecting two nodes. The graph-building effect was rebuilding all nodes from scratch on every data change, discarding unsaved drag positions. Node and edge construction are now split into separate effects with a clear position resolution priority: in-memory positions → saved positions → auto-layout fallback for new systems only.
  - @checkstack/catalog-common@1.3.0
  - @checkstack/common@0.6.4
  - @checkstack/dashboard-frontend@0.3.25
  - @checkstack/dependency-common@0.2.0
  - @checkstack/frontend-api@0.3.8
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/dashboard-frontend@0.3.25

## 0.2.0

### Minor Changes

- 3f36a64: Add System Dependencies plugin

  Introduces the system dependencies feature with three new core plugins and
  extends the catalog with a new SystemEditorSlot extension point.

  **New plugins:**

  - **dependency-common**: Shared Zod schemas, RPC contract with resource-level access control, signal definitions, and routes
  - **dependency-backend**: Drizzle schema, DependencyService with cycle detection, WarningEvaluationService with transitive impact matrix, RPC router with signal broadcasting, and per-user canvas node position persistence
  - **dependency-frontend**: DependencyBadge (dashboard), DependencyAlert (system details), DependencyEditor (system editor dialog), and interactive DependencyMapPage (React Flow canvas)

  **Catalog extensions:**

  - **catalog-common**: New `SystemEditorSlot` for plugin-injected sections in the system editor dialog
  - **catalog-frontend**: `SystemEditor` renders the slot after TeamAccessEditor for existing systems

  **Key capabilities:**

  - Directional dependency edges between systems (source depends on target)
  - Three impact types: informational, degraded, critical
  - Transitive multi-hop warning propagation with toggle switch
  - Cycle detection at creation time with graphical chain visualization
  - Health check-level dependency rules
  - Interactive dependency map with drag-to-connect, edge click editor, and auto-saving node positions
  - Inline editing of dependencies in both the system editor and the map canvas
  - Team-based resource-level access control on all mutation endpoints
  - Realtime signal-driven UI updates

### Patch Changes

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/dashboard-frontend@0.3.24
  - @checkstack/dependency-common@0.2.0
  - @checkstack/catalog-common@1.3.0
