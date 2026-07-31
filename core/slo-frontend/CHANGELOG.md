# @checkstack/slo-frontend

## 0.12.2

### Patch Changes

- Updated dependencies [c83d0d1]
  - @checkstack/ui@1.33.0
  - @checkstack/auth-frontend@0.16.2
  - @checkstack/dashboard-frontend@0.12.2
  - @checkstack/tips-frontend@0.5.8

## 0.12.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/auth-frontend@0.16.1
  - @checkstack/dashboard-frontend@0.12.1
  - @checkstack/tips-frontend@0.5.7
  - @checkstack/catalog-common@2.8.3
  - @checkstack/dependency-common@1.7.9
  - @checkstack/healthcheck-common@1.19.2
  - @checkstack/slo-common@0.9.7

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
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
  - @checkstack/auth-frontend@0.16.0
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/dashboard-frontend@0.12.0
  - @checkstack/tips-frontend@0.5.6
  - @checkstack/catalog-common@2.8.2
  - @checkstack/dependency-common@1.7.8
  - @checkstack/slo-common@0.9.6
  - @checkstack/signal-frontend@0.3.8

## 0.11.8

### Patch Changes

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
  - @checkstack/dashboard-frontend@0.11.2
  - @checkstack/auth-frontend@0.15.0
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/tips-frontend@0.5.5
  - @checkstack/catalog-common@2.8.1
  - @checkstack/dependency-common@1.7.7
  - @checkstack/slo-common@0.9.5

## 0.11.7

### Patch Changes

- @checkstack/dashboard-frontend@0.11.1

## 0.11.6

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

- 6c8b36b: Edit forms stay stable while you are typing. Previously, editing a system's
  description (and many other edit dialogs/settings pages) would reset the field
  mid-edit whenever a webhook update or realtime signal refetched the underlying
  query: the form re-seeded its local state from the fresh query result on every
  refetch. Forms now seed their local state ONCE - on the dialog's open
  transition, or once per record via a stable key - and ignore background
  refetches while you are editing.

  New shared primitive `useSeedFormOnOpen(open, onInit)` in `@checkstack/ui`
  (alongside the existing `useInitOnceForKey`) seeds a dialog form once per
  open transition, StrictMode-safe. Fixed surfaces include the catalog
  system/environment/group editors, the healthcheck platform-defaults dialog,
  the SLO / gitops-provider / telemetry-source / satellite / announcement /
  role edit dialogs, and the cache / queue / notification / secrets / anomaly /
  profile / strategies settings pages (query-seeded pages also drop their loader
  cache via `gcTime: 0` so a warm cache cannot race the one-shot seed).

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
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/dashboard-frontend@0.11.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/tips-frontend@0.5.4
  - @checkstack/dependency-common@1.7.6
  - @checkstack/slo-common@0.9.4
  - @checkstack/signal-frontend@0.3.7

## 0.11.5

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/dashboard-frontend@0.10.11
  - @checkstack/tips-frontend@0.5.3
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/dependency-common@1.7.5
  - @checkstack/frontend-api@0.16.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/signal-frontend@0.3.6
  - @checkstack/slo-common@0.9.3

## 0.11.4

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/auth-frontend@0.13.5
  - @checkstack/dashboard-frontend@0.10.10
  - @checkstack/tips-frontend@0.5.2

## 0.11.3

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
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/dashboard-frontend@0.10.9
  - @checkstack/tips-frontend@0.5.1
  - @checkstack/common@0.22.0
  - @checkstack/dependency-common@1.7.5
  - @checkstack/signal-frontend@0.3.6
  - @checkstack/slo-common@0.9.3

## 0.11.2

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/tips-frontend@0.5.0
  - @checkstack/auth-frontend@0.13.3
  - @checkstack/dashboard-frontend@0.10.8
  - @checkstack/catalog-common@2.7.2
  - @checkstack/dependency-common@1.7.4
  - @checkstack/healthcheck-common@1.16.2
  - @checkstack/slo-common@0.9.2

## 0.11.1

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/auth-frontend@0.13.2
  - @checkstack/dashboard-frontend@0.10.7
  - @checkstack/tips-frontend@0.4.12
  - @checkstack/catalog-common@2.7.1
  - @checkstack/dependency-common@1.7.3
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/slo-common@0.9.1

## 0.11.0

### Minor Changes

- 43e4484: Exclude planned maintenance windows from the SLO error budget.

  SLO objectives gained an opt-in `excludeMaintenanceWindows` flag (defaults to
  false, so existing SLO numbers are preserved). When enabled, the portion of any
  downtime that overlaps a non-cancelled maintenance window on the system is
  subtracted from consumed budget, using pure, unit-tested interval math.

  Because an error budget is a TRAILING window (for example the last 30 days),
  maintenance is pulled by TIME-RANGE OVERLAP over that window via a new
  `maintenance.getMaintenanceWindowsForRange` read query, which includes
  already-completed windows and excludes only `cancelled` ones. This means "last
  night's planned maintenance" keeps being subtracted after it completes, and the
  consumed number does not jump as a window transitions
  `scheduled -> in_progress -> completed`. The windows are injected into the SLO
  engine like the existing health-status callback. The SLO editor now has a toggle
  bound to the field, so the "exclude maintenance" help copy is finally accurate.

  Note: historical `slo_daily_snapshots` are not rewritten, so a trend chart may
  briefly differ from the live number after toggling this on.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- 43e4484: Eliminate the catalog browse view's per-row SLO N+1.

  `SystemSloBadge` previously fetched `getObjectivesForSystem` once per system row, so a catalog with N systems issued O(N) SLO requests on open. slo-frontend now fills `CatalogBrowseDataBoundarySlot` with a `SloBadgeDataProvider` that bulk-fetches `getBulkObjectivesForSystems` keyed on the whole visible `systemIds` set; the per-row badges read their objectives from that provider's context and issue no per-row request. This is behavior-preserving and frontend-only. On surfaces without the filler (e.g. the system detail page) the badge's fallback per-system query runs exactly as before.

- 43e4484: Make the "active incidents" and "SLO" panels on the system overview use the
  shared card design instead of thin banner strips.

  Both panels rendered as flat `rounded-md` strips (`bg-card` / status-tinted
  `bg-*/5`, `px-3 py-2`, no elevation) that looked inconsistent next to the
  maintenance, dependencies, health-checks and anomaly cards. They now use the
  same card recipe as those surfaces: `rounded-[var(--d-card-r)]`, the
  `from-surface-2 to-surface` gradient, `p-[var(--d-pad)]`, and the shared panel
  shadow.

  - Incidents: matches its sibling maintenance banner - a status-colored left
    accent bar, a large count number, and an "active incident(s)" caption, with
    the severity pills preserved. Loading/empty states adopt the same rounding
    and border.
  - SLO: becomes a proper card with a gradient surface, elevation, and an
    `h-4 w-4` icon + `text-sm font-semibold` header, with the objective rows
    aligned to the card padding.

  Visual-only; no behavior, API, or data changes.

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
  - @checkstack/dashboard-frontend@0.10.6
  - @checkstack/catalog-common@2.7.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/ui@1.26.0
  - @checkstack/slo-common@0.9.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/auth-frontend@0.13.1
  - @checkstack/dependency-common@1.7.2
  - @checkstack/tips-frontend@0.4.11

## 0.10.0

### Minor Changes

- f93ee7a: Derive frontend authorization gates from the RPC contract instead of hand-picking
  a hook per call site. The backend contract already declares, per procedure, both
  the access rule (`access`) and how it is instance-scoped (`instanceAccess`); the
  frontend gate was a hand re-encoding of that, which is how the "global-only
  team-grant" drift shipped (nothing enforced that the hook a page chose matched
  the mode the contract declared).

  New `resolveProcedureGate` (`@checkstack/common`) reads a contract procedure's
  metadata and returns the single gate the backend will enforce - classifying
  `global` / `idParam` / `create` / `typeScoped` / post-filtered `open`, deriving
  the object type from the rule and resolving the resource id from the input via
  the contract's declared path. `parentScope` is normalized into an `idParam`/`open`
  gate on a reconstructed parent rule + the parent type (the parent grant string the
  backend checks is exactly `${resourceType}.${action}`, so no contract change was
  needed). New `accessApi.useProcedureAccess(procedure, input)`
  (`@checkstack/frontend-api` / `@checkstack/auth-frontend`) dispatches on the
  derived gate; a call site can no longer gate on the wrong thing.

  Fix a latent `create.parent` gap: the create gate's global-RBAC path only checked
  the procedure's own manage rule, so a user with GLOBAL manage on the PARENT type
  (e.g. a global system manager creating an incident/maintenance/SLO "for" a system,
  which the backend authorizes via the parent gate) was not offered the create
  affordance. The derived create gate now also ORs global manage on the parent type.

  Migrate every `useCanCreate` create-button gate (catalog systems, health checks,
  incidents, maintenance, SLOs, automations, status pages) to `useProcedureAccess`
  on the owning create procedure, which also delivers the `create.parent` fix to
  each, then remove `useCanCreate` from the `AccessApi`.

  BREAKING CHANGES: `accessApi.useCanCreate(...)` is removed from
  `@checkstack/frontend-api`. Replace it with
  `accessApi.useProcedureAccess(SomeApi.contract.createX)` - the create procedure's
  `instanceAccess.create` supplies the object type and parent gate, so no more
  hand-passed `objectType` / `parentType`. The remaining hooks (`useAccess`,
  `useCanAccessType`, `useResourceAccess`, `useRouteAccess`, `useIsAuthenticated`)
  are unchanged: they gate surfaces/rows/routes that are not tied to a single
  procedure. No gate became more restrictive; the create fix makes global
  parent-managers correctly see create controls they were wrongly denied.

  Patch-level adaptations to the `AccessApi` interface change (no behavior change of
  their own): the host app's fallback `AccessApi` stubs (`@checkstack/frontend`) and
  Storybook's mock (`@checkstack/ui`) drop `useCanCreate` and add the new
  `useProcedureAccess` / `useSurfaceAccess` members so they match the interface, and
  a `@checkstack/catalog-common` doc comment now names `useProcedureAccess` instead
  of the removed hook.

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
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/dashboard-frontend@0.10.5
  - @checkstack/dependency-common@1.7.1
  - @checkstack/slo-common@0.8.3
  - @checkstack/tips-frontend@0.4.10
  - @checkstack/signal-frontend@0.3.5

## 0.9.0

### Minor Changes

- b218e3e: Migrate every list table to the shared `DataTable`, so columns can now be
  sorted by clicking their headers (name, status, severity, timestamps, counts,
  ...) and tables that had no search gain a global search box. Tables render on
  an opaque `bg-card` surface, fixing the previously transparent, hard-to-read
  tables (e.g. Catalog Management). Existing per-page filters, bulk selection,
  access gating, extension slots, provenance locks, row-click drawers, and
  mobile card layouts are preserved. Incident/maintenance severity and status
  sort by impact rank (most urgent first), not alphabetically. Server-paginated
  tables keep server-side ordering and do not add a misleading page-local search.

  Row action buttons are now standardized on the shared `RowActions`/`RowAction`
  primitive, so every table's edit/delete/etc. look identical (a subtle ghost
  icon button; destructive tinted red, confirmatory tinted green, never a loud
  filled button). Redundant section headings that merely echoed the page title on
  single-table pages (Incidents, Maintenances, SLO Objectives, Installed Plugins,
  Satellite Nodes) were removed. The Infrastructure Settings tab rail gained an
  accessible `Infrastructure settings` navigation label so its tab buttons stay
  distinguishable from the new sortable column-header buttons in each tab's table.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/dependency-common@1.7.0
  - @checkstack/auth-frontend@0.12.0
  - @checkstack/ui@1.25.0
  - @checkstack/dashboard-frontend@0.10.4
  - @checkstack/tips-frontend@0.4.9

## 0.8.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/dashboard-frontend@0.10.3
  - @checkstack/tips-frontend@0.4.8
  - @checkstack/catalog-common@2.6.2
  - @checkstack/dependency-common@1.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/slo-common@0.8.2
  - @checkstack/signal-frontend@0.3.4

## 0.8.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/ui@1.23.0
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/catalog-common@2.6.1
  - @checkstack/dashboard-frontend@0.10.2
  - @checkstack/dependency-common@1.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/slo-common@0.8.1
  - @checkstack/tips-frontend@0.4.7
  - @checkstack/signal-frontend@0.3.3

## 0.8.1

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1
  - @checkstack/dependency-common@1.6.0
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/tips-frontend@0.4.6
  - @checkstack/dashboard-frontend@0.10.1

## 0.8.0

### Minor Changes

- d9f4654: Add `useManageableResources` to `@checkstack/auth-frontend` so a RLAC-aware
  resource picker no longer re-derives its filter. Given the candidate items and
  the write rule, it returns the exact list to offer - the shared "offer all when
  entitled, else filter to accessible, keep the current selection" policy
  (`selectManageable`), with `allowAllOverride` for a higher rule that authorizes
  any instance - so a picker never offers a resource the submit would reject.

  The incident, maintenance, and SLO "affected systems" pickers now use it instead
  of duplicating that logic. Capability gating of buttons/pages stays on the
  existing `accessApi` hooks + `PageLayout` (the pages consume the verdict
  compoundly, which a wrapper component cannot express).

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

- Updated dependencies [0d912a3]
- Updated dependencies [52c55bf]
- Updated dependencies [0d912a3]
- Updated dependencies [d9f4654]
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
  - @checkstack/auth-frontend@0.11.0
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/dashboard-frontend@0.10.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/slo-common@0.8.0
  - @checkstack/dependency-common@1.5.0
  - @checkstack/tips-frontend@0.4.5
  - @checkstack/signal-frontend@0.3.2

## 0.7.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2
  - @checkstack/dashboard-frontend@0.9.4
  - @checkstack/tips-frontend@0.4.4

## 0.7.3

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
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/dashboard-frontend@0.9.3
  - @checkstack/dependency-common@1.4.4
  - @checkstack/slo-common@0.7.4
  - @checkstack/frontend-api@0.12.1
  - @checkstack/tips-frontend@0.4.3
  - @checkstack/signal-frontend@0.3.1

## 0.7.2

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
  - @checkstack/auth-frontend@0.10.0
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/dashboard-frontend@0.9.2
  - @checkstack/dependency-common@1.4.3
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/slo-common@0.7.3
  - @checkstack/tips-frontend@0.4.2
  - @checkstack/common@0.17.0

## 0.7.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1
  - @checkstack/dashboard-frontend@0.9.1
  - @checkstack/tips-frontend@0.4.1

## 0.7.0

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

- 8cad340: Add point-of-use coaching across the feature config pages and onboarding.

  - The deep-link registry (`@checkstack/common`'s `APP_DOC_SLUGS`) now exposes
    the core-concept docs pages (systems and groups, health checks, SLOs,
    incidents). Each is verified against the real docs content by the existing
    `docs-links.test.ts` rename guard.
  - The catalog, health-check, SLO and incident config pages now carry a
    one-time, dismissable `TipBanner` with a concise orientation sentence and an
    inline "Learn more" deep-link to the matching concept page, so first-time
    visitors get oriented and returning users keep a persistent header
    subtitle plus a replayable banner. The same "Learn more" link is also added
    inside each page's existing concept `<Tip>` popover (catalog has no `<Tip>`,
    so it gains only the banner).
  - The first-run onboarding form now shows a LIVE per-criterion password
    checklist that ticks green as you type, replacing the static rules text and
    the submit-only destructive error list. The criteria live in
    `@checkstack/auth-common` (`PASSWORD_CRITERIA` / `evaluatePasswordCriteria`),
    kept in lock-step with `passwordSchema` and covered by a unit test.
  - The AI chat empty state now leads with orientation-style example prompts
    ("Explain SLOs and how they relate to health checks", "How do I add a system
    to the catalog?") alongside the existing task prompts; clicking one seeds the
    composer for editing. The prompts only appear when an AI integration is
    configured.

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

- 8cad340: Upgrade the SLO editor's form quality to match the catalog `SystemEditor` and
  `DynamicForm` patterns.

  - Inline, per-field validation. A single per-field error map is the source of
    truth for both the inline `FormError` messages and the submit button's
    validity (Create/Update is disabled while any field is invalid). Errors only
    reveal once a field is touched (on blur) or after a submit attempt, so the
    form does not nag while it is first being filled in. Burn-rate warning and
    critical thresholds are now range-checked to `[0, 100]` rather than relying on
    advisory input `min`/`max`. The previous single generic `validation.error`
    toast is gone.
  - The dialog body is wrapped in `<form onSubmit>` with the primary button as
    `type="submit"`, so pressing Enter submits.
  - Mandatory labels (System, Availability Target, Rolling Window) render the
    `required` affordance.
  - Every `Select` is associated with its label via `htmlFor`/`id`, and the Health
    Check Scope and Dependency Exclusion triggers also carry an `aria-label`.
    Invalid fields set `aria-invalid` and `aria-describedby` to their error.
  - The first field is auto-focused on open (System when creating, Availability
    Target when editing).
  - Unsaved-changes guard via `useUnsavedChanges` from `@checkstack/ui`: a
    `beforeunload` / in-app navigation guard while the open editor has edits, plus
    a "Discard changes?" confirmation when closing the dialog with unsaved edits.

- 8cad340: Apply cross-cutting UX consistency sweeps to the SLO and health-check
  frontends.

  Formatting: inline date and percentage formatting now routes through the
  shared `@checkstack/ui` helpers (`formatDate`, `formatPercent`). The SLO trend
  chart and achievement badge no longer hardcode the `en-US` locale, and
  availability / error-budget percentages render with a consistent,
  locale-aware precision policy.

  Success colors: success-semantic palette literals (`text-emerald-*` /
  `bg-emerald-*`) in the SLO dependency-exclusion selector and attribution chart
  now use the `--success` token so they follow theme and dark-mode adjustments.

  Source pill: the health-check runs table's `RunSourceChip` previously
  hand-rolled a pill with a hardcoded `orange` palette; it now renders the
  shared `Badge` (`warning` for remote, `secondary` for local) so it themes and
  matches the surrounding badge row. The displayed "Remote" / "Local" text is
  unchanged.

  Error state: the SLO overview page now renders a `QueryErrorState` (with a
  Retry button) when its list query fails, instead of silently falling through
  to the "No SLOs configured" empty state. The branch is additive, so the
  existing empty-state copy is unchanged.

  Toasts: error-bearing toast call sites now route through the shared
  `toastError` / `toastSuccess` helpers for consistent voice and truncation.
  Error toasts that previously showed only the raw backend message now read
  `"<action>: <message>"` (e.g. `Failed to create: <message>`). Success-toast
  text is unchanged.

### Patch Changes

- 8cad340: Gate three feature-module animations behind the low-power performance tier so
  they respect `.claude/rules/performance.md`. The SLO streak flame
  (`StreakCounter`) and ongoing-downtime dot (`DowntimeTimeline`) no longer
  `animate-pulse`, and the auth "Reload Authentication" refresh icon
  (`StrategiesTab`) no longer `animate-spin`, when `usePerformance().isLowPower`
  is true. The icons render statically in that case; high-power devices are
  unchanged.
- 8cad340: Reduce x-axis tick density of the SLO trend chart on narrow viewports so date
  labels stay legible on phones. No change to chart data or the desktop layout.
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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/auth-frontend@0.9.0
  - @checkstack/ui@1.17.0
  - @checkstack/dashboard-frontend@0.9.0
  - @checkstack/tips-frontend@0.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/dependency-common@1.4.2
  - @checkstack/slo-common@0.7.2
  - @checkstack/signal-frontend@0.2.6

## 0.6.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/dashboard-frontend@0.8.11
  - @checkstack/dependency-common@1.4.1
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/slo-common@0.7.1
  - @checkstack/tips-frontend@0.3.9
  - @checkstack/ui@1.16.2

## 0.6.0

### Minor Changes

- d2077bd: Platform-wide team-scoped access control on a unified relation-tuple store.

  Admins can scope any resource to teams, and the **platform** (not each plugin)
  enforces it. A plugin opts in declaratively by adding `instanceAccess` to a
  procedure's contract; the auth middleware does the rest, so enforcement is
  consistent across catalog, health checks, incidents, maintenances, SLOs,
  automations, and the dependency map, and any third-party plugin gets it for free.

  Core model:

  - **Teams are optional.** A resource with no team grants behaves exactly as
    before.
  - **Team grants are additive and restrict who can CHANGE a resource, not who can
    SEE it.** Granting a team `Manage` lets its members view and change the
    resource; `Read-only` lets them view it. Either level grants access to team
    members **even when they lack the global permission**, and granting never
    removes read from anyone who already had it (e.g. a public status page stays
    readable). Privacy is a separate, explicit opt-in via the **Private** toggle,
    which removes the global read path so only the resource's teams can see it.
  - **Ownership at creation.** Create forms expose an **Owning team** picker. A
    non-admin can create a resource for a team they belong to that holds a
    create-capability grant for that type; the new resource is auto-granted to that
    team. Incidents and maintenances are **parent-gated**: anyone who can manage a
    system may open incidents/maintenances for it, no separate grant needed.
  - **Meaningful authorization errors.** A caller with neither the global rule nor
    any team grant for a resource type gets a `403` with a structured body instead
    of a silently-empty `200`. Anonymous callers on public endpoints are never
    `403`'d, so status pages keep rendering.

  Unified relation-tuple store:

  - The previously separate access primitives (`resource_team_access.canRead` /
    `.canManage`, ownership, `resource_access_settings.teamOnly`, and
    `resource_create_grant`) are collapsed onto ONE
    `relation_tuple(object, relation, subject)` store: "a team has
    `viewer`/`editor`/`owner` on an object, or `creator` on a type". Privacy is an
    explicit **`private` marker** tuple — its **presence** closes the global read
    path (team grants only), its **absence** is the readable-by-default state, so a
    private resource with zero grants is correctly inaccessible to everyone rather
    than silently globalized. The access decision is a pure, unit-tested function.
  - The auth API is generic: `writeRelation` / `removeRelation` / `setObjectPublic`
    / `listObjectRelations` / `listSubjectRelations` / `setCreateGrant` /
    `listTeamCreateGrants` (user-facing) and `check` / `listAccessibleObjectIds` /
    `hasAnyTypeGrant` / `authorizeCreate` / `setOwner` / `deleteObjectRelations`
    (service-to-service). Migration `0008` backfills tuples from the legacy tables
    and drops them.

  Explicit per-procedure scoping:

  - Access rules (`access()` / `accessPair()`) define only the rule (id, level,
    defaults); every procedure declares its own `instanceAccess`. This removes a
    "loaded gun" default that silently applied a shared `idParam` to any procedure
    which forgot its own override.
  - Modes: `idParam` (single-resource pre-check, fails **closed** if the id does
    not resolve), `listKey` / `recordKey` (post-filter a list/record to the
    accessible subset), `create` (authorize creation + write the owning-team
    grant), `parentScope` (scope by read/manage access to a PARENT type,
    cross-plugin single-hop: "you may see incidents/maintenances/SLOs/health for
    system S iff you may see S"), and `global: true` (the honest "intentionally not
    team-scoped" opt-out). A boot-time validator **rejects** any procedure gated on
    a team-scopable resource type that declares no `instanceAccess`, turning the
    previous fail-open into a boot error.

  Teams administration:

  - **Team managers** manage their own team's members and managers without the
    global `auth.teams.manage` rule; creating, deleting, and granting a team access
    remain admin-only.
  - A **standalone Teams page** (gated on `auth.teams.read`) lets managers reach
    team administration without the admin Auth Settings page; members are added via
    a debounced directory picker.
  - A **cross-plugin `ResourceResolverRegistry`** lets owning plugins register a
    name/search resolver for their resource types, so the Teams page lists a team's
    grants **by name** (grouped by type) and offers a resource picker — an admin can
    change a grant's level, revoke it, or add one, without auth depending on every
    plugin. Resolvers shipped for catalog systems, health-check configurations,
    incidents, maintenances, SLO objectives, and automations.

  Frontend:

  - The resource-side editor is **"Who can change this"** (one Manage checkbox per
    team; unticked = read-only), with an always-visible **Private** toggle
    (disabled until a team that can Manage exists, so a resource can't be stranded).
  - `TeamOwnershipPicker` explains _why_ there's nothing to pick (not a member of
    any team, or none of your teams manage the selected parent) instead of a bare
    "global resource" line.
  - Read-only **"who can change this"** indicators on resource detail pages expand
    to the actual people by name; bulk + per-row **Scope to team** actions in the
    catalog systems list; and the team-access copy spells out that grants are
    additive and that Read-only grants view (not change) even without the global
    permission.

  Security hardening:

  - Child deletes in catalog (`removeSystemContact` / `removeSystemLink`) are scoped
    to both the child id and its parent `systemId`, closing a cross-system IDOR for
    team-scoped managers.
  - `searchUsers` is restricted to team administrators, closing a directory/email
    enumeration path opened by the default `auth.teams.read` rule.
  - Grant setters reject unregistered resource types.

  BREAKING CHANGES (beta; shipped as minor bumps):

  - `access()` and `accessPair()` no longer accept `idParam` / `listKey` /
    `recordKey`; move instance config to the procedure's `instanceAccess`.
  - Boot fails if a procedure gated on a team-scopable resource type omits
    `instanceAccess`. Declare a scoping mode or `instanceAccess: { global: true }`.
  - The `AuthService` interface is reshaped: `check`, `listAccessibleObjectIds`,
    `hasAnyTypeGrant`, `authorizeCreate` (returns `isPrivate`), `setOwner`
    (`isPrivate`), and `deleteObjectRelations`. Custom `AuthService` implementations
    and mocks must update.
  - The auth RPC contract's per-concept resource-access endpoints are replaced by
    the generic tuple API above; external callers of the old
    `getResourceTeamAccess` / `setResourceTeamAccess` / `setResourceAccessSettings`
    / `grantResourceCreate` / etc. must move to the new procedures.
  - Several contract inputs changed from a bare `string` to an object so the
    middleware can resolve the resource id: catalog `deleteSystem` (`{ id }`),
    `removeSystemContact` / `removeSystemLink` (`{ id, systemId }`); health-check
    `deleteConfiguration` / `pauseConfiguration` / `resumeConfiguration` (`{ id }`).
    All in-tree callers are updated.
  - List/record endpoints that relied on returning an empty `200` to signal "no
    access" now return a `403` for categorically-unauthorized principals.
  - The mis-keyed bulk endpoints `getBulkIncidentsForSystems`,
    `getBulkMaintenancesForSystems`, and `getBulkObjectivesForSystems` no longer
    post-filter their (systemId-keyed) result; access is already gated by
    `catalog.system` upstream.
  - Team membership/manager mutations (`addUserToTeam`, `removeUserFromTeam`,
    `addTeamManager`, `removeTeamManager`) now require `auth.teams.read` instead of
    `auth.teams.manage` at the contract level (broadened to per-team managers).
  - The `resource_team_access`, `resource_access_settings`, and
    `resource_create_grant` tables are dropped (data backfilled into
    `relation_tuple` by migration `0008`). A previously inconsistent "team-only with
    zero grants" resource is now correctly inaccessible to global-access holders.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/dependency-common@1.4.0
  - @checkstack/slo-common@0.7.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/dashboard-frontend@0.8.10
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/signal-frontend@0.2.5

## 0.5.10

### Patch Changes

- @checkstack/dashboard-frontend@0.8.9

## 0.5.9

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/dashboard-frontend@0.8.8
  - @checkstack/tips-frontend@0.3.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/dependency-common@1.3.2
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/slo-common@0.6.2

## 0.5.8

### Patch Changes

- @checkstack/catalog-common@2.3.5
- @checkstack/tips-frontend@0.3.6
- @checkstack/dashboard-frontend@0.8.7
- @checkstack/dependency-common@1.3.1
- @checkstack/healthcheck-common@1.6.1
- @checkstack/slo-common@0.6.1

## 0.5.7

### Patch Changes

- 0b6f01b: feat(slo): contribute SLO signals to the backend system.issues aggregator

  The SLO plugin now registers a `system.issues` contributor (sourceId `slo`) from
  its backend `init`, so the AI assistant surfaces breaching, degraded, and at-risk
  objectives alongside incidents, anomalies, health checks, and dependency
  problems.

  The contributor enforces its own `slo.read` access gate (returning an empty map -
  never throwing - when the principal lacks access; service users are trusted),
  then reads every objective for all systems from the shared, durable
  `slo_objectives` table via the existing global `listObjectives` service method and
  computes each objective's current status with the engine. The answer is therefore
  identical on every pod, and only systems with a current problem appear in the
  result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveSloSignals` deriver in `@checkstack/slo-common`,
  shared by both the backend contributor and the frontend `SloSignalsFiller` so the
  two surfaces stay in lockstep. The frontend filler now delegates to that deriver
  with unchanged behavior.

- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/dependency-common@1.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/slo-common@0.6.0
  - @checkstack/dashboard-frontend@0.8.6

## 0.5.6

### Patch Changes

- dbe89ae: fix(slo): stop SLO overview cards stretching to the sidebar height

  On the SLO Dashboard the card grid sits next to a taller sidebar in an
  `items-stretch` layout, so the card grid was stretched to the sidebar's
  height and the default `align-content` then stretched the card rows to fill
  it, leaving large empty space inside each card. The card grid now uses
  `content-start` so rows stay content-sized, while `h-full` on the card/anchor
  still makes cards within the same row match each other.

- Updated dependencies [f9cfdae]
  - @checkstack/dependency-common@1.2.5

## 0.5.5

### Patch Changes

- 56e7c75: Fix frontend access checks to use FULLY-QUALIFIED access-rule ids, and resolve
  the anonymous role on the frontend.

  Granted access-rule ids are stored fully-qualified as `{pluginId}.{ruleId}` (e.g.
  `incident.incident.read`) so two plugins defining the same short rule id never
  collide. The frontend, however, was checking the UNqualified id (`incident.read`)
  via `isAccessRuleSatisfied`, so every check failed for any user without the `*`
  (admin) grant - masked in development because dev-auth grants `*`. This silently
  broke ALL non-admin frontend gating (route guards, sidebar entries, and
  `useAccess`-based button/link gating).

  - **`@checkstack/common`**: `AccessRule` now carries a REQUIRED owning `pluginId`;
    `access()` / `accessPair()` require and stamp it; `isAccessRuleSatisfied`
    qualifies the rule (`{pluginId}.{id}`, plus the manage->read escalation) and
    matches ONLY the qualified form. There is intentionally NO unqualified fallback
    - matching a bare id would let one plugin's grant satisfy another plugin's
      identically-named rule (a cross-plugin privilege-escalation flaw). Every plugin
      that defines access rules now passes its own `pluginId`.
  - **`@checkstack/backend`**: `pluginManager.getAllAccessRules()` no longer strips
    the `pluginId` field (the rule `id` is already fully-qualified for the DB sync).
  - **Route guard** (`@checkstack/frontend` / `@checkstack/frontend-api`) now
    checks the FULL rule object (so it qualifies and escalates), not a bare id.
  - **Anonymous role on the frontend**: the `accessRules` procedure is now
    `public`, returning the configurable anonymous role's grants to unauthenticated
    callers; `useAccessRules` fetches them for guests instead of returning an empty
    set. So anonymous UI now reflects exactly what the anonymous role is allowed -
    which an admin can change (`isPublic` is only the seeded default).
  - Incident / maintenance / SLO detail routes are now read-gated (their read rule
    is an `isPublic` default, so the anonymous role holds it unless an admin
    revokes it); their dashboard status signals carry that rule and render as a
    link only when the viewer may open it.

  **BREAKING (`@checkstack/common`):** `AccessRule.pluginId` is now REQUIRED, and
  `access()` / `accessPair()` require a `pluginId` option. `isAccessRuleSatisfied`
  matches ONLY the fully-qualified `{pluginId}.{ruleId}` form - the previous
  unqualified fallback is removed, because it was a cross-plugin
  privilege-escalation flaw. Any code constructing an `AccessRule` or calling
  `access()`/`accessPair()` must supply the owning `pluginId`.

  Verified live against an anonymous caller: read pages resolve (qualified match),
  manage actions are denied, manage->read escalation and `*` still work.

- Updated dependencies [460ffd6]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/dashboard-frontend@0.8.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/dependency-common@1.2.4
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/slo-common@0.5.4
  - @checkstack/tips-frontend@0.3.5
  - @checkstack/signal-frontend@0.2.4

## 0.5.4

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
  - @checkstack/dashboard-frontend@0.8.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/catalog-common@2.3.3
  - @checkstack/dependency-common@1.2.3
  - @checkstack/slo-common@0.5.3
  - @checkstack/common@0.14.1
  - @checkstack/healthcheck-common@1.5.3

## 0.5.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/dashboard-frontend@0.8.3
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/dependency-common@1.2.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/signal-frontend@0.2.2
  - @checkstack/slo-common@0.5.2

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/dashboard-frontend@0.8.2
  - @checkstack/dependency-common@1.2.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/slo-common@0.5.2
  - @checkstack/tips-frontend@0.3.2
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
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/slo-common@0.5.1
  - @checkstack/tips-frontend@0.3.1
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
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/slo-common@0.5.0
  - @checkstack/dependency-common@1.2.0
  - @checkstack/signal-frontend@0.2.0

## 0.4.8

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
  - @checkstack/ui@1.12.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/dashboard-frontend@0.7.8
  - @checkstack/tips-frontend@0.2.7

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
  - @checkstack/slo-common@0.4.2
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/signal-frontend@0.1.5

## 0.4.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/dashboard-frontend@0.7.6

## 0.4.5

### Patch Changes

- f23f3c9: Retrofit the highest-traffic configuration list tables
  (`HealthCheckList`, `SloConfigPage`, and the integration
  `DeliveryLogsPage`) onto the `ResponsiveTable` + `MobileCardList`
  primitives from `@checkstack/ui`. On `sm` and up each page still
  renders the unchanged 5- to 7-column table; below that breakpoint a
  sibling stacked-card layout surfaces the same data with the resource
  name + status badge at the top, secondary columns in a muted line, and
  the existing action buttons in a right-aligned footer. The
  `HealthCheckListSkeleton` placeholder mirrors both branches so the page
  no longer jumps when data resolves. No business logic, column order,
  or query inputs changed.
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

- f23f3c9: Standardise the empty / loading / error story on key list pages using
  the shared `ListEmptyState`, `QueryErrorState`, and `Skeleton`
  primitives from `@checkstack/ui`. Each affected page now branches
  through the same `isLoading -> isError -> empty -> data` ladder, so
  failed queries surface a retry-able inline error instead of silently
  rendering an empty table, and loading states match the final layout
  rather than flashing a generic spinner. No layout, business logic, or
  query input shapes changed.
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/dashboard-frontend@0.7.5
  - @checkstack/ui@1.10.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/dependency-common@1.1.2
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/slo-common@0.4.1
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.4.4

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dashboard-frontend@0.7.4
  - @checkstack/dependency-common@1.1.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/tips-frontend@0.2.4

## 0.4.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/dashboard-frontend@0.7.3
  - @checkstack/tips-frontend@0.2.3

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/dashboard-frontend@0.7.2
  - @checkstack/tips-frontend@0.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/dependency-common@1.1.0
  - @checkstack/slo-common@0.4.0
  - @checkstack/dashboard-frontend@0.7.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.4.0

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
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/dashboard-frontend@0.7.0
  - @checkstack/dependency-common@1.0.2
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/slo-common@0.3.3
  - @checkstack/signal-frontend@0.1.2

## 0.3.10

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
  - @checkstack/common@0.8.0
  - @checkstack/dashboard-frontend@0.6.1
  - @checkstack/dependency-common@1.0.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/slo-common@0.3.2
  - @checkstack/ui@1.7.1
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1

## 0.3.9

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
  - @checkstack/slo-common@0.3.1

## 0.3.8

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
  - @checkstack/slo-common@0.3.0
  - @checkstack/dashboard-frontend@0.5.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/ui@1.6.1

## 0.3.7

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
  - @checkstack/slo-common@0.2.2
  - @checkstack/signal-frontend@0.0.16

## 0.3.6

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/dashboard-frontend@0.4.6
  - @checkstack/ui@1.5.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2
  - @checkstack/slo-common@0.2.1

## 0.3.5

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/dashboard-frontend@0.4.5

## 0.3.4

### Patch Changes

- @checkstack/dashboard-frontend@0.4.4

## 0.3.3

### Patch Changes

- edc9ee0: Refactored SloTrendChart to use Recharts, fixing responsive layout issues and preventing visual distortion. The new implementation correctly scales and preserves SVG aspect ratios.
  - @checkstack/dashboard-frontend@0.4.3
  - @checkstack/catalog-common@1.4.1

## 0.3.2

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/dashboard-frontend@0.4.2

## 0.3.1

### Patch Changes

- @checkstack/dashboard-frontend@0.4.1

## 0.3.0

### Minor Changes

- bb1fea0: Redesign system detail page with hero banner, two-column layout, plugin metric tiles, and health check slide-over drawer.

  ### New Components

  - **MetricTile** (`@checkstack/ui`): Compact stat tile with icon, label, value, variant coloring
  - **Sheet** (`@checkstack/ui`): Slide-over drawer built on Radix Dialog primitives

  ### New Extension Slot

  - **SystemOverviewMetricsSlot** (`@checkstack/catalog-common`): Plugin-contributed at-a-glance metric tiles in the system detail hero banner

  ### Layout Changes

  - System detail page now uses a hero banner with breadcrumb, status badges, and metric tile strip
  - Two-column layout: monitoring content (left) and system context (right)
  - Health checks rendered as compact card rows instead of heavy accordions
  - Clicking a health check opens a slide-over drawer with summary tiles, timeline charts, and recent runs
  - Right column uses lightweight borderless sections with dividers instead of heavy Card wrappers

  ### Plugin Extensions

  - Health check, SLO, Incident, and Maintenance plugins each contribute a metric tile to the hero banner

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/dashboard-frontend@0.4.0
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0

## 0.2.9

### Patch Changes

- @checkstack/dashboard-frontend@0.3.35

## 0.2.8

### Patch Changes

- 86bab6a: ### GitOps: Fix authentication token handling

  - Made `authToken` optional in `ReconcileProviderParams` and `ScraperOptions` to support unauthenticated access to public repositories
  - GitHub and GitLab scrapers now conditionally set authentication headers only when a token is provided
  - Sync worker now decrypts the encrypted `authToken` from the database before passing it to scrapers, fixing authentication failures caused by sending encrypted values in HTTP headers

  ### SLO: Fix premature Nines Club achievement unlock

  - The "Nines Club" achievement now requires both ≥99.99% availability **and** a 365-day compliance streak, preventing immediate unlock on newly created SLOs with 100% default availability

  ### SLO: Align frontend achievement descriptions with backend criteria

  - Fixed mismatched descriptions for Iron Uptime (7-day, not 30), Diamond Uptime (30-day, not 90), Clean Sheet (rolling window, not quarter), Full Coverage (3+ SLOs, not all systems in group), and Nines Club (99.99%)

  ### SLO: Enrich milestones with system names

  - The `getRecentMilestones` endpoint now resolves human-readable system names via the Catalog API instead of returning raw system IDs
  - @checkstack/dashboard-frontend@0.3.34

## 0.2.7

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/dashboard-frontend@0.3.33

## 0.2.6

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/dashboard-frontend@0.3.32

## 0.2.5

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/dashboard-frontend@0.3.31

## 0.2.4

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/dashboard-frontend@0.3.30

## 0.2.3

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29

## 0.2.2

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/dashboard-frontend@0.3.28

## 0.2.1

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/dashboard-frontend@0.3.27

## 0.2.0

### Minor Changes

- 3c34b07: Complete SLO Reliability Engine frontend and backend

  **Frontend** — 7 new visualization components:

  - `StreakCounter`: Fire-themed compliance streak counter with color-coded flame and best-streak trophy
  - `AchievementBadge`: Emoji-labeled badges for 9 achievement types with hover tooltip
  - `AttributionChart`: Horizontal stacked bar showing error budget split (self/upstream/remaining)
  - `DowntimeTimeline`: Dot-and-line timeline with attribution badges and timestamps
  - `SloTrendChart`: Pure SVG availability trend line chart from daily snapshots
  - `MilestoneFeed`: Organization-wide milestone feed on the SLO overview sidebar
  - `DependencyExclusionConfig`: Interactive upstream dependency picker for SLO editor

  **Backend** — Weekly digest scheduled integration event:

  - `weekly-digest.ts`: Cron job (Monday 09:00 UTC) emitting SLO performance summary
  - Top/worst performers, breach counts, and streak data delivered via configured notification channels
  - New `sloWeeklyDigest` hook registered as integration event

### Patch Changes

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/slo-common@0.2.0
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/dependency-common@0.2.1
  - @checkstack/signal-frontend@0.0.15
