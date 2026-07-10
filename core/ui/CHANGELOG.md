# @checkstack/ui

## 1.27.0

### Minor Changes

- 5e704cd: fix(frontend): de-clutter the navbar and move Help into the user menu

  The navbar carried six tap targets (hamburger, logo, search, help, avatar +
  chevron, bell) in a bar barely wide enough for four on mobile, and the `?` icon
  sat in the right-hand rail as a peer of the notification bell and the avatar
  despite being neither a stateful indicator nor an identity control.

  - **Help moves into the user menu**, at both breakpoints, contributed by
    `tips-frontend` to `UserMenuItemsBottomSlot`. Its Documentation link is
    dropped rather than reproduced: the sidebar's Documentation group already
    renders a `Docs` external link on both the desktop rail and the mobile drawer.
    What remains ("Show tips again" plus the lightbulb/tooltip legend) are tips
    concepts that `tips-frontend` already owns, so the shell no longer needs a
    `HelpMenu` component at all - it is deleted, along with `core/frontend`'s now
    unused dependency on `@checkstack/tips-frontend`.
  - **The search trigger** is hidden below `md`; the mobile drawer already has a
    "Search..." entry that opens the same palette. It is hidden with CSS rather
    than unmounted, because `NavbarSearch` owns the palette's open state and the
    ⌘K listener that `openSearchPalette()` re-dispatches into.
  - **The user-menu chevron** and name label are dropped below `md`, and the
    trigger's horizontal padding tightens so the tap target is centred on the bare
    avatar rather than an off-centre pill.

  The mobile navbar is now hamburger, logo, avatar, bell.

  Two defects found on the way:

  - `UserMenu`'s trigger had **no accessible name**. The avatar is decorative and
    the name label is hidden on small screens, so the button was announced as just
    "button". It now carries an `aria-label`.
  - User-menu contributions were ordered by plugin load order, because the slot
    declared no metadata type and `ExtensionSlot` sorts on an optional `priority`.
    Every contributor now declares one, so the menu renders Help, appearance
    toggles, About, Logout deterministically, with Logout pinned last.

  The two user-menu slots are also collapsed into one. `UserMenuItemsSlot` had not
  been rendered by anything since navigation moved to the sidebar - its render site
  was removed and the definition left behind - so every real contribution went to
  `UserMenuItemsBottomSlot`, and a "bottom" section existed with no top section
  above it. The docs additionally described a `group`-based system for the top slot
  (canonical `Workspace` / `Reliability` / `Configuration` headers, alphabetized
  custom groups) that was never implemented: nothing read `metadata.group`. The
  surviving slot is `UserMenuItemsSlot`, ordering is expressed with `priority`, and
  the fictional grouping is gone from the docs.

  BREAKING CHANGE: `useIsMobile()` now matches `(max-width: 767px)` instead of
  `(max-width: 640px)`. It must agree with the app shell's layout breakpoint - the
  hamburger is `md:hidden` and the sidebar rail is `hidden md:flex`, so "the shell
  is in its mobile layout" means below `md`. Previously the 641-767px range
  rendered the mobile hamburger while `useIsMobile()` still reported `false`, so
  the user and notification menus opened as desktop popovers inside a mobile
  layout. Consumers outside the shell (`HealthCheckHistoryDetailPage`,
  `SloTrendChart`) now switch to their mobile presentation 128px earlier.

  BREAKING CHANGE: `UserMenuItemsBottomSlot` is removed. Contribute to
  `UserMenuItemsSlot` instead - it is now the menu's only item slot and is actually
  rendered. `UserMenuItemsMetadata` loses its never-implemented `group` key and
  gains `priority?: number`, which orders items ascending (lower first). A
  contribution registered through the type-strict `createSlotExtension` helper must
  now pass a `metadata` object; plain-object `extensions` entries may omit it and
  default to priority 0.

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/frontend-api@0.15.0

## 1.26.1

### Patch Changes

- bd41130: fix(ui): stop the Alert icon from being squished by long body text

  When an icon is passed as a direct child of `<Alert>` (the raw-icon usage, as
  opposed to wrapping it in `<AlertIcon>`), the alert's flex row had no
  `shrink-0` on the icon, so a long multi-line body compressed the icon
  horizontally into a thin sliver. Added `[&>svg]:shrink-0` to the Alert's inner
  container so any direct `<svg>` child keeps its intrinsic size. This fixes every
  raw-icon alert at once (e.g. the in-memory cache/queue warnings) without
  touching each call site; icons wrapped in `AlertIcon` were already `shrink-0`
  and are unaffected.

- Updated dependencies [b80160a]
  - @checkstack/frontend-api@0.14.2

## 1.26.0

### Minor Changes

- 43e4484: Extend `{{ … }}` environment templating across every built-in health-check type
  and add editor UX for it, so one check config can cover N environments (mirrors
  the existing HTTP `url` pattern).

  Templatable connection/target fields now marked `x-templatable`:

  - TLS: `host`, `servername`; TCP: `host`; Ping: `host`; gRPC: `host`, `service`.
  - MySQL / Postgres: `host`, `database`, `user`, `query`.
  - SSH: `host`, `username`, `command`; Redis: `host`, `args`; RCON: `host`,
    `command`.
  - DNS: `hostname`, `nameserver`; Jenkins: `url` (`baseUrl`), `jobName`;
    Container: `endpoint`, `container`.
  - SNMP: `host` (strategy), `oid` (collector).
  - Script (shell): `cwd` (working directory).

  This closes the last gaps so the coverage is now truly every built-in
  health-check type. The Script collectors' `script` bodies are deliberately NOT
  templatable: rendering `{{ … }}` into shell/TypeScript source would splice env
  values into executed code. Per-environment data reaches those scripts safely via
  the reserved `CHECKSTACK_ENV_*` shell vars (shell collector) and
  `globalThis.context.environment` (inline collector) instead.

  Because templating strips `{{ }}` and renders an undefined variable to an empty
  string, every REQUIRED templatable field now has a post-render config-error
  guard so an empty/invalid render is treated as a transport failure instead of a
  silent "healthy" empty probe. Strategy connection fields (host, database, user,
  endpoint, container, Jenkins base URL, SNMP host) throw from `createClient`;
  collector target fields (query, command, hostname, jobName, SNMP oid) return a
  `CollectorResult` with an `error`. Jenkins `baseUrl` moves its `.url()` validation to post-render.
  Secret fields (passwords/tokens/keys) are never templatable; optional fields
  (SNI `servername`, gRPC `service`, DNS `nameserver`, Redis `args`, Script `cwd`)
  are templatable but not non-empty-guarded, since an empty render is a legitimate
  "unset". SSRF/egress guards continue to run on the rendered host (rendering
  happens before `createClient`).

  Editor UX (`@checkstack/ui` + `@checkstack/healthcheck-frontend`):

  - The environment "Preview as" picker + live preview line now also apply to the
    strategy (connection) form, not just collector forms, so host/port templates
    preview too.
  - A single-line templatable field shows a small "Templating" badge next to its
    label and, when a completion provider is supplied, renders a
    `TemplateValueInput` with `{{ … }}` autocomplete. The health-check editor
    seeds the provider with the fixed `environment.* / check.* / system.*`
    namespace (`createReferenceCompletionProvider`, new `@checkstack/ui` export),
    and `DynamicForm` gains a `templatableFieldsOnly` prop so only `x-templatable`
    fields become template inputs (automation keeps templating every string field).

  BREAKING CHANGE: none. Existing non-templatable configs and stored values are
  unaffected; only fields explicitly marked `x-templatable` change behavior.

  The `@checkstack/ai-backend` bump reflects the regenerated docs index for the
  updated health-check collector and config-schema templating documentation.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- 43e4484: Incidents and maintenance: richer, safer update timelines.

  - **Markdown updates and descriptions.** Update messages and descriptions now
    render sanitized Markdown (bold, links, lists) everywhere they appear -
    detail pages, editors, the shared status-update timeline, and the public
    status page (which stays sanitized via `rehype-sanitize`). An "Markdown
    supported" hint is shown under the update composer.
  - **Edit and delete published updates.** New `editUpdate` / `deleteUpdate`
    procedures let a manager correct or remove an update in place; edited updates
    are marked "edited". Editing the `statusChange` of the latest update
    re-derives the incident/maintenance status. Deletion is irreversible and, on
    the AI path, always routes through propose/apply. Both procedures are
    object-scoped on the owning incident/maintenance (`idParam`), so team-scoped
    managers can use them without a global rule.
  - **Edit the published time of an update.** `editUpdate` now accepts an optional
    `createdAt`, and the update editor exposes a date/time picker (the same
    `DateTimePicker` used for maintenance windows) when editing an existing update.
    Re-timing an update re-orders the timeline and re-derives the incident/
    maintenance status (the header still follows the latest status-bearing
    update), so moving an update never leaves the header and timeline diverged.
  - **Per-update edit history (GitHub-style "history of edits").** Each in-place
    edit now archives the prior version of the update into a new durable
    `edit_history` `jsonb` column (a snapshot of message, status, visibility, and
    the published time it carried, plus when it was superseded). The shared status
    timeline turns the "edited" marker into an "edited (N)" disclosure that
    expands to show those prior versions. History is **manager-facing only**: the
    read path attaches `editHistory` solely for the manager audience and strips it
    for public / logged-in readers, so a version that was `internal` before being
    made `public` can never leak its prior internal content. A no-op edit
    (nothing actually changed) neither archives a snapshot nor marks the update
    "edited". Adds a forward-only, additive migration to each backend
    (`edit_history jsonb NOT NULL DEFAULT '[]'`, backfilling existing rows).
    We framed this as "either a delayed publish with undo OR a history of
    edits"; edit history satisfies the ask, so undo-send / delayed-publish is
    intentionally **deferred** (it would need a queue-delay + pending state and is
    redundant with history).
  - **Status updates are now editable from the editor dialog too, via one shared
    implementation.** The status-updates surface (add / edit / delete an update,
    including its published time and edit history) is extracted into a single
    `IncidentUpdatesSection` / `MaintenanceUpdatesSection` used by BOTH the detail
    page and the create/edit editor dialog, so the two surfaces can no longer
    drift. Previously the editor dialog showed a read-only timeline with no way to
    edit an existing update.
  - **Editable hotlinks.** Added-links can now be edited in place (label, URL, and
    visibility where applicable) instead of only added/removed. The shared
    `LinksEditor` gains an inline edit affordance, backed by a new `updateLink`
    procedure on incidents and maintenances and `updateSystemLink` on catalog
    systems (so system links are editable too). Each is object-scoped on its
    parent (`incidentId` / `maintenanceId` / `systemId`) with the same anti-spoof
    WHERE-clause scoping as the remove path, so a link id cannot be paired with a
    foreign parent the caller happens to manage. No migration is needed (the
    columns already exist).
  - **Per-update / per-link visibility.** A new shared visibility level
    (`public` / `logged_in` / `internal`) can be set on both updates and hotlinks
    via the same three-way visibility select in the editor (the update composer
    previously exposed only a binary public/internal toggle, so `logged_in` was
    unreachable for updates even though the backend already accepted and filtered
    it). Filtering is enforced SERVER-SIDE on every read path: anonymous callers
    and the public status-page projection see only `public`; authenticated
    non-managers additionally see `logged_in`; managers see everything. Updates
    still default to `public`, and `internal` updates never broadcast a
    notification. Adds a forward-only migration to each backend (new visibility
    enum + column, plus a nullable `edited_at` on updates).
  - **"Keep Current" shows the current status**, e.g. "Keep Current
    (Investigating)".
  - **Status colors.** Adds a blue `--status-info` token and a shared
    `StatusPillTone` / `pillToneStyles` in `@checkstack/ui`; incident "monitoring"
    and maintenance "scheduled" now read as informational (blue) instead of grey.
    The incident severity ramp is now blue(minor) -> amber(major) -> red(critical):
    a minor incident uses the blue `info` hue instead of grey, with no minor/major
    amber collision. This corrected ramp now also applies on the public status
    page (active-incident cards, severity pills, and the incident detail page) and
    in the system-detail active-incidents panel, which both previously still
    rendered `minor` grey.
  - **Logged-out overview.** Incidents and maintenance now expose a public,
    read-gated overview page and sidebar entry (the manage-gated config page is
    renamed "Manage ..."), so anonymous visitors who hold the default read rule
    can browse them.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- Updated dependencies [43e4484]
  - @checkstack/frontend-api@0.14.1

## 1.25.1

### Patch Changes

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

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/template-engine@0.4.11

## 1.25.0

### Minor Changes

- b218e3e: Add a shared `DataTable` component: column-driven click-to-sort headers, an
  optional global search box, per-row presentation/behaviour via `getRowProps`
  (including full keyboard/ARIA passthrough for interactive rows), a
  `renderMobileCard` branch for narrow viewports, and an opaque `bg-card`
  surface by default so tables stay readable over any page background. Powered
  by `@tanstack/react-table` (new dependency) behind a fully-typed house API;
  sorting is locale-aware/numeric with nullish values sorted last. Includes a
  Storybook story and unit-tested sort/filter helpers.

  Also add `RowActions` + `RowAction` - the one canonical style for a table row's
  action buttons (a subtle, compact ghost icon button; `tone="destructive"` tints
  it without a loud filled background), so actions look identical across every
  data table.

  BREAKING CHANGES: the `ResponsiveTable` and `MobileCardList` primitives are
  removed - their dual-layout role is now internal to `DataTable`. Migrate table
  call sites to `DataTable` (`renderMobileCard` replaces the paired
  `MobileCardList`). For non-table responsive lists, use plain
  `hidden sm:block` / `sm:hidden` wrappers.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  (sortable, searchable list tables) that shaped this release.

## 1.24.0

### Minor Changes

- c55d7c6: Unify the healthcheck chart system on the `@checkstack/ui` SVG kit and
  redesign the HealthCheck drawer.

  - `@checkstack/ui` gains six chart primitives (each with a Storybook story):
    `StackedTimeline` (stacked status counts per bucket on the colorblind-safe
    status triad), `ChartTooltip` + `useBandHover` (the one shared chart
    tooltip and its cursor hit-testing), `ChartCard` / `chartCardChromeClass`
    (the premium gradient card chrome, flat on low-power devices), `StatTile`
    (number-led metric tile with delta chip, sparkline/ribbon footer, and
    click-to-expand disclosure), `DistributionBar` (stacked horizontal
    distribution + legend, replaces pies), and `CategoryRibbon` (categorical
    history ribbon). `TimeSeriesChart` gains a hover tooltip with a crosshair
    marker.
  - `@checkstack/common` adds four optional chart metadata keys to
    `BaseHealthResultMeta`: `x-chart-priority` (tile sort weight, lower first,
    default 100), `x-chart-good-direction` (`"up" | "down"`, which direction
    of change is an improvement; consumers fall back to
    `x-anomaly-direction`), and `x-chart-true-label` / `x-chart-false-label`
    (prose for a boolean field's values wherever they surface in text, e.g. a
    dominance chip reading "Usually successful (98%)" instead of "Usually
    true"). Built-in collector backends annotate their headline metrics and
    boolean fields accordingly (purely additive metadata).
  - `@checkstack/healthcheck-frontend` rebuilds the drawer: a hero status
    banner (status pill, healthy %, avg latency, interval, last run with the
    exact datetime on hover, full-width status ribbon) replaces the metric
    tiles; the status timeline and latency heroes share the `ChartCard`
    chrome; the auto-generated charts become a prioritized, click-to-expand
    2-up tile grid (collector ids demoted to hover titles); the anomaly
    Expected/Trend derivation is consolidated into one tested module shared by
    the latency hero and the tiles.

  BREAKING CHANGES: `recharts` is removed from `@checkstack/healthcheck-frontend`
  (and the unused dependency from `@checkstack/ui`); the
  `HealthCheckStatusTimeline` and `SparklineTooltip` components are deleted.
  Extensions rendering into `HealthCheckDiagramSlot` should build on the
  `@checkstack/ui` chart primitives instead.

- c55d7c6: Rebuild the health-check run history as a master-detail split view.

  - `@checkstack/ui` gains `SplitPane` (master-detail grid with independently
    scrolling columns; the detail column hides below `md` so callers present
    mobile detail in a `Sheet`) and `VirtualList` (windowed list built on the
    new `@tanstack/react-virtual` dependency), both with Storybook stories.
  - The run-history detail page pins the run detail beside a virtualized run
    list instead of mounting it above the table, so selecting a run never
    scrolls the list away. The selected run stays in the URL (deep links keep
    working), gains prev/next navigation with page fall-through, ArrowUp/Down
    keyboard walking, a loading skeleton, and an explicit "run not found"
    retention message. The raw run payload becomes viewable for the first time
    in a Raw payload tab.
  - The list ends, on its last page, with an explicit "Aggregated before
    <date>" divider followed by the pre-retention aggregate buckets instead of
    an unexplained empty page. The retention config read falls back to the
    platform default for system-owner viewers without configuration access.
  - `HealthCheckRunsTable` turns selection into a prop (`onRowSelect` /
    `selectedRunId`), gains keyboard operability (`role="button"`, Enter/Space,
    focus ring, `aria-current`) and a status-toned selected-row accent; its
    timestamp shows the exact datetime on hover for every viewer. The drawer
    reuses it and opens run details in a nested sheet instead of ejecting to
    the history page; its hand-rolled source filter is replaced by a shared,
    tokenized `SourceFilterPills` (removing the raw orange Tailwind colors).

  BREAKING CHANGES: `HealthCheckRunsTable` no longer navigates on row click by
  itself; callers pass `onRowSelect`. Its row type's `result` field is now
  optional.

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/frontend-api@0.13.2
  - @checkstack/template-engine@0.4.10

## 1.23.0

### Minor Changes

- faf98f5: Security: config secrets (health-check strategy/collector credentials such as
  SSH passwords, DB credentials, HTTP auth, and integration connection
  credentials) ride ONE shared, domain-agnostic extraction channel instead of
  being stored as plaintext or re-implemented per plugin.

  New primitive and shared service:

  - `configSecret({ id })` (in `@checkstack/backend-api`) declares an
    extraction-channel secret keyed by a STABLE `id`, independent of field name or
    position, so renaming or reordering a field never orphans its value. Use it
    (not `configString({ "x-secret": true })`) for any credential whose config is
    relayed to a satellite, projected to AI, or diffed by GitOps. `validateSecretIds`
    rejects, at plugin registration, an `x-secret` field with no `id`, a duplicate
    `id`, or a secret nested in an un-keyable container (array / record / tuple /
    map) - so a mis-keyable schema fails boot rather than at run time.
  - `ConfigSecretChannel` (in `@checkstack/secrets-backend`) is the single
    extract / inflate / collect / redact / merge / delete / prune implementation.
    Health-checks and integration connections both BIND it to their own scope
    (marker prefix + internal-secret key layout); neither re-implements the walk.

  Lifecycle (both bindings):

  - **Write**: an inline value is extracted into the encrypted internal secret
    store; the stored config keeps only an opaque marker. `${{ secrets.NAME }}`
    references are stored verbatim and resolve through the active backend (local
    or Vault) at run time.
  - **Read**: configuration and connection reads strip `x-secret` values and
    internal markers while keeping `${{ secrets.NAME }}` references visible; the
    AI `getConfigurations` tool and create/update responses are redacted too. A
    value never reaches a browser or an AI model context.
  - **Run**: the core executor inflates markers/references in memory just before
    the client is built. Satellites receive markers only and fetch values
    just-in-time over the authenticated WS channel, per run, never persisted, then
    fail CLOSED if any marker/reference survives resolution.
  - **No orphan**: clearing a secret, removing a field/collector, swapping an
    inline value for a reference, updating a connection, or deleting a
    configuration/connection deletes the now-unreferenced internal secret. Cleanup
    is schema-free (scans markers by prefix) and best-effort on delete, so it works
    even when the owning plugin is uninstalled and never blocks a delete.
  - **Forged-marker safe**: extract/inflate key each internal secret by the
    SCHEMA leaf's stable `id`, never by an id parsed out of a stored marker string,
    so a crafted marker can never resolve or delete another scope's secret.

  Health-checks additionally get an idempotent, advisory-locked backfill that
  moves pre-existing plaintext values into the internal store, and per-config-id
  locking so concurrent writers across pods can never leave a dangling marker.
  Integration connection credentials keep their released `__connref__:` marker
  prefix and key layout (id equals the flat field name), so existing stored
  connections are byte-compatible.

  BREAKING CHANGES:

  - Configuration and connection reads no longer include `x-secret` field values
    (clients must treat blank-on-save as keep-existing; the bundled editors
    already do).
  - Satellites must be upgraded together with the core: an old satellite cannot
    resolve the markers a new core stores, so its credentialed checks fail until
    upgraded.

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/frontend-api@0.13.1
  - @checkstack/template-engine@0.4.9

## 1.22.0

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

- 692fa18: Add a searchable, stably-sorted system picker to maintenance and incident editors.

  The "Affected Systems" picker in the maintenance and incident editors was a
  plain inline checkbox list that was neither sorted nor searchable, so the
  order jumped between renders and finding a system in a large catalog meant
  scrolling. Both now use a shared `SystemMultiSelect` component that sorts
  systems by name (case-insensitive, natural numeric order) once per render and
  adds a substring search box, with a "{n} selected" count.

  `SystemMultiSelect` is now exported from `@checkstack/ui`. The status-page
  builder's inline duplicate of the same component is removed in favour of the
  shared one.

### Patch Changes

- 0d912a3: Make `Checkbox` an accessible control. It was a bare `<div>` with an `onClick` -
  not keyboard-focusable, no `role="checkbox"`/`aria-checked`, and a wrapping
  `<label>` could not forward clicks to it (so clicking a row label next to it did
  nothing). It now renders a real, transparent, keyboard-focusable native
  `<input type="checkbox">` over the styled visual box: Space toggles it, it has a
  focus-visible ring, and label clicks work. Fixes multi-select rows (e.g. an
  incident/maintenance editor's "Affected Systems") where clicking the system name
  failed to toggle selection.
- a07b375: Fix inline-script editor `Response` type missing `ok`/`status`/`body` (and
  `Request`/`Headers`/`fetch` members).

  The editor's Monaco virtual filesystem bundled `@types/node` and `bun-types`
  but not `undici-types`, which both packages reference via
  `import("undici-types").Response` for the concrete fetch-API members. With
  `undici-types` absent those imports resolved to `any`/`{}`, so the global
  `Response` collapsed to just the `headers` override `bun-types` adds. The
  stdlib-types generator now bundles `undici-types` alongside `@types/node` and
  `bun-types`.

- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/template-engine@0.4.8

## 1.21.0

### Minor Changes

- baf9b6e: Script health-check editors now surface the assigned environment.

  Inline TS/JS health checks autocomplete `context.environment` (the optional
  `{ id, name, fields }` the run resolves to), with `fields` typed
  `Record<string, unknown>` so values are narrowed before use (the API/GitOps
  write path allows arbitrary JSON, not just the UI's string key/value pairs).
  Shell health checks now suggest the `CHECKSTACK_ENV_ID` / `CHECKSTACK_ENV_NAME`
  run-context variables (with the per-field `CHECKSTACK_ENV_<FIELD>` naming
  convention documented inline). The runtime already injected these; this only
  adds the editor type definitions and `$`-completion hints, and flows through to
  the regenerated `@checkstack/sdk/healthcheck` types.

## 1.20.0

### Minor Changes

- defb97b: fix(mobile): make the nav drawer fully scrollable and de-clutter the navbar

  The mobile navigation drawer (`Sheet`) spanned the layout viewport
  (`inset-y-0 ... h-full`), so on a phone its bottom - and the last menu items -
  sat behind the browser URL bar and could not be reached. The sheet is now bound
  to the dynamic viewport (`h-[100dvh]`, top-anchored), so it ends at the visible
  bottom and scrolls to the last item.

  The "Checkstack" wordmark in the navbar is now hidden below the `sm` breakpoint
  (the logo still anchors the home link), freeing space on the cramped mobile
  navbar.

- defb97b: feat(ui): add a Stepper primitive

  Add a presentational `Stepper` step-indicator component and a `useStepper` state
  hook for building guided multi-step flows (used by the new "create your first
  check" onboarding wizard). Completed steps are navigable; the active step is
  highlighted; future steps are muted. Animations are disabled on low-power
  devices via `usePerformance`.

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/frontend-api@0.12.1
  - @checkstack/template-engine@0.4.7

## 1.19.0

### Minor Changes

- 2e20792: Serve public status pages from the lean bundle, and stop the SPA entry pulling the whole UI kit

  Public status pages used to render inside the full admin app on same-origin
  paths, so opening one booted every plugin (and its eager slot components) and the
  entire `@checkstack/ui` barrel.

  - **Lean public bundle for public paths.** New platform extension point
    `publicPathExtensionPoint` lets a plugin declare same-origin public path
    prefixes; the backend advertises them via `/api/config` and the inlined boot
    blob. The SPA entry now loads the minimal public bundle (no admin app, no
    plugin loader, no eager plugin components) for those paths, driving the slug
    from the URL. A status page no longer loads any admin frontend code.
  - **Entry no longer imports the `@checkstack/ui` barrel.** `ThemeProvider` /
    `DensityProvider` moved from `main.tsx` into each bundle's root (`App` and
    `public-app`), cutting the critical-path preload from ~280 KB to ~0.5 KB gz on
    both bundles (the barrel now loads only inside the bundle that needs it).
  - **public-app provider fix.** Added the missing `ToastProvider` (required by
    `PerformanceProvider`) so the public bundle renders standalone.
  - **Local plugins load as parallel chunks.** The bundled plugins moved from one
    eager `import.meta.glob` chunk to per-plugin lazy chunks downloaded in
    parallel. They are still registered before first render (the shell chrome
    depends on plugin-contributed APIs such as the auth plugin's `auth.api`), and
    remote plugins continue to load after first paint and register reactively.
  - **Tree-shakeable barrels.** `@checkstack/ui`, `auth-frontend`,
    `command-frontend`, `signal-frontend`, and `announcement-frontend` now declare
    `sideEffects` (CSS only), so importing one provider/hook no longer drags a
    whole package's components into the shell. `AnnouncementBanner` also lazy-loads
    its Markdown renderer, keeping ~98 KB of react-markdown out of first paint.

  BREAKING CHANGE: status-page route ids now match the `statuspage` plugin id (the
  frontend route registry requires this). URLs change: the admin builder moves from
  `/status-pages` to `/statuspage` (and `/status-pages/:id` to `/statuspage/:id`),
  and the public page moves from `/status/:slug` to `/statuspage/view/:slug`. Update
  any bookmarks or external links to published status pages.

### Patch Changes

- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/common@0.17.0
  - @checkstack/template-engine@0.4.6

## 1.18.0

### Minor Changes

- 748dc50: Fix automation expression fields and harden the Jira search action so actions are reliable to author.

  - **Expression fields reject `{{ }}` at save time.** `when` / `conditions` / a `condition` guard / `wait_until.condition` / a trigger or `wait_for_trigger` `filter` / `repeat.for_each|while|until` / `numeric_state.value` are BARE expressions and reference fields directly. Wrapping one in `{{ }}` (template syntax) used to pass validation and then throw a parse error at dispatch time. A new schema refinement (`collectExpressionDelimiterIssues`) now blocks the save (create / update / GitOps / editor) with a clear message. The misleading "Template returning truthy/falsy" schema descriptions are reworded to say "bare expression (no `{{ }}`)".
  - **Fixed three built-in templates** that wrapped their `when` condition in `{{ }}` (`ai-triage-file-jira-bug`, `jira-comment-transition-on-recovery`, `ai-severity-escalation`) and the webhook-subscription migration that emitted a `{{ }}`-wrapped `systemFilter` condition.
  - **The artifact-wiring validator now scans bare expression conditions**, not just `{{ }}` template spans, so a dropped `<artifactType>` segment (e.g. `artifacts.find.found` instead of `artifacts.find.issue_search.found`) is still caught in a `when` / `condition`.
  - **Jira `search_issues` correlation overhaul.** `statusCategory` is now a dropdown (`new` / `indeterminate` / `done`) instead of free text. A new `labels` filter (`labels in (...)`, AND of all labels) is the reliable way to find the ticket for a specific system, and the two Jira built-in templates now tag issues with a stable `checkstack-sys-<systemId>` label on create and search by it instead of fuzzy `summaryContains`. A search whose CONFIGURED filter renders empty now fails loudly instead of silently broadening to "every ticket in the project". Results are ordered `created DESC` so `firstIssueKey` is deterministic.
  - **Fixed `{{ }}` autocomplete hiding upstream artifacts in raw config fields.** The raw multi-type editor (used by Jira `summary` / `description` and every other `["raw"]` action-config field) matched its autocomplete query without trimming the leading space after `{{`, so typing `{{ arti` produced the query `" arti"`, which matched nothing — the popup emptied the instant a letter was typed and `artifacts.*` (and all other fields) never appeared. The query is now trimmed before matching (the autocomplete logic was extracted to a pure, unit-tested helper). This was most visible on an action nested in a `choose` branch, where upstream artifacts are exactly what you reference. The popup rows also now keep the distinguishing leaf segment (`…analysis.summary`) visible instead of end-truncating every deep path to an identical shared prefix.
  - **Editor UX: expression vs template is now visible.** `TemplateValueInput` gains a `mode` prop; in `expression` mode it shows a focus hint ("reference fields directly, without `{{ }}`") and an inline error the moment a `{{ }}` delimiter is typed, instead of failing only at save / run time. Every expression-field editor (conditions, trigger / `wait_for_trigger` filters, `repeat` for_each/while/until, `window.partitionBy`) now runs in expression mode, and their misleading "Filter template" / "Condition template" labels and `{{ }}` placeholders are corrected.
  - **AI assistant guidance corrected.** The `building-automations` doc (bundled into the AI docs index) no longer tells the model to wrap a condition in `{{ }}`.
  - **Jira provider docs corrected.** The setup help advertised a fabricated nested `payload.system.name`; platform events expose flat `systemId` / `systemName`, so the example payload and template-syntax snippet now use the real flat shape.

  BREAKING CHANGE: An automation definition that wrongly wrapped a condition / filter in `{{ }}` is now rejected on save. These definitions already failed at run time; re-save them with the braces removed (e.g. `artifacts.find.issue_search.found != true`).

## 1.17.0

### Minor Changes

- 8cad340: Fold the typed-phrase confirmation gate into the shared `ConfirmationModal`.

  `ConfirmationModal` now accepts an optional `confirmPhrase` (plus
  `confirmPhraseLabel` and `confirmPhrasePlaceholder`): when set, it renders an
  input and keeps the confirm button disabled until the typed value matches the
  phrase exactly. The typed value resets whenever the modal reopens. The `message`
  prop is widened from `string` to `React.ReactNode` so callers can pass rich
  descriptions; existing string call sites are unaffected. A pure
  `isConfirmPhraseSatisfied` predicate backs the enable/disable logic and is unit
  tested.

  The pluginmanager install and uninstall flows now use `ConfirmationModal` with
  `confirmPhrase`, and the parallel hand-rolled `TypedConfirmModal` (which lacked
  focus trap, Escape-to-close, scroll-lock, and focus restoration) is removed.
  Behavior and UX (phrase gate, danger/warning styling, confirm action) are
  preserved, now on the accessible Radix Dialog base.

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

- 8cad340: Add a finer per-run transport timing breakdown to health checks.

  Each run now records an optional structured `metadata.timings` (DNS, connect,
  TLS, wait/time-to-first-byte, transfer, and a `processing` catch-all for
  non-HTTP operation time). The run-detail view renders the phases it has, in
  transport order, and falls back to the previous Connection + Processing split
  for older runs that lack the finer data.

  For HTTP the request is issued verbatim through `fetch` (original URL, headers,
  and body), so request behavior is identical to a plain `fetch`. The timing is
  measured around it: `fetch` resolves at the response headers, so wait
  (time-to-first-byte) and transfer (body) are measured exactly on the request,
  DNS is timed at the resolve step, and connect/TLS come from a short-lived,
  best-effort raw `net`/`tls` probe to the same already-validated IP (the request
  socket exposes no connect/handshake events on the Bun runtime). The probe is
  timing-only and never fails the check. The probe validates the TLS certificate
  (against the original hostname via SNI) like the real request does - it does not
  disable certificate validation; an unverifiable cert simply yields no TLS-phase
  timing rather than aborting. Other transports surface the connect and operation
  times they already measure.

  The SSRF guard now validates the resolved host (rejecting cloud-metadata /
  link-local and operator-denied ranges) as a pre-flight check and no longer pins
  the request to the resolved IP. Pinning rewrote the URL to the IP literal and
  moved the host to the `Host` header, which breaks HTTP/2 origins (their
  authority comes from the URL's `:authority`, not `Host`) - that is why real
  hosts such as `google.com` started answering 404/429 instead of 200. The
  pre-flight validation keeps blocking static metadata/link-local targets and
  direct denied IP literals; the only thing dropped is DNS-rebind TOCTOU
  protection (a narrow window that pinning closed at the cost of breaking
  legitimate HTTP/2 requests).

  The run-detail "slowest" badge no longer collides with the timing bar, and a
  genuinely sub-millisecond phase reads as "<1 ms" instead of a bare "0 ms".

- 8cad340: Improve sidebar navigation and information architecture:

  - Split the overloaded "Configuration" group into focused sections: "Settings"
    (Auth Settings, Teams, Secrets, Notification Settings), "Platform" (Plugins,
    GitOps, Integrations, Infrastructure), and "Developer" (Script Packages,
    Script Sandbox).
  - Unify nav active-state on a single shared `isNavRouteActive` helper so the
    sidebar rail and the shared `NavItem` both prefix-match section roots
    (child/detail routes now highlight the parent entry consistently).
  - Mark the external Docs entry with an external-link icon so it is clear which
    entries leave the app.
  - Add an "Expand all" affordance to recover from a fully-collapsed sidebar.
  - Flatten single-entry groups (e.g. Automation) into top-level items, skipping
    the redundant group header.
  - Add an in-drawer search entry to the mobile navigation (opens the Cmd+K
    palette) and auto-expand the group containing the active route when the
    drawer opens.

- 8cad340: Accessibility: rebuild overlays on accessible primitives and add form error/required affordances.

  - `ConfirmationModal` is now built on the accessible `Dialog` primitive: focus
    trap, Escape-to-close, focus restoration to the trigger, and body scroll-lock.
    Its confirm button now goes through the shared `Button` variant system
    (`destructive` for `danger`) instead of a re-implemented class string. Public
    prop API is unchanged.
  - `Tooltip` is rebuilt on `@radix-ui/react-tooltip`: the trigger is a focusable
    button (keyboard- and screen-reader-reachable), Radix supplies `role="tooltip"`
    and collision-aware placement, and content portals into the nearest
    Dialog/Sheet when nested. The `{ content, className }` API is unchanged; a new
    optional `children` prop allows a custom trigger.
  - Form primitives gain additive accessibility props: `Input` accepts `invalid`
    (destructive styling + `aria-invalid`), `Label` accepts `required` (token-
    colored `*` plus an `sr-only` "(required)" so the requirement is not color-
    only), and a new `FormError` component renders `role="alert"` inline errors.
    `DynamicForm`/`FormField` wire these (`aria-invalid` + `aria-describedby`) for
    fields with inline validation errors. No existing call site changes.

- 8cad340: Add a shared formatting module (`@checkstack/ui` `src/formatting/`) of pure,
  framework-agnostic, locale-aware helpers, re-exported from the package root:

  - `formatDate(date)` / `formatDateTime(date)` - short locale-aware date / date-
    time strings. They pass an `undefined` locale (runtime locale) rather than a
    hardcoded one, accept `Date | string | number`, and return `""` for absent or
    invalid input.
  - `formatRelativeTime(date)` - "5 minutes ago" / "in 2 hours" via `date-fns`'
    `formatDistanceToNow` (the single chosen relative-time engine).
  - `formatNumber(n, opts?)` - locale-aware thousands separators via
    `Intl.NumberFormat` (integer display by default).
  - `formatBytes(bytes, opts?)` - defaults to BINARY units (1024-based,
    KiB/MiB/GiB) to match the cache runtime panel; pass `{ binary: false }` for
    decimal (1000-based) units.
  - `formatPercent(value, opts?)` - input is a 0-1 ratio by default (`0.42` ->
    "42%"); pass `{ alreadyPercent: true }` for a 0-100 input, plus a
    `fractionDigits` option.
  - `formatDuration(ms)` - compact "2h 5m" / "30s" / "500ms" durations.

  This is purely additive; existing inline call sites are not yet migrated.

- 8cad340: Add four shared UX primitives to `@checkstack/ui`.

  - `Breadcrumb`: an accessible breadcrumb trail (`<nav aria-label="Breadcrumb">`
    - ordered list, current page marked `aria-current="page"`). `PageHeader` and
      `PageLayout` gain optional `breadcrumbs` (and `onBreadcrumbNavigate`) props
      that render it above the title; existing pages are unaffected (opt-in).
  - `CopyableValue`: a value plus copy button with toast feedback, an optional
    `shownOnce` warning style, and auto-select-on-mount for keyboard copy.
    Generalises the duplicated secret/DNS-record copy patterns.
  - `useUnsavedChanges`: a dirty-form guard that installs a `beforeunload`
    listener and intercepts in-app navigations via react-router's `useBlocker`,
    exposing `isBlocked` / `confirmDiscard()` / `cancelDiscard()`.
  - `useKeptPrevious`: keeps the previously-rendered list during a refetch to
    avoid layout jump and reports `isStale` for dimming.

### Patch Changes

- 8cad340: Consolidate the two search-trigger affordances onto a single source of truth.

  The hero `CommandPalette` (in `@checkstack/ui`) and the wired navbar trigger
  (`NavbarSearch` in command-frontend) had drifted in copy and shortcut-hint
  rendering. Both now draw their wording and keyboard hint from one shared place:

  - New `SEARCH_TRIGGER_LABEL` / `SEARCH_TRIGGER_PLACEHOLDER` constants and a
    platform-aware `SearchShortcutHint` component (⌘K on Mac, Ctrl+K elsewhere) in
    `@checkstack/ui`, consumed by both triggers so the copy and shortcut can no
    longer diverge.
  - The hero placeholder was corrected from the over-promising "Search systems,
    incidents, or run commands..." to the accurate "Search and commands...", and
    it now renders the same Mac/non-Mac shortcut hint the navbar uses.

  No behavioral change to the global Cmd/Ctrl+K listener.

- 8cad340: DynamicForm: clearing a number/integer field now maps to `undefined` instead of `NaN`, so empty values flow through the normal required-field path and partially-typed input (e.g. `-`, `1.`) no longer thrashes form state. Removing a non-trivial array item (a row with any user-entered value) is now gated behind the shared accessible `ConfirmationModal`; empty / just-added rows are still removed immediately.
- 8cad340: Fix an orphaned modal scrim that could block clicks after a Sheet/Dialog closes.

  The shared `Dialog` and `Sheet` overlays previously carried a
  `data-[state=closed]` exit animation. Because the overlay is a full-screen,
  `pointer-events: auto` scrim, that exit animation made its removal depend on
  an `animationend` event reaching Radix's `Presence` state machine. When a
  second dialog/sheet opened while the first was still mid-close (for example,
  closing an automation trigger Sheet and immediately opening the "Add step"
  Dialog), the closing overlay's animation could be interrupted and its
  `animationend` never landed. `Presence` then stayed in `unmountSuspended` and
  the dim scrim was orphaned in the DOM, intercepting every subsequent click
  (the Save button appeared visible and enabled but clicks never landed).

  The overlay now animates in only. With no exit animation,
  `getComputedStyle(overlay).animationName` is `"none"` on close, so Radix
  unmounts the overlay synchronously - no event dependency, no orphan. The
  dialog/sheet Content still animates out, so the visible motion is unchanged.
  Scroll-lock, focus return, and the nested-sheet portal-into-content behavior
  are untouched.

- 8cad340: Improve small-viewport layout and touch targets across several admin surfaces.

  The announcement editor's two `grid grid-cols-3` form rows (Severity / Visibility
  / Display Mode and Status / Starts / Expires) now stack with
  `grid-cols-1 sm:grid-cols-3`, so the three `Select` controls are no longer
  crushed into ~100px columns inside the dialog on a phone. The GitOps provenance
  summary cards switch from a fixed `grid-cols-4` to `grid-cols-2 sm:grid-cols-4`
  so the counts and labels do not overflow at narrow widths.

  The shared `IDELayout` now becomes two-pane at `md` instead of only `lg`, giving
  tablets a side-by-side tree + editor, and the `IDEStatusBar` issue list now wraps
  (`flex-wrap`) instead of hiding issues behind a horizontal scroll.

  Inline icon-only action buttons that previously used `size="sm"` (36px tall) now
  use `size="icon"` (40px square) to meet touch-target guidance: the announcement
  table/card edit and delete actions, and the status-page builder block
  move-up/move-down/remove actions. These are styling-only changes with no behavior
  or layout-structure changes beyond the responsive breakpoints noted above.

- 8cad340: Add recovery actions to the 404 page and make infrastructure tabs deep-linkable.

  The `NotFound` page now offers two secondary recovery actions alongside "Back
  to Dashboard": a "Search" button that opens the global command palette (⌘K /
  Ctrl+K) and a "Browse docs" link to the user guide. The playful falling-"4"
  design is unchanged.

  The Infrastructure Settings page now drives its active tab from a `?tab=<id>`
  URL search param instead of local component state, so the selected tab
  (Queue/Cache/…) is linkable, bookmarkable, and restored on reload. It falls
  back to the first visible tab when the param is absent or invalid.

- 8cad340: Make toast placement responsive and cap the visible toast stack.

  The toast container was hard-pinned to `top-4 right-4` with a `max-w-md` width
  on every viewport and no limit on how many toasts stacked at once. On narrow
  screens that produced a cramped, off-to-the-side column that could grow without
  bound.

  Toasts now render full-width inset at the bottom (`inset-x-4 bottom-4`) below
  `sm`, and revert to the familiar top-right card stack (`sm:top-4 sm:right-4`,
  `sm:max-w-md`) from `sm` upward. At most three toasts render at once; any older
  queued toasts surface a subtle "+N more" indicator and become visible as the
  most-recent ones auto-dismiss or are dismissed. Per-toast auto-dismiss,
  hover-to-pause, and the public `toast.success/error/warning/info/show` API are
  unchanged.

- 8cad340: Align a few components with semantic design tokens and the library's
  focus-visible convention. `StatusCard`'s gradient variant now derives from
  `--primary` (`from-primary to-primary/80 text-primary-foreground`) instead of
  hardcoded indigo/purple and literal `text-white`, so it tracks the theme.
  `LoadingSpinner`'s track uses `border-muted border-t-primary` instead of
  `border-indigo-200 border-t-indigo-500`. The `Dialog` and `Sheet` close ("X")
  buttons now use `focus-visible:ring-*` to match `Button`/`Checkbox`, so the
  ring only shows on keyboard focus. No behavioral or visual changes beyond the
  token/theme alignment.
- 8cad340: UX consistency sweep in the shared UI library:

  - `TerminalFeed` now formats its entry timestamps with the shared, locale-aware
    `formatTime` helper instead of a hardcoded `en-US` `toLocaleTimeString`, so
    the terminal clock follows the runtime locale. Added `formatTime` to
    `@checkstack/ui`'s formatting module (24-hour time-of-day with seconds).
  - Swapped raw success palette literals for the semantic `--success` token so
    success states render consistently and respect dark mode: `ScriptTestPanel`
    (`text-emerald-500` -> `text-success`), `IDELayout` status bar
    (`text-green-500` -> `text-success`), and `EditableText`'s save button
    (`text-green-*`/`dark:` variants -> `text-success hover:text-success/80
hover:bg-success/10`).

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/template-engine@0.4.6

## 1.16.2

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0

## 1.16.1

### Patch Changes

- 551eaa9: Fix native scrollbars and form controls staying light in dark mode.

  The app never declared a `color-scheme`, so Chromium/Edge and Firefox painted
  native scrollbars (e.g. the sidebar) and form controls in the OS default (light)
  regardless of the active theme. Declaring `color-scheme: light` / `dark` on
  `:root` / `.dark` makes them follow the theme.

- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
  - @checkstack/common@0.16.0
  - @checkstack/frontend-api@0.10.0
  - @checkstack/template-engine@0.4.5

## 1.16.0

### Minor Changes

- 6005271: Add AI "skills" - reusable prompt templates for the chat assistant and the
  `ai_analyze` automation action. A skill bundles a system-prompt fragment, an
  optional starter prompt, and (for analyze) suggested output fields, tagged with
  the surfaces it targets.

  Skills come from two sources merged into one catalogue: builtin skills
  contributed by core/plugins via the new `aiSkillExtensionPoint`, and GLOBAL
  user skills authored by operators (new `ai_skill` table) and visible to everyone
  who can read skills. New access rules `ai.skill.read`, `ai.skill-create.manage`
  (a dedicated create permission), and `ai.skill.manage` (edit/delete, author-only
  with admin moderation) gate the feature - all default-on, admin-revocable.

  The chat composer gains a skill picker (its system prompt seeds the turn, its
  starter prompt seeds the message box); the `ai_analyze` action gains an optional
  `skillId` that seeds the system prompt, prompt (when blank), and output fields
  (when none) - explicit config always wins. A new "AI skills" settings page lets
  operators browse, view full details (prompts + output fields), publish, edit,
  and delete their global skills. Ships six builtin skills across chat and analyze.

  To support rich pickers, `@checkstack/ui`'s `DynamicForm` gains a `catalog`
  options style (`x-options-style: "catalog"`, with resolver options carrying an
  optional `description`) that renders a browsable modal of cards instead of a
  plain Select, and `@checkstack/backend-api` propagates the new annotation. The
  shared `PageHeader` now wraps a long subtitle beside its actions instead of
  letting them overlap.

### Patch Changes

- Updated dependencies [079369a]
  - @checkstack/template-engine@0.4.4

## 1.15.1

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

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/common@0.15.0
  - @checkstack/template-engine@0.4.3

## 1.15.0

### Minor Changes

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

### Patch Changes

- 9d8961c: Fix the double-scrolling on the AI chat page (`/ai/chat`). The page sized its
  layout with a fixed `calc(100vh - 220px)` height, which overshot the available
  space when the page subtitle wrapped to two lines - so the whole page scrolled
  on top of the message list's own scroll.

  `PageLayout` gains an opt-in `fillHeight` prop that fills the viewport via a
  bounded flex height chain (established in the app shell) instead of viewport
  math; the chat page uses it so only the message list scrolls and the page itself
  never does. Normal document-flow pages are unaffected (they still scroll the
  main area as before).

- Updated dependencies [fb705df]
  - @checkstack/frontend-api@0.8.0
  - @checkstack/common@0.14.1
  - @checkstack/template-engine@0.4.2

## 1.14.0

### Minor Changes

- ed251b6: Make `@checkstack/ui`'s Monaco `CodeEditor` render in standalone `bun run dev`, and consolidate the Monaco editor Vite settings into one shared helper so they can't drift.

  - **Shared config (now in `@checkstack/ui`).** `@checkstack/ui` exports a `monacoViteConfig` helper (`@checkstack/ui/src/vite-monaco`) with the editor's Vite settings - `worker.format: "es"` and the `vscode` resolve alias (so `require("vscode")` doesn't leak into the browser). `@checkstack/ui` owns `CodeEditor` and the editor dependencies, so all three consumers now share one source: the app's `vite.config.ts`, `@checkstack/dev-server`, and `@checkstack/ui`'s own Storybook config (each previously hand-rolled its own copy).
  - **Pre-built workers (dev server).** In a standalone plugin, `@checkstack/ui` is a _pre-bundled npm dependency_, and Vite's dependency optimizer can't process the Monaco language workers it imports via `?worker&url` - the dev server used to crash (and serving `@checkstack/ui` as source instead broke the CJS/ESM interop of its other deps). The dev server now pre-builds the three Monaco workers (editor / TypeScript / JSON) into static ES-module bundles, serves them, and redirects the `?worker&url` imports to them via `resolve.alias` (which applies during pre-bundling). `@checkstack/ui` stays pre-bundled and the workers resolve, so the editor renders. Builds are content-addressed and cached under `node_modules/.cache/checkstack-dev-monaco` (concurrency-safe atomic promotion), so only the first run after a dependency change pays the build cost. React is deduped so the editor's hooks share the dev shell's React instance.

- 968c12f: Make installed (runtime) frontend plugins actually load, via Module Federation 2.0. Previously a packed external plugin's frontend could not run: the host only shared React/router with runtime plugins, and there was no working way to share the framework/UI singletons (hand-rolled import-map externalisation hit an unsolvable rolldown CJS-interop wall).

  - **Host (`@checkstack/frontend`)** now uses `@module-federation/vite` as an MF host and loads runtime plugins through the MF runtime (`registerRemotes` + `loadRemote`) instead of a raw `import()`. The shared set (react, react-dom, react-router-dom, @tanstack/react-query, @checkstack/frontend-api) is owned by the host; plugins reuse those exact instances via the share scope. The old hand-rolled vendor build + import map are removed.
  - **`@checkstack/ui`** is bundled per consumer (tree-shaken); its Theme / Toast / Performance React contexts are unified across the host and bundled-in-plugin copies via a registered (globalThis-keyed) context, so a plugin's `useTheme`/`useToast`/`usePerformance` resolve to the host's providers. The ONE exception is the Monaco / VS Code **CodeEditor**, now exposed as the `@checkstack/ui/code-editor` subpath and shared as an MF singleton: the host owns the single editor instance (and builds its `?worker&url` workers), and plugins reuse it. A plugin can now render `<CodeEditor>` (directly or via `ScriptTestPanel` / template/JSON fields) without bundling Monaco.
  - **Scaffold + pack (`@checkstack/scripts`)** build frontend plugins as MF remotes (`vite build` with the federation plugin, exposing `./plugin`, manifest enabled, DTS disabled). The CodeEditor is shared with `import: false` so the plugin is a consume-only participant - it never bundles a local fallback of the editor, keeping the heavy `@codingame/*` / `monaco-languageclient` / `vscode` subtree out of the plugin entirely (so no `vscode` alias or ES-worker config is needed in the plugin build). `plugin-pack` builds frontend packages with `NODE_ENV=production` (the MF plugin skips the remote under `NODE_ENV=test`) and ships only `dist/`. The scaffolded route now declares a `nav` entry so it appears in the sidebar.
  - **Backend (`@checkstack/backend`)** serves a plugin's MF assets under its (possibly scoped) package name (`/assets/plugins/@scope/name/*`), with correct content types, and the SPA catch-all defers those paths so the federation manifest/remoteEntry are not shadowed by `index.html`.

  Verified end-to-end by the external-plugin install E2E (scaffold → pack → install via the Plugin Manager UI → frontend + backend + co-loaded core plugins all work).

### Patch Changes

- @checkstack/common@0.14.1
- @checkstack/frontend-api@0.7.2
- @checkstack/template-engine@0.4.2

## 1.13.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/template-engine@0.4.2

## 1.13.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/frontend-api@0.7.1
  - @checkstack/template-engine@0.4.1

## 1.13.0

### Minor Changes

- 9dcc848: AI chat UX: ordered turns, readable diffs, persistent errors, auto-titles, decision acknowledgments, and a smarter topical guard.

  - Turns render as ordered parts (text / tool-call status / confirm card) in chronological order, with inline tool-error lines and a mid-turn "Thinking..." indicator, instead of one text blob plus a flat tool list. The confirm card and tool-step parts no longer vanish after a turn finishes (hydration seeds once per conversation id via `useInitOnceForKey`, so background refetches are no-ops).
  - Errors persist: in-stream provider errors are lifted into the chat hook's durable error state and shown in a dismissible banner with selectable text and a Copy button (single-line digest, full text on hover); it clears on send / open / new chat. The backend installs an `onError` handler that logs the provider's full HTTP response and returns a readable message, and normalizes the model message history (drop empty rows, merge consecutive same-role rows, strip a leading non-user row) so a single provider hiccup can no longer brick a conversation.
  - Confirm/applied card diffs render as a GitHub-style split diff (line-number gutters, per-line tint, word-level highlighting, an "Expand" pop-out). `computeFieldDiff` recurses into arrays element-wise so a single changed leaf is pinpointed instead of dumping whole serialized arrays.
  - Conversations auto-title after the first user message (cheap `generateText` reusing the turn's model, fire-and-forget, heuristic fallback). "New chat" opens immediately and reuses an empty untitled draft instead of spawning duplicates; "Delete" is a soft archive (`archived_at` on `ai_conversations`, data retained). A clean model picker always renders a `Select` of `[defaultModel, ...availableModels]` de-duplicated.
  - The assistant acknowledges a confirm-card decision (a new `decision` mode -> `streamDecision`) instead of going silent after an apply/decline; the decision note is derived server-side from the stored proposal and is ephemeral.
  - A cheap topical pre-classifier short-circuits off-topic turns with a canned refusal (fail-open, spend recorded). It marks meta/capability/greeting/how-to questions as ON_TOPIC; only clearly unrelated requests (coding help, creative writing, trivia) are refused.
  - The chat agent no longer emits duplicate proposals for one request: propose/auto-apply results carry an explicit model-facing "stop and wait" note, and a per-turn `<tool>:<argsHash>` dedupe short-circuits repeated identical mutating calls.
  - Assistant messages render through the shared `<MarkdownBlock>`: it now parses a SAFE subset of raw HTML (`rehype-raw` + `rehype-sanitize`) so native `<details>`/`<summary>` widgets render, and enables `remark-gfm` so GFM tables, strikethrough, and autolinks render (the assistant often summarizes drafts as tables).

  State and scale: the archive marker, titles, and permission mode all live in the shared `ai_conversations` table, read identically on every pod; the classifier holds no state and its spend is recorded in the shared `ai_spend` ledger. No new pod-local state.

  This is a beta minor.

- 9dcc848: Plugin-owned AI tools: every domain plugin contributes its own AI tools (chat assistant + automation AI action), and `ai-backend` is platform-only.

  Every plugin-specific AI tool is owned by the plugin whose domain it acts on, registered via that plugin's own `aiToolExtensionPoint` / `aiToolProjectionExtensionPoint` from its init - the same path an external plugin author uses. `ai-backend` no longer imports or depends on any capability plugin's `*-common`; the dependency direction is strictly plugin -> ai-platform. Pure helpers (`computeFieldDiff`, capability-summary, `ScriptContextKind`) live in `@checkstack/ai-common`.

  Tools shipped:

  - Health checks and automations: full CRUD - `healthcheck.propose` / `automation.propose` and `*.update` (`mutate`, deep-validated) and `*.delete` (`destructive`, always confirm-gated). `healthcheck.propose`'s dry-run calls the new deep `validateConfiguration` so propose-time validation matches apply-time. Assertions are validated against the collector's result schema and the canonical operator vocabulary. Capability-catalog tools (`ai.listCapabilities`, `ai.getCapabilitySchema`), script context tools (`ai.getScriptContext`, `ai.testScript`), and notify-subscriber tools (`healthcheck.notifySystemSubscribers` / `...GroupSubscribers`).
  - Catalog: `catalog.createSystem` / `updateSystem` / `createGroup` / `updateGroup` (`mutate`), `catalog.deleteSystem` / `deleteGroup` (`destructive`), membership tools (`mutate`), plus `catalog.listSystems` / `listGroups` read projections.
  - Incident: `incident.create` / `update` / `addUpdate` / `resolve` / `addLink` (`mutate`), `incident.delete` / `removeLink` (`destructive`), and `incident.get` / `incident.list` read projections.
  - Maintenance: `maintenance.create` / `update` / `addUpdate` / `close` / `addLink` (`mutate`), `maintenance.delete` / `removeLink` (`destructive`), and `maintenance.list` / `get` read projections.
  - Read projections for SLO (`slo.listObjectives`), dependency (`dependency.list`), incident (`incident.list`), healthcheck (`healthcheck.status`), and anomaly (`anomaly.explain`), each gated by the source procedure's own access rule and routed as the principal.
  - Documentation grounding: `ai.searchDocs` / `ai.getDoc` over a build-time bundled docs index (BM25-ish ranking), so the assistant grounds how-to answers in Checkstack's own docs offline.
  - URL introspection: `ai.probeUrl`, an SSRF-guarded read tool the assistant uses to inspect a real endpoint before drafting a health check. Update tools compute a before -> after field diff rendered on the confirm card (approve mode) or an "Applied" card (auto mode), so a change is never silent.

  `ai_analyze` automation action (automation-backend, with an editor connection picker + audited tool calls): runs a bounded AI agent on the run context as the automation's `runAs` service account, so it can never exceed that identity's permissions; destructive tools are never offered; mutating tools auto-apply through the service account's client. Produces an `automation.analysis` artifact downstream actions can branch on. The agent loop is exposed as a headless `aiAgentRunnerRef` service so automation-backend can drive it without depending on ai-backend.

  `notification.notifyForSubscription` is now callable by user / application principals holding `notification.send` (previously service-only). Every tool routes through the user-scoped client, so handler-side authorization is enforced exactly as a direct UI/RPC action; the resolver gate plus the propose/apply re-check at propose AND apply are the additional authority. A systemic authz regression test asserts every registered tool falls into exactly one safe authorization category.

  A new `ai_transport` enum value `automation` records the AI action's tool calls in the `ai_tool_calls` audit log. No new durable state beyond that; each tool is a thin, deterministic wrapper over an existing RPC, so every pod behaves identically.

  This is a beta minor.

- 9dcc848: Redesign the dashboard as an extensible "needs attention" overview, and normalize system state badges.

  The dashboard now surfaces ONLY systems that need attention (degraded, unhealthy, breaching/at-risk SLO, under an incident or active maintenance, anomalous, or with a dependency problem) and hides everything healthy. A compact header summarises fleet health and filters by severity; each problem renders as an elevated card with one row per issue that deep-links to where the issue originates. A calm "all clear" state shows when nothing needs attention, a live "recent activity" feed sits below, and a "View catalog" link replaces the duplicated system list.

  New platform contract `SystemSignalsSlot` (`@checkstack/catalog-common`): a headless, render-once slot where any plugin bulk-fetches and reports structured `SystemSignal[]` per system via `onSignals(sourceId, map)`. The dashboard aggregates every source agnostic to which plugins contribute; each core reliability plugin (healthcheck, incident, SLO, maintenance, anomaly, dependency) ships a filler, and third-party plugins add new per-system state the same way with no dashboard change. Signals carry an `iconName` rendered via `DynamicIcon` so the contract stays React-free. The dashboard's old summary tiles and overview sheets are removed, so it no longer depends on those plugins' packages. The group "subscribe" control moved onto the catalog browse page's group headers.

  System state badges are normalized into one icon-only `@checkstack/ui` `StatusBadge` primitive - a small tinted icon chip with the full label on hover/focus (and via `aria-label`). Each signal uses its feature's navbar icon (health = Activity, incident = AlertTriangle, SLO = Target, maintenance = Wrench, dependency = GitBranch; anomaly = ChartSpline). Badges self-sort by severity via CSS `order` (error -> warn -> info), tooltips are scoped to a named group, and in catalog browse rows the cluster moved to the right edge.

  This is a beta minor.

- 9dcc848: Surface integration connection validation errors inline, and fix blank secrets clearing stored credentials on edit.

  `@checkstack/ui` `DynamicForm` gains opt-in, backward-compatible props plus pure DOM-free helpers:

  - `showInlineErrors` (default `false`): renders a concise per-field error under each touched required field; the `onValidChange` validity boolean derives from the same per-field error map.
  - `fieldErrors`: an externally-supplied `{ [fieldPath]: message }` map (dot-joined for nested fields) for surfacing SERVER validation inline; nested paths flag their parent.
  - `keepExistingSecretFields`: in EDIT mode, lists `x-secret` keys already stored server-side - a blank input means "keep existing" and is treated as VALID (CREATE mode omits it). New exported helpers: `deriveClientFieldErrors`, `deriveServerFieldErrors`, `parseServerValidationData`, `omitKeepExistingSecrets`, `listSecretFieldKeys`. `DynamicForm` also no longer shows a required (`*`) marker on the child fields of an OPTIONAL nested object while that object is empty (e.g. the OpenAI-compatible `spendCap`); required nested objects are unchanged.

  `@checkstack/integration-backend`: connection-config validation failures attach the structured zod issues to `ORPCError.data` under a `CONFIG_VALIDATION` discriminator; the human-readable message is unchanged.

  `@checkstack/integration-frontend` `ProviderConnectionsPage`: validation failures appear inline on the offending fields (the toast remains a fallback); Create/Save stays disabled while invalid; on edit a blank `x-secret` field is treated as "keep existing" (no required error, omitted from the update so the stored secret is not cleared).

  BREAKING CHANGES: none. The new `DynamicForm` props are optional and default to previous behavior.

  This is a beta minor.

- 9dcc848: Add environments as a first-class catalog primitive, with per-environment health-check fan-out, config templating, per-environment reactive health, and script run-context exposure.

  - Catalog primitive: an environment is a sibling of groups - a named, instance-global record carrying free-form custom fields (baseUrl, region, tier, ...) that any system can belong to many-to-many. New `environments` + `systems_environments` tables, `EnvironmentSchema` + create/update schemas, `EntityService` environment CRUD and membership joins, RPC endpoints gated by a new `catalogAccess.environment` access rule, a GitOps `Environment` kind + `System.environments` extension, and frontend management (an `EnvironmentEditor`, an Environments management panel, and a per-system environment picker). The Environments card's Add/Edit/Delete affordances are gated on `catalogAccess.environment.manage`.
  - Per-environment fan-out: run identity becomes `(systemId, configurationId, environmentId)`. Runs, aggregates, and state transitions gain a nullable `environmentId`. The health-check assignment gains an `environmentIds` selector with three modes (All / Specific / None; `null` and `[]` are distinct). The queue executor resolves the effective environment set via the catalog `resolveSystemEnvironments` read and executes one isolated run per environment.
  - Config templating: a new `x-templatable` config-field marker renders a string field through the template engine at execute time, against `{ environment, check, system }`. A shared `renderTemplatableConfig` and a `renderTemplatePreview` helper (re-exported from `@checkstack/template-engine`) keep editor previews identical to the run-time render. The HTTP collector's `url`, `headers[].value`, and `body` are templatable, rendered per environment (the strategy client build moves inside the per-env loop); the `url`'s `.url()` validation moves post-render. Secrets resolve before templating; a field marked both secret and `x-templatable` is rejected at plugin load. `DynamicForm` shows a live "Preview" line, and the catalog `EnvironmentPreviewPicker` ("Preview as: <environment>") drives it in the collector editor (only when the schema has a templatable field).
  - Script run-context: `CollectorRunContext` gains an optional `environment` field (`{ id, name, fields }`, metadata only). Shell collectors receive `CHECKSTACK_ENV_ID` / `_NAME` / `CHECKSTACK_ENV_<FIELD>` vars; inline TS collectors read `globalThis.context.environment`; the editor test panel mirrors both. The env-less path is unchanged.
  - Per-environment reactive health (see BREAKING below), env-keyed read/write paths, env-qualified serialization locks, an optional `trigger.payload.environmentId`, per-environment isolation, and an `ENVIRONMENT_RESOLUTION_FAILED` signal when catalog resolution degrades to a single env-less run.

  BREAKING CHANGES: the reactive `health` entity's id-shape and cardinality change. It now encodes two views: per-environment (id `"<systemId>::<environmentId>"`) and a system rollup (id `"<systemId>"`, the worst status across environments + env-less runs). The rollup PRESERVES the pre-existing system-level contract - dashboards, status badges, and automations referencing health by `systemId` keep working without re-authoring - but the entity's contract surface changed (new id-shape, higher cardinality, new payload field), so it is flagged breaking. `getBulkHealthState` parses env-qualified ids and keys results by the original id.

  State and scale: membership and custom fields live only in catalog Postgres and are re-read every tick via the cross-plugin RPC; env-keyed health reads from shared `health_check_runs` / aggregates / transitions (compute-on-read). Every pod resolves the same effective set and the same per-environment health. No pod-local environment state.

  Also: `unwrapSchema` in `zod-config.ts` loops instead of single-pass-stripping so multi-layer wrappers (`.optional().default()`) still resolve `x-templatable` meta. The env-less `{{ environment.* }}` run notice logs at `debug` (a legitimate recurring configuration), while the post-render HTTP `.url()` check still fails a genuinely-broken empty render with a clear "Rendered URL is invalid" error.

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

- 9dcc848: Add the auto-generated, version-pinned `@checkstack/sdk` package + codegen, and serve its types live to the in-app editor.

  - A new committed workspace package `@checkstack/sdk`, generated from the platform's source of truth by `scripts/generate-sdk.ts` (`generate:sdk` / `generate:sdk:check`): a fully-typed oRPC client (`createCheckstackClient`) over the REST surface with one `InferClient` per plugin contract, real script-authoring helpers (`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`) whose runtime body is the same identity function the in-app runner injects, per-subpath `.d.ts` under the package `exports` map, and an editor-only ambient bundle. A `generate:sdk:check` CI guard fails when the committed SDK files drift from a fresh generation. The `@checkstack/sdk` version is stamped from `@checkstack/release` and MUST NOT appear in a changeset (a guard enforces this); the `@checkstack/release` bump here advances the release version so the generated SDK can be published later. The generated client also normalizes its base URL without a backtracking-prone regex, closing a CodeQL `js/polynomial-redos` finding.
  - Live editor type injection: a new version-keyed route `GET /api/script-packages/sdk-types/:releaseVersion` (raw handler in `@checkstack/script-packages-backend`) serves the generated SDK editor bundle with `Cache-Control: private, max-age=1y, immutable`; the pure path-build/parse module lives in `@checkstack/script-packages-common`, shared by backend and frontend. A mismatched version returns `409` so the editor refetches and never serves stale types after an upgrade. The frontend `useSdkTypeInjection` hook fetches the bundle once per session and mounts it into Monaco via `addExtraLib`. Schema-narrowed `context.config` / `context.event.payload` editor types stay local; the package-resolving module declarations come from the one published `@checkstack/sdk` source.

  BREAKING CHANGES: the script-authoring import surface moves from the bare `@checkstack/healthcheck` / `@checkstack/integration` virtual modules to the `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration` subpaths of the published `@checkstack/sdk` package. The old bare-name imports no longer resolve (an old import now errors in the editor, surfacing the migration). Existing scripts must update the module specifier:

      - import { defineHealthCheck } from "@checkstack/healthcheck";
      + import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

      - import { defineIntegration } from "@checkstack/integration";
      + import { defineIntegration } from "@checkstack/sdk/integration";

  The helper names and their runtime behaviour are unchanged - only the module specifier moves. The global (no-import) helper form continues to work unchanged.

  This is a beta minor.

- 9dcc848: Guard component animations behind isLowPower, and add a shared inline Spinner.

  - `@checkstack/ui` shared components (`Tabs`, `ConfirmationModal`, `Accordion`, `CodeEditor` popout-button backdrop blur) now drop their `animate-*` / `backdrop-blur` classes when the device reports the low-power tier, matching `LoadingSpinner` / `Skeleton`. No public API change; normal-power rendering is unchanged.
  - A new shared inline `Spinner` (`@checkstack/ui`) renders a lucide `Loader2` whose `animate-spin` is gated internally behind `usePerformance().isLowPower`, so call sites inherit the low-power guard. Props: `size` (`sm`/`md`/`lg`), `className`, rest spread to the icon; decorative by default (`aria-hidden`), `role="status"` when given `aria-label`. The hand-rolled `Loader2` button/table spinners in `HealthCheckDrawer`, `HealthCheckRunsTable`, `IncidentEditor`, `IncidentUpdateForm`, `ProviderConnectionsPage`, `MaintenanceEditor`, `MaintenanceUpdateForm`, `UserChannelCard`, and `DynamicOptionsField` are migrated onto it.
  - Remaining unguarded `animate-*` / `animate-in` / blur classes across the auth, gitops, healthcheck, incident, integration, maintenance, and notification frontends are gated behind `usePerformance().isLowPower`, so effects degrade gracefully on low-power devices per the performance rule.

  Normal-power behavior is unchanged; low-power rendering drops the animations.

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
  - @checkstack/common@0.13.0
  - @checkstack/template-engine@0.4.0
  - @checkstack/frontend-api@0.7.0

## 1.12.0

### Minor Changes

- b995afb: Redesign the automation visual editor to a Home-Assistant-style collapsed-card UX.

  Every item in all three sections (actions, triggers, conditions) now renders as a compact summary row by default - icon, title, and a one-line summary derived from its config. Clicking the row opens the item's full configuration in a right-side sheet that edits the same live definition (no draft/commit step), so closing the sheet keeps the changes. The saved `definition` is unchanged - only the editor presentation - so the visual and YAML views still round-trip losslessly.

  - `@checkstack/ui` `ActionCard` gains three optional, backward-compatible props: `onOpenSheet` (turns the card into a non-expanding summary row that opens a host-supplied sheet on header click), `summary` (the compact one-line hint shown under the title), and `actions` (a typed `ActionCardMenuItem[]` rendered as a three-dot overflow menu). The new `ActionCardMenuItem` type is exported. Existing inline-expand usages are unaffected when the new props are omitted.
  - Per-card commands move into the overflow menu: Disable/Enable, a new Duplicate, and Delete. The drag grip stays on the action card header; actions keep dnd-kit reordering and the parallel id array. Triggers and conditions remain non-reorderable.
  - Duplicate clones an item with fresh, unique ids (via the existing id helpers) and inserts it directly after the original, keeping the editor's parallel id array in sync.
  - Composite actions (choose / parallel / repeat / sequence) keep nesting: a child card inside a parent's sheet opens its OWN sheet, stacking via Radix Dialog's portal + overlay.
  - Cards with validation errors auto-open their sheet and show an error badge on the collapsed row, so problems are never hidden behind a collapsed row plus a closed sheet.

- 270ef29: Add the sensing-layer editor UX (Wave 2 Phase 19) - the visual widgets for the duration-aware and structured-condition building blocks from Phases 15-18.

  - New `@checkstack/ui` components (each with a Storybook story):
    - `DurationInput` - number + unit (`seconds` / `minutes` / `hours`) picker emitting the single-unit `Duration` object the backend accepts, so it round-trips losslessly through YAML.
    - `TimeOfDayInput` - HH:MM (24h) input emitting the `"HH:mm"` string the `time` condition's `after` / `before` accept. Both are plain inputs (no animations), so no `usePerformance` gating is needed.
  - `DynamicForm`'s `FormField` gains an additive `x-duration` / `format: "duration"` branch that renders `DurationInput` for schema-driven duration configs. (Additive alongside the existing dispatch; reconciles cleanly with the parallel branch's `FormField` edits.)
  - The `ConditionEditor` kind selector gains `numeric_state` / `time` / `state` structured branches: an operator dropdown (above / below / between) + threshold for numeric, `TimeOfDayInput` + weekday toggles + timezone for time, and a status dropdown + optional `DurationInput` dwell for state. The raw-expression escape hatch is kept. Pure `kindOf` / `defaultForKind` helpers are split into a UI-free `condition-kind` module so they unit-test under bun (the UI barrel drags Monaco).
  - The trigger card gains a `for:` dwell toggle + `DurationInput` (Phase 15's schema was already round-tripping in YAML).

  Visual and YAML views stay lossless; structured conditions authored in either are editable in the other.

- b995afb: Surface inline-script type errors as automation action badges.

  Every inline `run_script` action in the automation editor is now type-checked
  against its generated `context` types continuously - including actions whose
  cards are collapsed - and any errors show up as the action card's error badge
  (and in the definition issue list), the same surface structural validation
  uses. Previously a type error was only visible as a red squiggle inside the
  open Monaco editor, so a broken script behind a collapsed card (or one
  invalidated by adding a new trigger) went unnoticed until runtime, where the
  bad property access silently read `undefined`.

  Validation runs entirely in the browser via the same standalone TypeScript
  worker the editor uses (new `validateTypeScriptSources` export on
  `@checkstack/ui`), so there is no backend round-trip. Each script is checked by
  prepending its generated `context.d.ts` to the source, which keeps the
  `context` global scoped to that one off-screen file and avoids colliding with
  any open editor. When an automation already contains scripts, a hidden editor
  boots the shared editor services on open so validation runs immediately rather
  than only after the first script card is expanded.

  This covers the automation currently open in the editor. Scripts in other
  automations, or definitions authored via YAML/API, are not type-checked here -
  that platform-wide coverage remains future work for a backend typecheck.

  Also: action cards no longer auto-open their detail sheet when they have
  validation issues; issues now surface only as the card badge, so multiple
  flagged actions no longer pop several sheets open at once.

- b995afb: Improve the automation Run Script secret → env mapping editor and script IntelliSense.

  - **Searchable secret picker with existence validation.** The secret → env mapping editor (`SecretEnvEditor`) now uses a searchable, keyboard-navigable combobox (modeled on `VariablePicker` / `PackageNameCombobox`, `isLowPower`-aware) populated from the secrets plugin's `listSecretNames`, replacing the plain `<input>` + `<datalist>`. A free-typed name still round-trips (a secret may be created later). When a row references a name that the loaded list does not contain, the row shows a non-blocking warning (red border + message); save is not prevented. The existence check lives in a pure, unit-tested `unknownSecretNames` helper.
  - **Clearer field description.** The `secretEnv` field descriptions on the `run_script` / `run_shell` actions no longer show the stored `${{ secrets.NAME }}` template (which is confusing in a UI that takes a bare name); they now describe the actual UI behavior and how the value is injected (`process.env.<ENV_NAME>` / `$<ENV_NAME>`) and masked.
  - **`process.env.<ENV_NAME>` autocomplete.** Declared `secretEnv` env-var names now autocomplete under `process.env.` in the Run Script (TypeScript) Monaco editor and are typed `string`, via an ambient `NodeJS.ProcessEnv` augmentation merged into the editor type definitions. New pure, unit-tested generators `generateSecretEnvTypes` and `secretEnvEnvNames` (exported from `@checkstack/automation-frontend`) drive this; the augmentation coexists with `@types/node`'s existing index signature.
  - **Shared combobox-interaction helper.** The "opens-then-immediately-closes" popover guard (`comboboxAnchorProps` / `isAnchorInteraction`) is promoted from `@checkstack/script-packages-frontend` into `@checkstack/ui` so the new secret picker and the existing package/version comboboxes share one implementation; the package comboboxes now import it from `@checkstack/ui` and the local copy is removed.

- b995afb: Add an "expand to overlay" popout to the shared `CodeEditor` so big scripts (shell / TypeScript / JavaScript) can be edited comfortably in a large full-screen overlay.

  Every consumer of `CodeEditor` (automation Run Script, healthcheck collectors, etc.) now gets a subtle "Expand editor" affordance (a `Maximize2` icon button) in the editor's top-right corner. Clicking it opens the shared `Dialog` at `size="full"` containing a large editor that fills the dialog.

  - The overlay editor is a second `TypefoxEditor` instance bound to the SAME `value` / `onChange` and all the same completion props (`typeDefinitions`, `templateProperties`, `shellEnvVars`, `markers`, `acquireTypes`, `acquireResetKey`, `importablePackages`, `language`, `readOnly`, `placeholder`), so IntelliSense / ATA / import-name / shell-var completion all work in the overlay exactly as inline. Both editors are controlled on the same value, so edits stay in sync and closing the dialog keeps them.
  - The overlay editor only MOUNTS while the dialog is open (lazy), so there is no second Monaco instance cost when closed. It uses a distinct `${id}-popout` model id so the two Monaco models don't fight over the same URI.
  - New opt-in `TypefoxEditor` prop `fillHeight`: when true the editor container uses `height: 100%` (with `minHeight` as a floor) instead of a fixed px height, so it fills the tall flex dialog body and Monaco's `automaticLayout` resizes to fit. Inline behaviour is unchanged when `fillHeight` is absent/false.
  - `CodeEditorProps` gains two additive optional props: `allowPopout` (default `true`; set `false` to hide the affordance) and `title` (override the overlay dialog title, which otherwise derives from `language`, e.g. "Edit script - TypeScript").
  - `TypefoxEditor` is now properly controlled: external `value` changes are applied to the live model (guarded by an equality check so a user's own edit is a no-op and there's no loop). This is what keeps the inline and popout editors in sync — editing one updates the other — and also fixes external resets (YAML→Visual, loaded definitions) reflecting in the editor.
  - `DialogContent`'s inner content wrapper gains `min-h-0 flex-1` so it fills the height when a consumer makes `DialogContent` a tall flex column (e.g. the popout body). Inert for the default non-flex dialog, so existing dialogs are unaffected.

  The `Dialog` already degrades its own animations under `usePerformance` / `isLowPower`; the popout button adds no heavy effects.

- b995afb: Suggest Node and Bun built-in modules in script-editor import-name completion.

  The import-specifier completion now also offers the always-available runtime built-ins (`node:fs`, bare `fs`, `bun`, `bun:test`, `node:crypto`, ...) alongside the installed allowlist packages. These are importable in the script sandbox regardless of the allowlist (the sandbox is a Bun subprocess, which provides Node's builtins plus its own `bun:` modules), and their types are already loaded ambiently, so completing one needs no lazy acquisition.

  - The built-in name list is DERIVED authoritatively at build time from the same bundled `@types/node` + `bun-types` declarations the editor injects: every importable built-in is a top-level `declare module "<spec>"`, so the generator (`scripts/generate-stdlib-types.ts`) now also parses those names (via the new pure `extractBuiltinModuleSpecifiers`) and emits `generated/builtin-modules.json`. No hand-maintained list - it auto-updates whenever the bundled types are regenerated. Wildcard / asset-glob ambient shims (names containing a star, e.g. asset globs or a `bun.lock` path glob) are filtered out.
  - The completion provider merges built-ins with the injected installed packages (deduped + sorted via the pure `mergeImportCompletionEntries`), labelling each via `detail` ("Node.js" / "Bun built-in" / "installed package"). Built-ins appear even when the allowlist is empty; the provider still only fires inside an import-string position and coexists with the TS worker's own completions.

  The existing node/bun stdlib TYPE hosting is unchanged (still injected from the separately code-split `stdlib-types.json` asset), so global completions (`process.*`, `Buffer`, ...) and member completions (`import * as fs from "node:fs"`) are unaffected. New pure helpers are fully unit-tested; the Monaco glue is untested per the no-DOM rule.

- 270ef29: Add in-UI script testing for automation `run_script` / `run_shell` actions.

  A new `testScript` RPC runs a TypeScript or shell script against an
  editable, auto-seeded sample context using the same sandboxed runner the
  real action uses, so operators can test scripts directly in the editor
  without dispatching a whole automation. Surfaces beneath any script field
  flagged `x-script-testable` via the new `ScriptTestPanel` /
  `ContextSampleEditor` components in `@checkstack/ui` and the
  `scriptTestRenderer` prop threaded through `DynamicForm`.

  - `@checkstack/automation-common`: adds the `testScript` contract +
    `ScriptTest*` schemas (gated by `automation.manage`).
  - `@checkstack/automation-backend`: implements `testScript` reusing the
    shared ESM / shell runners; central-only, time-bounded.
  - `@checkstack/backend-api`: new `x-script-testable` config-schema
    metadata propagated to the frontend JSON Schema.
  - `@checkstack/ui`: new `ScriptTestPanel` + `ContextSampleEditor`
    components and a `scriptTestRenderer` prop on `DynamicForm`.
  - `@checkstack/automation-frontend`: wires the test panel into the action
    editor.
  - `@checkstack/integration-script-backend`: marks the `run_script` /
    `run_shell` script fields as testable.

- b995afb: Autocomplete the import specifier itself in script editors.

  Lazy type acquisition only loads a package's types once its name is already in the buffer, so while you were still typing the import specifier (`import {} from "lod"`) there were no suggestions - the lazy-ATA catch-22. Script editors now suggest installed package names directly in import-specifier position; selecting one (e.g. `lodash`) inserts the name, and the existing ATA loop then loads its `@types/lodash` closure so members complete.

  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `importablePackages?: string[]` prop and a dedicated Monaco completion provider (registered once per `typescript`/`javascript` language, scoped to the editor's model, disposed on unmount). It fires ONLY when the cursor is inside an import/require module-specifier string - detected by a new pure, unit-tested helper `importSpecifierCompletionContext(lineUpToCursor)` that handles `from "…"`, bare `import "…"`, `require("…")`, and dynamic `import("…")`, returns the partial specifier + the replace range, and returns null once the string is closed or outside an import. Items are `kind: Module`, insert the bare name without touching the quotes, and coexist with (do not replace) the TS worker's own completions. Trigger characters: `"`, `'`, and `/` (for scoped subpaths); manual invoke (Ctrl+Space) also works. A new pure helper `importablePackageNames` filters a raw manifest name list (excludes `@types/*`, dedupes, sorts).
  - `@checkstack/script-packages-frontend`: `useScriptPackageTypeAcquisition()` now also returns `importablePackages`, derived from the installed manifest (what is actually resolvable at runtime) with `@types/*` companions excluded - you import `lodash`, never `@types/lodash` (the `@types` package still backs the closure types).
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: pass `importablePackages` into `DynamicForm` alongside the existing `acquireTypes` wiring, so both the Run Script action editor and healthcheck collector editors get import-name completion.

  The completion list is plugin-agnostic in `@checkstack/ui` (the names are injected); it never fires outside import-string positions, so normal completions are unaffected.

- b995afb: Fix package IntelliSense in script editors: lazy Automatic Type Acquisition (ATA) with proper `@types/*` resolution.

  Script editors (automation "Run Script (TypeScript)" and healthcheck collectors) now provide real autocomplete for installed npm packages. Importing a package whose types live in DefinitelyTyped - e.g. `import { debounce } from "lodash"` (lodash ships no own types; `@types/lodash` does) - now yields member completions. Previously no package completions appeared at all.

  Root cause: the old rollup wrapped each package's raw, multi-file `.d.ts` (with `export =`, `export as namespace`, and triple-slash `/// <reference path>` chains) inside a single `declare module "<name>" { ... }`, which the TypeScript worker silently rejected, and it truncated large type sets (lodash is ~866 KB across ~700 files) at a 256 KB cap.

  The fix registers the REAL declaration files at their `node_modules/...` virtual paths and lets TypeScript's own NodeJs + `@types` resolution do the work:

  - `@checkstack/script-packages-backend`: replaced `rollupPackageTypes` with a tree-driven closure extractor (`resolvePackageTypeClosure`). Given a bare specifier, it resolves against the materialized tree - own types via `package.json` `types`/`typings`/`exports` (bundled-types packages like `zod`/`dayjs`), the `@types/<mangled>` companion when it exists (`lodash` -> `@types/lodash`, scoped `@babel/core` -> `@types/babel__core`), or both, or neither (graceful empty, never a throw). It follows `/// <reference path|types>` and relative imports, includes each package's `package.json`, leaves every file UNWRAPPED, and surfaces a `truncated` flag instead of silently capping. Served from a new raw, HTTP-cacheable route `GET /api/script-packages/types/:lockfileHash/:specifier` (`Cache-Control: private, max-age=1y, immutable`), auth-gated by `script-packages.read`.
  - `@checkstack/script-packages-common`: **BREAKING** - replaced the `listPackageTypes` RPC procedure and `PackageTypesSchema { name, version, dts }` with `PackageTypeClosureSchema` (a `{ path, content }` file-map plus `hasOwnTypes`/`hasAtTypes`/`notFound`/`truncated`) served over the cacheable HTTP route. Added a shared `buildTypeAcquisitionPath`/`parseTypeAcquisitionPath` path contract.
  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `acquireTypes` resolver + `acquireResetKey`. On debounced buffer change it parses bare `import`/`require` specifiers (pure, unit-tested) and lazily fetches + registers each NEW package's closure via `addExtraLib` at `file:///node_modules/...`, deduped by a shared acquired-set that resets when the install hash changes. Compiler options set `moduleResolution: NodeJs`, `baseUrl: "file:///"`, and `typeRoots` so a bare import resolves to its `@types` companion. The `context` ambient global keeps working unchanged.
  - `@checkstack/script-packages-frontend`: replaced the old `useScriptPackageTypes` (which concatenated the broken `dts`) with `useScriptPackageTypeAcquisition()`, returning the `acquireTypes` resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as `acquireResetKey`.
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: wired the resolver into the Run Script and collector editors.

  State & scale: the type closure is derived on read from the materialized package tree (no new durable state). The editor's acquired-set is pod-local UI bookkeeping; the route is keyed by the cluster-wide `lockfileHash`, so the browser HTTP cache is correct across pods and only refetches after a new install changes the hash.

- b995afb: Fix the automation Run Script action's `secretEnv` (secret → env mapping) test wiring and tolerate bare secret names.

  - `@checkstack/ui` `ScriptTestPanel` now accepts the script field's declared `secretEnv` and renders an optional per-secret test-override input. The `ScriptTestRenderer` callback (DynamicForm) receives the SIBLING `x-secret-env` mapping value, located by annotation (not by field name), so a testable script field forwards it to the panel. Previously the test path never sent `secretEnv`, so `buildTestSecretEnv` got `undefined` and `process.env.<env>` was undefined in an in-UI test. Now an override-less test injects `__SECRET_<NAME>__` placeholders, and any operator override is masked from the output. Real secret values are still NEVER resolved in the test path.
  - `@checkstack/automation-frontend` forwards the action's `secretEnv` and the collected overrides to `testScript`.
  - `@checkstack/secrets-common`: the `secretEnv` mapping VALUE now accepts EITHER a `${{ secrets.NAME }}` template OR a bare secret name, normalizing a bare name to the canonical `${{ secrets.NAME }}` template on parse. This is a forgiving / NARROWING input change (more inputs accepted; stored/output form is unchanged and still the template), not a breaking change. Existing data and YAML shorthand like `secretEnv: { secret: SECRET }` now pass config validation instead of failing with "Must contain a ${{ secrets.NAME }} reference". Partial inline interpolation (e.g. `u:${{ secrets.pw }}@host`) keeps working unchanged; values that are neither a secret reference nor a valid secret name are still rejected.
  - `@checkstack/ui` `parseSecretName` tolerates a legacy bare secret name for display so the picker shows the same name for both the template and the bare form.

  The healthcheck collector test panel was checked: its config has no `x-secret-env` field, so it needed no secret wiring (only the `onRun` signature change, which is backward compatible).

- 270ef29: Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

  - Script consumers declare a least-privilege `secretEnv` allowlist
    (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
    `run_shell` actions resolve ONLY the declared secrets via
    `secretResolverRef.resolveForRun`, inject them into the runner env for
    that run (memory-only; the ESM runner gained a per-run `env` option), and
    mask their values out of stdout/stderr/result/error via the run-scoped
    masking context. A missing required secret fails the run clearly. No
    ambient secret access.
  - Test panel: `testScript` / `testCollectorScript` inject named
    `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
    overrides; real production values are never resolved in the test path,
    and overrides are masked out of the result.
  - Healthcheck collectors carry the `secretEnv` field for authoring +
    the test panel; runtime injection on satellites lands in Phase 3.
  - Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
    record fields with `${{ secrets.* }}` name autocomplete (from
    `listSecretNames`), wired into the automation action editor and the
    healthcheck collector editor. New `withConfigMeta` helper +
    `x-secret-env` config-meta key in `@checkstack/backend-api`.

- b995afb: fix(ui): make Popover/combobox lists scrollable inside a Sheet or Dialog

  A `Popover` (and the comboboxes built on it, e.g. the automation trigger Event
  picker, the secret-name picker, the package picker) portals its content to
  `document.body`. When opened inside a modal `Sheet`/`Dialog`, the dialog's
  `react-remove-scroll` scroll-lock blocked wheel/touch scrolling on that
  body-portaled content, so a long list's `overflow-y-auto` could not scroll.

  `SheetContent` and `DialogContent` now publish their content element through a
  `PortalContainerContext`, and `PopoverContent` portals INTO it when present.
  That keeps the popover inside the dialog's allowed-scroll subtree, so its lists
  scroll again. Radix positions popovers with `position: fixed`, so placement and
  clipping are unaffected; outside a Sheet/Dialog the popover still portals to
  `body` as before.

- 270ef29: Collapse `ScriptTestPanel` behind a compact disclosure by default.

  The inline script-test panel previously expanded its sample-context editor and results under every testable script field. It now defaults to collapsed: a compact "Test script" affordance shows, and the panel expands on demand. Running a test still auto-expands the results, and the last run's outcome surfaces as a badge while collapsed. A new `defaultOpen` prop opts back into the always-expanded behaviour.

## 1.11.0

### Minor Changes

- 41c77f4: feat(automation): deep + live definition validation surfaces invalid values, keys and ids — marked inline

  Previously `validateDefinition` only checked the structural shape via
  `AutomationDefinitionSchema`, where an action's `config` is typed as
  `z.record(z.unknown())`. So a bad config value (e.g. `level:
debugthisiswrong` on `automation.log`) passed validation, and switching
  to the visual editor just showed an empty dropdown with no explanation.

  **Backend — deep validation.** New `collectDefinitionIssues` walker
  validates the whole definition semantically, not just structurally:

  - unknown trigger `event` / action `action` ids,
  - each provider action's `config` against the registered action's own
    schema (wrong enum value, missing required field, wrong type),
  - each trigger's `config` against the trigger's `configSchema`,
  - **unknown / typo'd config keys** — object configs are validated in
    strict mode, so `levle: "info"` is reported rather than silently
    stripped,
  - recurses through `choose` / `parallel` / `repeat` / `sequence` so
    nested action configs are covered too.

  Issues come back with a dot-joinable `path` (e.g.
  `actions.0.config.level`, `triggers.1.event`). The `validateDefinition`
  RPC now returns these.

  **Frontend — live + inline.** The automation editor re-validates on
  every edit (debounced ~400ms) in BOTH tabs, and marks the offending
  content in place rather than in a separate alert panel:

  - **YAML tab** — issues (and YAML syntax errors) are squiggled at the
    exact node. `@checkstack/ui`'s `CodeEditor` gained a `markers` prop;
    the editor maps each issue's `path` onto the YAML document's node
    range via a new `computeYamlMarkers` helper (walking up to the
    nearest existing ancestor when a key is absent, e.g. a missing
    required field).
  - **Visual tab** — the specific card carrying an issue is marked: a
    destructive border + warning icon + the field-level messages. A
    `ValidationProvider` context partitions issues by owner (action card
    / trigger card / condition / top-level) using the action-node path
    grammar, so a nested action's config error attaches to the nested
    card, and a `choose`'s own `when` error attaches to the choose card.
    `ActionCard` gained an `errors` prop. So importing YAML with a bad
    value (the empty-dropdown case) now visibly flags the card instead of
    being silent.

  The big error alert is gone; the only residual panel is a slim fallback
  for the rare top-level issue that can't attach to any card.

  Note: strict config validation means an action whose config schema
  intentionally allowed extra keys would now flag them; action configs
  across the platform declare all their fields, so this only catches
  genuine typos.

- 41c77f4: fix(automation): editor UI fixes — action-config autocomplete, popup edge clamping + scroll, de-misleading action icon

  Four fixes to the automation editor's visual mode:

  - **Template autocomplete on action config fields.** A provider
    action's config form (e.g. `automation.log`'s `message`) rendered
    plain string fields with no `{{ … }}` autocomplete — only the
    condition/expression fields had it. `DynamicForm` gains a
    `templateCompletionProvider` prop; when supplied, default single-line
    string fields render a `TemplateValueInput` wired to it instead of a
    bare `Input`. The automation editor passes the staged template-mode
    provider, so config fields now get the same field / comparator / value
    / filter completion as conditions. Other `DynamicForm` consumers are
    unaffected (the prop is opt-in; without it string fields stay plain).

  - **Autocomplete popup no longer overflows the window.** The popup is
    now edge-aware: it flips above the input when there isn't room below,
    anchors to the input's right edge when a left-anchored popup would
    spill past the right edge, and caps its height to the available space
    (the list scrolls within it). The placement decision is extracted into
    a pure, unit-tested `computePopupPlacement` helper.

  - **Keyboard navigation scrolls the popup.** Arrowing through a list
    taller than the popup now scrolls the highlighted row into view
    (`scrollIntoView({ block: "nearest" })`) instead of leaving the
    selection off-screen.

  - **Action card icon no longer looks like a run button.** The "action"
    kind used a `Play` triangle, which reads as a test/run control but
    actually sits inside the card's expand toggle (so clicking it just
    collapsed the card). Swapped to `Zap`, the conventional
    automation-action glyph, which carries no "click to run" affordance.

  - **Inline-script actions get their typed runtime context.** The Monaco
    editor for `Run Script (TypeScript)` was falling back to an untyped
    default context because the editor never received type definitions.
    `useVariableScope` now also returns the `declare const context: …`
    declarations from `generateAutomationContextTypes` (already built, but
    never wired), and the provider action body forwards them to
    `DynamicForm` so `context.trigger.payload` is typed as the discriminated
    union over the automation's subscribed triggers, with
    `context.artifacts` / `context.var` / `context.repeat` in scope at the
    action's position. Shell scripts get their context the same way every
    other config string does: `{{ … }}` templates are expanded by the
    dispatch engine (`renderValue`) before the script runs, with the same
    field autocomplete as other template fields.

- 41c77f4: feat(automation): native per-editor context for script actions (typed `context` for TS, `$ENV` for shell)

  Script action editors had a confusing dual system: the TypeScript editor
  type-checked `{{ }}` template text as code (so `{{ artifact.x }}` errored
  with "Cannot find name"), and the runtime never actually populated the
  `context` object. This standardises on a single, native context-access
  mechanism per editor kind.

  **Run scope reaches actions.** `ActionExecutionContext` gains a `scope`
  (`{ trigger, artifacts, vars, repeat? }`), populated by the dispatch
  engine from the same scope it already uses for `{{ }}` rendering. Actions
  that need broad context (the script actions) read from it instead of
  having to declare every artifact type in `consumes`. Additive and
  optional, so existing actions are unaffected.

  **TypeScript / JavaScript → typed `context`.** `run_script` now builds
  `context` from the run scope, so `context.trigger.payload`,
  `context.artifacts`, `context.var`, `context.repeat`, and
  `context.automation` are populated at run time (previously
  `context.trigger` was always empty). The editor types match via
  `generateAutomationContextTypes`.

  **Shell → `$CHECKSTACK_*` env vars.** `run_shell` flattens the run scope
  into environment variables (e.g. `$CHECKSTACK_TRIGGER_PAYLOAD_TITLE`,
  `$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Arrays become a
  single newline-separated var (iterate with `while IFS= read -r x; do …;
done <<< "$VAR"`). Every value is a plain string — no JSON blob, since
  the container has no `jq` to parse one. A shared `toShellEnvKey`
  helper (in `@checkstack/automation-common`) derives the names so the
  shell editor's `$` autocomplete lists exactly what the runtime injects.

  **One syntax per field kind (editor + runtime).** `MultiTypeEditorField`
  no longer offers `{{ }}` autocomplete in `typescript` / `javascript` /
  `shell` editors, and the dispatch engine no longer template-renders
  native-code config fields (those whose `x-editor-types` is a code type) —
  so `{{ }}` can't be used in a script by accident. Text / markup editors
  (`raw`, `json`, `yaml`, `xml`, `markdown`, `formdata`) and plain string
  fields keep `{{ }}` as before. Because both the automation and
  health-check editors share `MultiTypeEditorField`, they behave
  identically.

  **Script-editor IntelliSense polish.** The code editors got a few
  ergonomic fixes so the typed context is actually usable: the suggestion
  **details panel auto-opens** (so long completion names are legible
  on-focus, not hidden behind the chevron); word-based keyword noise is
  disabled in favour of language-service + provider completions; and a
  TS/JS completion provider makes `context.artifacts.` list the in-scope
  artifact ids and **auto-convert the dot to bracket notation** —
  `context.artifacts["integration-jira.issue"]` — since those ids aren't
  valid identifiers. (Driven by a new opt-in `dottedKeyCompletions` prop on
  the editor / `DynamicForm`.)

  **BREAKING (beta):** `{{ }}` interpolation inside a script action's
  `script` field (shell or TypeScript) is no longer expanded at run time —
  read run data via the typed `context` object (TS) or `$CHECKSTACK_*` env
  vars (shell) instead. Non-script config fields are unchanged.

  Also fixes: switching a provider action in the visual editor now resets
  its config, so the validator no longer reports the previous action's keys
  as unrecognised.

- 41c77f4: feat(automation): Phase 11 — editor primitives + context type generation

  Lays the UI + type-generation groundwork for Phase 12's visual automation
  editor. Every primitive reuses the existing Monaco wrapper / template
  engine / `jsonSchemaToTypeScript` helper rather than building parallel
  infrastructure.

  **`@checkstack/automation-common` — `resolveVariableScope`**

  Pure walker that returns the in-scope `{{ … }}` paths at a given action
  position. Conservative scoping rules: linear-upstream variables /
  artifacts only (no leaking across `choose` / `parallel` / `repeat`
  branches), `repeat.index` / `repeat.item` exposed only inside a `repeat`,
  and trigger.payload modelled as a **discriminated union over
  `trigger.event`** — every payload field surfaces; ones that come from a
  subset of subscribed triggers carry a `conditionalOnTriggers` annotation
  so the picker can render an "Only when …" hint. Earlier draft used
  schema-intersection; switched to discriminated unions per review
  feedback so Monaco can narrow correctly inside event-gated branches.

  **Condition-aware narrowing.** When the path descends through a
  `choose-when`, the resolver parses the branch's `when:` expression and
  statically pins `trigger.event` to the set the condition allows —
  patterns covered are `trigger.event == "X"` (either operand order),
  `trigger.event != "X"`, `||`/`&&` of those, and `{ and: [...] }` /
  `{ or: [...] }` combinators. So an action inside
  `when: 'trigger.event == "incident.created"'` sees only the
  `incident.created` variant in scope, the `conditionalOnTriggers`
  annotation disappears, and other-trigger fields drop out entirely.
  Nested choose branches compound (intersection). Anything outside the
  covered patterns falls back to the full union — better to show every
  field than guess wrong.

  **`@checkstack/template-engine`**

  The expression AST (`Expr`, `BinaryExpr`, `MemberExpr`, etc.) is now a
  public export — the resolver's condition-narrowing walker needs to
  inspect parsed condition trees. `ParsedCondition.root` is tightened
  from `unknown` to `Expr` so consumers don't need to cast.

  **`@checkstack/automation-frontend` — `generateAutomationContextTypes`**

  Consumes `resolveVariableScope`'s output + the trigger / artifact
  registries and emits the `declare const context: { … }` TS declaration
  that `integration-script.run_script`'s Monaco editor injects via
  `addExtraLib`. The emitted shape:

  ```ts
  type AutomationTrigger =
    | { event: "incident.created"; payload: { … } }
    | { event: "incident.resolved"; payload: { … } };

  declare const context: {
    trigger: AutomationTrigger;
    artifacts: { "jira.issue"?: { key: string; … }; … };
    var: { foo?: string; … };
    repeat: { index: number; item: unknown };  // only when inside a repeat
  };
  ```

  `jsonSchemaToTypeScript` from `@checkstack/ui` is reused via a deep
  import (rather than the barrel) so the bun test runner doesn't try to
  load Monaco's Vite-only `?worker` modules during unit tests.

  **`@checkstack/ui` — new editor primitives**

  - `TemplateValueInput` — single-line `{{ }}` autocomplete input.
    Extracted from `DynamicForm/KeyValueEditor`'s previously-private
    `TemplateInput` so other editor surfaces can share it without
    rebuilding the picker UX. `KeyValueEditor` is now a one-line
    delegation; `detectTemplateContext` is also exported.
  - `VariablePicker` — hierarchical popover for the explicit "fx" /
    "Insert variable" workflow. Renders a filterable tree of
    `VariableNode`s with type chips and `Only when …` hints sourced from
    the resolver's `conditionalOnTriggers`. Defaults to a small "fx" pill
    trigger; callers can pass a custom one.
  - `TemplateInput` — high-level mode switcher: `text` mode delegates to
    `TemplateValueInput`, all other modes (`code` / `bash` / `json` /
    `yaml`) delegate to `CodeEditor` with the matching language so the
    action editor can swap widgets purely from the action's
    `x-editor-types` annotation without touching the consuming code.
  - `TemplateInputToggle` — the small "fx" pill that flips a typed input
    (number / select / date / …) into template mode and back. Auto-infers
    template mode when the saved value already starts with `{{`, so
    round-tripping a previously-templated automation works out of the
    box. Render-prop API for the typed editor so consumers keep control
    over their own input shape.
  - `ActionCard` — collapsible card that hosts a single action in the
    visual editor. Decoupled from `DynamicForm` so container blocks
    (`ChooseBlock` / `ParallelBlock` / `RepeatBlock` in Phase 12) can use
    it as a structural shell over their own children. Toggle / delete /
    drag handle are conditionally rendered on their callback's presence.

  Storybook stories shipped for each of the new primitives.

  **`@checkstack/integration-script-backend`**

  `ScriptContext` docstring and the `scriptRunConfigSchema.script` field
  description now point at `generateAutomationContextTypes` so the Phase
  12 editor wiring is unambiguous — the runtime payload type stays
  `Record<string, unknown>` (the runner can't know the trigger schema),
  but the **editor** narrows it per-automation from the subscribed
  triggers' payload schemas.

- 4832e33: fix(automation): insert runtime-parseable `templateRef` from editor autocomplete + variable picker, with array indexing

  The automation editor's `{{ }}` autocomplete and the `fx` variable picker
  previously inserted the canonical dotted path (e.g.
  `artifact.integration-jira.issue.issueKey`), which the template engine
  cannot parse when an artifact id contains dots or hyphens, and which used
  the singular `artifact`/`var` namespaces the runtime template context does
  not expose. They now insert the runtime-parseable `templateRef` form -
  plural top-level namespace (`artifacts`/`variables`) plus bracket notation
  for non-identifier segments, e.g. `artifacts["integration-jira.issue"].issueKey`.

  - `@checkstack/automation-common`: `VariableEntry` gains `templateRef`
    (runtime-parseable insertion form) and `referenceable`, alongside the
    unchanged canonical `path`. New exported helpers `isTemplateIdentifier`,
    `appendTemplateSegment`, and `appendArrayIndex` build the form. Scope
    derivation now descends into `array` schemas, offering both the whole
    array and a representative element subtree (`tags[0]`, `comments[0].author`,
    nested `matrix[0][0]`).
  - `CompletionField` / `TemplateProperty` / `VariableNode` carry a
    `templateRef` alongside the canonical `path`.
  - The staged completion provider's field label, filter/match, insert text,
    and value-stage field lookup all operate in `templateRef` space. The
    expression tokenizer now emits bracket tokens and reconstructs the full
    `foo["bar"].baz` / `foo["bar"].list[0]` access chain (normalising single
    quotes to the stored double-quoted form, and supporting bare numeric array
    indices) so value-stage enum suggestions resolve for bracket-notation and
    indexed fields.
  - `VariablePicker` and the `DynamicForm` template inserters write the
    `templateRef` (falling back to `path` when absent).
  - Shell-env (`$CHECKSTACK_*`) name derivation deliberately keeps using the
    canonical dotted `path`, so the suggested env names stay byte-identical
    to the backend's path-based injection. Script-context type generation is
    unchanged.
  - `@checkstack/integration-script-backend`: shell-script actions now also
    expose array elements as indexed `$CHECKSTACK_*_<i>` env vars (and
    `$CHECKSTACK_*_<i>_<field>` for object elements), alongside the existing
    whole-array newline-joined var, so the runtime injects exactly the
    array-element names the editor now suggests.

- 35bc682: feat(healthcheck): expose check + system run-context to script collectors

  Script health checks can now read which check and system a run is for.
  Previously shell scripts got only a curated env whitelist and inline
  scripts only `context.config`, so a script had no built-in way to know
  its own check name or the system it was checking.

  - `@checkstack/backend-api`: new `CollectorRunContext` type
    (`{ check: { id, name, intervalSeconds }, system: { id, name } }`) and
    an optional `runContext` param on `CollectorStrategy.execute`. Optional,
    so existing collector implementations are unaffected.
  - Shell-script collector: injects reserved `CHECKSTACK_CHECK_ID`,
    `CHECKSTACK_CHECK_NAME`, `CHECKSTACK_CHECK_INTERVAL_SECONDS`,
    `CHECKSTACK_SYSTEM_ID`, `CHECKSTACK_SYSTEM_NAME` env vars (user-supplied
    `env` still wins on collision).
  - Inline-script collector: exposes `context.check` and `context.system`
    alongside `context.config`; the inline-script editor now types them for
    autocomplete.
  - Shell editors (health-check collectors and automation shell actions) now
    also suggest the user's own `env` (JSON) keys as `$NAME` completions, via
    the new exported `customShellEnvVars` helper. Keys that aren't valid shell
    identifiers are omitted.
  - Fix: the Typefox `CodeEditor` captured a stale `onChange` at editor start,
    so editing one `DynamicForm` field reverted sibling fields changed since
    mount (e.g. typing in a shell `script` field wiped an unsaved `env` value,
    or deleted a sibling automation action added after mount). The change
    handler now routes through a ref to the current `onChange`.
  - Fix: focusing a JSON editor threw "LanguageStatusService.addStatus is not
    supported" because the standalone service set omitted `ILanguageStatusService`.
    That one service is now registered via `serviceOverrides`.
  - Fix: the automation trigger card nested a `<Badge>` (a `<div>`) inside a
    `<p>`, producing a `validateDOMNesting` warning. Switched the wrapper to a
    `<div>`.
  - Local runs (`queue-executor`) and satellite runs both populate the
    context. `SatelliteAssignment` (and the `getAssignmentsForSatellite`
    RPC output) gained optional `configName` / `systemName` so the metadata
    reaches satellite-side execution; `HealthCheckService` resolves the
    system name via the catalog client.

  BREAKING CHANGE: `createHealthCheckRouter` now requires a `catalogClient`
  option (used to resolve system names for satellite assignments). Update
  call sites to pass the catalog RPC client.

- c39ee69: Replace the Monaco-based `CodeEditor` with `@typefox/monaco-editor-react`, backed
  by the standalone VS Code language services (no SharedArrayBuffer / cross-origin
  isolation required). The `CodeEditor` public API is unchanged except for the
  breaking note below; existing consumers keep working.

  What this improves:

  - Typed `context` IntelliSense is reliable (no more `addExtraLib` timing race).
  - JSON / YAML / XML editors gain template-aware structural validation: the
    content is validated as the JSON/YAML/XML it renders to, so `{{ }}` templates
    are tolerated in any position (including unquoted, e.g. a numeric value) while
    genuine structural errors are still flagged.
  - JSON uses the real VS Code JSON language service (proper highlighting +
    completion).
  - Template `{{ }}` completion, shell `$env` completion, and external validation
    markers are preserved.

  > [!IMPORTANT]
  > BREAKING (beta): the `dottedKeyCompletions` prop is removed from `CodeEditor`
  > (and from `DynamicForm` / `FormField`). Bracket-notation completions for
  > non-identifier object keys (e.g. `context.artifacts["integration-jira.issue"]`)
  > are now derived automatically from the injected `typeDefinitions`, so the prop
  > is no longer needed.

  The `monaco-editor` and `@monaco-editor/react` dependencies are removed.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [6d52276]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/common@0.12.0

## 1.10.0

### Minor Changes

- f23f3c9: Add five additive shared UI primitives for list / query state surfaces:

  - `ListEmptyState` - thin wrapper around `EmptyState` with the
    canonical `"No {resource} yet"` headline and an `Inbox` default icon.
  - `QueryErrorState` - inline error UI for failed queries; renders an
    `error`-variant `Alert` with `extractErrorMessage` + a Retry button.
  - `Skeleton` - pulsing placeholder block that drops its animation when
    `usePerformance().isLowPower` is true.
  - `ResponsiveTable` + `MobileCardList` - dual-layout pair for tabular
    data that swaps to a stacked card layout below the `sm` breakpoint
    (pure CSS, no JS media-query gating).
  - `toastSuccess` / `toastError` - canonical verb-phrase and
    `{action}: {message}` (truncated at 100 chars) toast helpers.

  Each primitive ships with Storybook stories and unit tests. No
  existing component or behaviour is changed - Phases 5-7 of the v1
  polishing plan will retrofit consumer pages onto these primitives in
  follow-up PRs. Phase 7 will use the existing `usePerformance()` hook
  directly for low-power gating rather than introducing a separate
  className-composition helper.

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2

## 1.9.0

### Minor Changes

- a06b899: Overhaul shell + inline-script health checks with real shell semantics, real ESM execution, and upstream Node/Bun IntelliSense.

  **BREAKING CHANGES**

  - **Shell collector** — the `Execute Script` collector now takes a single `script` string instead of `{ command, args }`. Existing configs are auto-migrated to v2: `command` + `args` are joined with POSIX single-quote escaping into the new `script` field, so behaviour is preserved. Custom UIs that hard-coded `command`/`args` field names need to switch to `script`.
  - **Inline collector** — scripts are now executed as real ES modules in a Bun subprocess (was: `new Function()` inside a Web Worker). The legacy `return X;` style still works (it's auto-wrapped in an async IIFE), but mixed scripts that `import` _and_ `return` at the top level need to use `export default` for their result.

  **FIXES**

  - Shell scripts containing pipes, redirects, `awk`, command substitution, conditionals etc. no longer fail with `ENOENT`. The collector now runs through `sh -c <script>` instead of passing the full expression as `Bun.spawn`'s argv[0]. This was the original `awk … failed with ENOENT` regression.
  - Inline scripts can now `import { loadavg } from "node:os"` (and any other `node:*` or `bun` import). They could not before, because the executor wrapped user code inside `new Function(...)` and ran it in a Web Worker that had no Node module access; the wrapper also made top-level `import` syntactically invalid (`Unexpected token '{'`).
  - Healthcheck editor fields no longer reset while you're editing. The page was re-running its form-state init `useEffect` on every refetch of the configuration query — and that query is invalidated on every realtime `HEALTH_CHECK_RUN_COMPLETED` signal across the platform, so in-progress edits got wiped within seconds. Replaced the naive `useEffect([existingConfig])` with a new `useInitOnceForKey` hook from `@checkstack/ui` that initialises the form only on first load per healthcheck id and ignores background refetches. The hook's decision logic is a pure function (`shouldInitForKey`) and is unit-tested in `useInitOnceForKey.test.ts`.
  - Switching between healthcheck collectors no longer mis-applies the previous collector's tokenizer / language service to the new editor. `MultiTypeEditorField` was reusing the same React instance across collector switches (same `key="script"` in both `DynamicForm` renders) and `selectedType` was initialised from `useState` only once on first mount. After a shell→typescript switch the new collector's TS content rendered through the shell branch (no TS highlighting, no IntelliSense); the reverse direction tokenised shell content through TS and surfaced nonsense errors like `2304 "Cannot find name 'and'"` on shell comments. Now a `useEffect` re-derives `selectedType` whenever `editorTypes` changes to a set that doesn't contain the current selection.
  - Monaco workers are now bundled locally via Vite `?worker` imports and wired up through `MonacoEnvironment.getWorker` in a new `monacoWorkers.ts` module. The default `@monaco-editor/loader` CDN path silently failed CORS on worker scripts in some browsers, leaving Monaco's TS service with only the generic `editorWorkerService` — which is enough for tokenizer-only languages like shell but breaks TypeScript's semantic features entirely. Same module configures the TS service singleton (compiler options, eager-model-sync, diagnostics-options-ignore-1108) at module load instead of inside per-editor `onMount`, so the service starts pre-configured regardless of which language opens first. Migrated from the deprecated `monaco.languages.typescript.*` path to `monaco.typescript.*` (the old path is marked `{ deprecated: true }` in monaco-editor 0.55).
  - `defineIntegration` / `defineHealthCheck` callback parameters are now typed against the schema. Previously the virtual module declared them as `(ctx: unknown) => …`, so writing `defineIntegration(async (context) => { console.log(context.event.eventId) })` produced `'context' is of type 'unknown'. (18046)`. The result type and the shared `IntegrationScriptContext` / `HealthCheckScriptContext` interfaces are now generated together in `scriptContext.ts`, so both the function-arg form and the ambient `declare const context` reference the same schema-typed shape.
  - The shell starter template no longer uses Linux-only `/proc/loadavg` (which fails on macOS satellites with `awk: can't open file /proc/loadavg`). It now reads the 1-minute load average via `uptime` and parses both the Linux (`load average: 0.00, 0.01, 0.05`) and macOS (`load averages: 0.45 0.55 0.65`) output formats with a portable `sed`/`awk`/`tr` pipeline.
  - Starter-template seeding is now self-healing. `DynamicForm`'s schema-defaults `useEffect` fires AFTER child seed effects in React's child-before-parent order, so the previous one-shot seed got clobbered back to `""` by the defaults call on first mount and never re-fired. Replaced the `[]`-deps effect with a two-effect pattern: an observer that latches `hasSeededRef = true` the first time `value` is observed non-empty, and a seed effect that keeps re-installing the starter while the latch is open. Once the seed sticks the latch closes; subsequent edits and realtime refetches don't re-trigger.

  **NEW**

  - The Monaco editor for inline scripts now mounts the real upstream `@types/node` + `bun-types` declarations as a virtual filesystem (lazy-loaded as its own JS chunk), so IntelliSense covers the full Node/Bun stdlib, the `Bun` global, `process.env`, `Buffer`, etc. DOM types are deliberately excluded so suggestions stay focused on the backend surface. `context.config` is typed from the collector's own JSON Schema.
  - New `healthcheckScriptContext` / `integrationScriptContext` helpers (exported from `@checkstack/ui`) build a complete editor bundle in one call: TS declarations (`context.config` / `context.event.payload` + the virtual `@checkstack/healthcheck` / `@checkstack/integration` result-type modules), starter templates per language, and the shell env-var list (with platform-injected `EVENT_ID` / `DELIVERY_ID` / `PAYLOAD_*` for integrations). Both call sites — `CollectorSection.tsx` and `CreateSubscriptionDialog.tsx` — were rewired to use them, fixing a long-standing wiring gap where IntelliSense for injected values silently never reached the editor.
  - Inline scripts can now `import { defineHealthCheck } from "@checkstack/healthcheck"` (or `defineIntegration` for integrations) for a typed return-shape assertion. The editor catches `{ success: "yes" }` as a type error against `HealthCheckScriptResult`. The runtime is just an identity function — the collector rewrites the import to a sibling helper file in the temp dir before executing.
  - Shell editors now autocomplete env-vars after `$` and `${`. The completion list is supplied by `healthcheckScriptContext` (safe-vars whitelist) and `integrationScriptContext` (whitelist + `EVENT_ID` etc. + `PAYLOAD_*` flattened from the event's payload schema). The matcher is pure and unit-tested in `shellEnvVarMatcher.test.ts` so regex regressions are caught locally.
  - Empty editor fields are now seeded with a working starter template per language (inline TS uses `defineHealthCheck`, inline shell does the `awk` load-average check, integration TS shows `defineIntegration` with `context.event`, integration shell lists the `$EVENT_ID` / `$PAYLOAD_*` env vars). Users see a runnable example instead of a blank canvas; once they edit, we leave their content alone.
  - Hardened concurrency + cleanup model documented and tested: each invocation gets its own `mkdtemp` directory + UUID result marker; the `finally` block clears the timeout handle, kills any surviving subprocess (idempotent), and removes the temp directory on success, throw, _and_ timeout. New `concurrency.test.ts` proves 20 parallel inline scripts don't cross wires and that the temp-dir count returns to baseline after throws and timeouts.

  **TESTING**

  Tight unit tests added so changes to the editor surface don't need smoke testing:

  - `scriptContext.test.ts` — 18 tests covering the generated type declarations (including explicit regression guards for `defineIntegration` / `defineHealthCheck` callback params being typed against the shared context interface rather than `unknown`), starter templates (including a guard that the shell starter doesn't depend on Linux-only `/proc/loadavg`), shell env-vars for both healthcheck + integration flavours, plus the schema-flattening utility.
  - `shellEnvVarMatcher.test.ts` — 12 tests covering the bare `$` / braced `${` / partial-name / case-insensitive matching logic that powers Monaco's shell completion.
  - `inline-script-normaliser.test.ts` — 13 tests covering the legacy `return X;` → IIFE wrap path, the ESM-passthrough path, and the `@checkstack/healthcheck` import rewriter.
  - `inline-script-collector.test.ts` — 18 tests including ones that actually execute a script importing `defineHealthCheck` (named-import form) AND using the global `defineHealthCheck` (no import) to prove both code paths resolve at runtime.
  - `concurrency.test.ts` — 4 tests proving 20 parallel runs don't collide and that the temp-dir count returns to baseline after success, throw, and timeout.
  - `useInitOnceForKey.test.ts` — 10 tests proving the healthcheck-editor form state isn't reset when react-query refetches in the background (the original "fields reset while I'm typing" regression).
  - `starterTemplateSelector.test.ts` — 7 tests for the pure decision function powering empty-field seeding.
  - `security.test.ts` — added an integration test that actually executes the portable load-average pipeline through `Bun.spawn` on the current OS, catching `/proc/loadavg`-style regressions at CI time on macOS runners.

  **SECURITY**

  - Same env-var whitelist as before (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`). Backend secrets in the satellite process's environment remain invisible to user scripts.

  See `docs/src/content/docs/backend/script-healthchecks.md` for the full user-facing guide.

## 1.8.3

### Patch Changes

- 1909a61: Address open CodeQL code-scanning findings:

  - **`@checkstack/ui` (`LinksEditor`)**: validate URL scheme on render and on
    add; only `http:` / `https:` URLs are accepted, defeating stored XSS via
    `javascript:` / `data:` schemes in user-supplied hotlinks
    (`js/xss-through-dom`).
  - **`@checkstack/backend-api` (`markdownToPlainText`)**: decode HTML entities
    before stripping tags, then strip tags in a loop until the output
    stabilizes. Decoding `&amp;` last avoids reintroducing tag delimiters
    via `&amp;lt;` round-trips (`js/double-escaping`,
    `js/incomplete-multi-character-sanitization`).
  - **`@checkstack/backend` (`createScopedWsRegistry`)**: drop the
    identity-replacement on the path suffix; the leading-slash invariant
    is documented on `WebSocketRouteRegistry` (`js/identity-replacement`).

## 1.8.2

### Patch Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

## 1.8.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/frontend-api@0.5.1

## 1.8.0

### Minor Changes

- 1ef2e79: feat: hotlinks on incidents/maintenances and additional links on systems

  Users with `manage` access on an incident, maintenance, or system can now
  attach free-form URL "hotlinks" — Jira tickets, runbooks, dashboards, ticket
  tools, etc. — alongside the existing fields.

  - **Incidents** & **maintenances**: links live on the entity itself and are
    surfaced both in the editor dialog and on the public detail page. Two new
    RPC procedures per plugin (`addLink`, `removeLink`) gated behind the
    existing `manage` access rule. Links are returned as part of
    `getIncident` / `getMaintenance` and cache-invalidated on every link
    mutation.
  - **Systems**: a parallel `system_links` table with `getSystemLinks`,
    `addSystemLink`, `removeSystemLink` procedures. Surfaced inside the
    system editor (next to contacts) and on the read-only system detail
    sidebar. Cache-scoped per-system so list endpoints remain hot.
  - **Shared UI**: a `LinksEditor` component in `@checkstack/ui` does the
    presentation; the three plugins each own their own RPC wiring.

  Database changes ship as additive migrations (new `incident_links`,
  `maintenance_links`, `system_links` tables, all FK-cascaded on parent
  delete). No existing columns or rows are touched.

  The system incident and maintenance history pages now sort by relevance:
  active entries (non-`resolved` incidents, `scheduled` or `in_progress`
  maintenances) appear at the top, with creation date descending as the
  tiebreaker.

- aa89bc5: Replace the bespoke `registerInfrastructureTab()` registry with a standard
  slot-extension contract (`InfrastructureTabsSlot` from
  `@checkstack/infrastructure-common`). Plugins now contribute infrastructure
  tabs via `createSlotExtension`, depending only on the slot owner.

  The slot system in `@checkstack/frontend-api` gains a second type parameter
  on `createSlot<TContext, TMetadata>` so extensions can declare typed static
  metadata at registration time (label, icon, access rules, ordering for the
  infrastructure tab bar). A new `useSlotExtensions(slot)` hook returns typed
  extensions and subscribes to plugin lifecycle changes.

  Each tab body now stacks a **Runtime** sub-section (live state, read-only)
  on top of a **Configuration** sub-section (settings, gated by `canUpdate`).

  **Queue runtime panel.** Surfaces aggregated counts (pending / processing /
  completed / failed) plus three sub-tabs of recent jobs: **Active**, **Recent
  failed** (with the failure message), and **Recent completed** (with
  duration). Job payloads are deliberately not surfaced — they may carry
  secrets and need a separate manage-access gate to be shown.

  To support this, `Queue<T>` gains a required `listJobs(opts)` method
  returning `JobSummary[]` (no payloads), and `QueueStats` gains a
  `scope: "instance" | "cluster"` field. The in-memory queue keeps rolling
  ring buffers (200 entries) for completed/failed history and tracks active
  jobs by id; BullMQ uses native `getJobs`. `QueueManager.listJobs` aggregates
  across queues and sorts (most-recent-first for terminal states, FIFO for
  active/waiting/delayed).

  **Cache runtime panel.** Lists the top N entries by size (or by recency) so
  operators can debug a cache filling up. Values are deliberately omitted —
  PII / secret risk. Backends opt in via an optional `listEntries?` method on
  `CacheProvider`; non-supporting backends return `{ supported: false }` and
  the UI renders a "not supported by this backend" hint. The in-memory cache
  implements it using its existing per-entry byte tracking.

  `CacheStats` also gains `scope: "instance" | "cluster"`.

  **Multi-instance scope warning.** A new `<InstanceScopeBanner>` component in
  `@checkstack/ui` renders a yellow banner above any runtime panel whose
  backend reports `scope: "instance"` — i.e. in-memory queue or cache running
  in a horizontally scaled deployment. The banner explains the metrics are
  local to the responding replica and recommends switching to a clustered
  backend (Redis-backed queue / cache) for cluster-wide visibility.

  **Bug fix — stable cache provider proxy.** `CacheManagerImpl.getProvider()`
  now returns a single stable proxy that delegates to whatever provider is
  currently active. Previously, consumers of `createCachedScope` (and any
  direct `cacheManager.getProvider()` caller) captured the active provider
  reference at plugin-init time. After any `setActiveBackend` call — including
  saving the same memory config in the new Cache tab, which reconstructs the
  in-memory cache — those scopes wrote to an orphaned old provider while the
  runtime panel read stats from the new (empty) one, making the runtime panel
  appear to report 0 keys. With the proxy, all consumers share a single stable
  identity and writes always land in the active provider.

  **Bytes tracking on the in-memory cache.** `InMemoryCache.getStats().sizeBytes`
  now returns a running approximation (UTF-8 bytes of the key plus
  `v8.serialize(value).byteLength`, with a JSON fallback) that's kept in sync
  across all eviction paths. Treat the number as a sanity gauge; it doesn't
  include `Map` per-entry overhead.

  **Pagination.** Both `Queue<T>.listJobs` and `CacheProvider.listEntries?`
  are offset-paginated. Inputs gain an `offset: number`; outputs change to
  `{ items, total: number | null, hasMore: boolean }`. `total` is nullable
  so backends that can't compute it cheaply still paginate via `hasMore`.
  The UI uses the existing `<Pagination>` component with a 25-row default
  page size. `QueueManager.listJobs` aggregates by over-fetching
  `[0, offset+limit)` per queue, merge-sorting, then slicing the window —
  optimal for the single-queue case, acceptable for the multi-queue case
  within the UI's reasonable page-depth bounds. BullMQ uses native offset
  ranges via `getJobs(types, start, end)` plus `getJobCounts` for `total`.

  **Pending tab.** The Queue runtime panel exposes a virtual `"pending"`
  state (waiting ∪ delayed, FIFO). It's now the default sub-tab, since
  "what's queued up?" is the most common question. Per-row state is shown
  when viewing the combined list.

  **Recurring schedules visible under Pending.** Cron- and interval-based
  recurring jobs (e.g. healthchecks) are surfaced under Pending/Delayed
  between fires, with a `nextRunAt` countdown column and a "(recurring)"
  label. `JobSummary` gains optional `nextRunAt: Date` and `recurring:
boolean` fields. The in-memory queue synthesises these rows from its
  `recurringJobs` registry; BullMQ already materialises the next fire of
  each scheduler as a delayed job and we now surface its trigger time and
  the `repeatJobKey`-derived `recurring` flag.

  **Bug fix — drop hook emits with no listeners.** `EventBus.emit` no
  longer enqueues a job when zero listeners (distributed or instance-local)
  are registered for the hook. Previously, hooks like
  `core.plugin.initialized` — emitted on every plugin init but subscribed
  to by nothing in the core repo — accumulated one waiting job per emit
  forever. The in-memory queue's `processNext` short-circuits when there
  are zero consumer groups, so its post-loop cleanup never ran for these
  orphaned jobs. The fix drops the emit at the source and logs a debug
  line. Note: in distributed deployments using a Redis-backed queue, this
  means a subscriber on another replica won't receive an event if no
  replica that emits it has a local listener. Plugins needing cross-process
  delivery must register their listener on every replica that should
  receive the hook.

  **Breaking notes (treated as minor under beta semantics)**:

  - `@checkstack/infrastructure-common` removes `registerInfrastructureTab`
    and `getInfrastructureTabs`; former callers must register an extension
    into `InfrastructureTabsSlot`.
  - `@checkstack/queue-api`'s `Queue<T>` interface requires the new
    `listJobs(opts)` method returning `ListJobsResult` (paginated). Both
    bundled queue backends (memory, BullMQ) are updated; out-of-tree
    implementations will need to add it.
  - `QueueStats` and `CacheStats` add a required `scope` field.
  - `CacheProvider.listEntries?` (when implemented) now returns
    `ListEntriesResult` instead of `CacheEntrySummary[]`.
  - `JobState` adds a `"pending"` variant.

- 3547670: Add `@checkstack/tips-*` — first-run tip and onboarding infrastructure for
  the frontends.

  Three new packages:

  - `@checkstack/tips-common` — RPC contract (`tipsContract`), `TipsApi`
    client definition, and zod schemas. Fully-qualified tip IDs have shape
    `<pluginId>.<localTipId>` and are produced exclusively by
    `qualifyTipId(plugin, localId)` — plugins never write the namespace
    themselves, and a local id with a leading or trailing `.` is rejected,
    so one plugin cannot forge or dismiss a tip in another plugin's
    namespace.
  - `@checkstack/tips-backend` — Postgres-backed dismissal store
    (`user_tip_dismissal` with composite PK on `(user_id, tip_id)`),
    `listDismissed` / `dismiss` / `reset` endpoints scoped to the
    requesting user via the auto-auth middleware, and a
    `auth.userDeleted` hook that cleans up dismissals when a user is
    deleted.
  - `@checkstack/tips-frontend` — `<Tip>` (anchored popover) and
    `<TipBanner>` (inline callout) components plus the `useTipState`
    hook. All three accept `{ plugin, id }` (where `plugin` is the
    caller's `pluginMetadata`) and route through `qualifyTipId` so the
    namespace prefix is enforced at the boundary. Persists per-user on
    the server when logged in, and per-browser in `localStorage`
    (`checkstack.tips.dismissed`) when anonymous, with cross-tab sync via
    the `storage` event.

  `@checkstack/ui`'s `<EmptyState>` gains optional `steps` and `actions`
  props for richer empty-state coaching (numbered onboarding lists +
  primary CTA), and accepts `ReactNode` for `description`. Existing
  callers continue to work unchanged.

  `@checkstack/test-utils-backend`'s `createMockDb` now also mocks
  `insert().values().onConflictDoNothing()` so routers using upsert-or-skip
  semantics can be unit-tested.

### Patch Changes

- 3547670: Give `<DialogContent>` real vertical breathing room between its
  children. The previous `gap-4` on `<DialogContent>` was a no-op because
  the children were rendered inside a single inner wrapper, so
  `<DialogHeader>`, the body, and `<DialogFooter>` all stacked tight
  against each other. The inner wrapper is now a flex column with
  `gap-6`, so headers/descriptions, body content, and footer buttons sit
  apart at the dialog level without callers having to add
  `<div className="space-y-…">` themselves.
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
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
  - @checkstack/common@0.9.0
  - @checkstack/frontend-api@0.5.0

## 1.7.1

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
  - @checkstack/common@0.8.0
  - @checkstack/frontend-api@0.4.2

## 1.7.0

### Minor Changes

- 32d52c6: Fix several modal/sheet/overlay closing issues:

  - Replace the custom `DropdownMenu` container with a Radix-based `Popover` (desktop) and `Sheet` (mobile). The previous mobile implementation suppressed outside-click closing, leaving the notification bell's panel only closable by clicking the bell again. `UserMenu` and `NotificationBell` were updated to the new pattern. Leaf primitives `DropdownMenuItem`, `DropdownMenuLabel`, and `DropdownMenuSeparator` are preserved (now backed by a `MenuCloseContext`) so existing call sites continue to work.
  - Fix `Dialog` outside-click closing. The previous structure made `DialogPrimitive.Content` cover the full viewport, so Radix never registered clicks on the dimmed area as "outside" — only ESC could close the modal. The centering wrapper is now a non-Content `<div>` and the actual modal box is the Content, so outside-click closes correctly. A visible X button is now rendered by default; pass `hideCloseButton` to suppress it (e.g. for the search overlay where it would clash with a custom header).
  - Export a standalone `useIsMobile` hook and a new `Popover` primitive.
  - Prevent Radix's auto-focus-return on `NotificationBell` and `UserMenu` overlays. Closing via an item with a `<Link>` (e.g. "View all notifications") would synchronously refocus the trigger via `onCloseAutoFocus`, stealing focus from the link mid-click on pages where another element held focus and requiring a second click to navigate.

### Patch Changes

- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1

## 1.6.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/frontend-api@0.4.0

## 1.6.0

### Minor Changes

- 8d1ef12: Added Categorical Anomaly Detection (Dominance Drift) support for non-numeric healthcheck values, and introduced Slider UI components for sensitivity and confirmation window anomaly settings.

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/frontend-api@0.3.11

## 1.5.1

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10

## 1.5.0

### Minor Changes

- 3da7582: Fix favicon not loading in production container and add NotFound page

  - **Backend**: Fix static file serving so root-level files like `/favicon.svg` are served from the dist directory before the SPA fallback catches them
  - **UI**: Add `NotFound` component with stacked-checkmark logo, physics-inspired falling "4" animation, and low-power device fallback
  - **Frontend**: Add catch-all `*` route to display the NotFound page for unmatched routes, and add the Checkstack logo to the navbar
  - **Favicon**: Redesign with stacked checkmarks in the brand purple/indigo palette

## 1.4.0

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

- bb1fea0: feat: implement active incident and maintenance overview sheets on dashboard

  - Replaces direct routing on status cards with slide-out overview sheets to gracefully degrade for users without manage permissions
  - Refactors dashboard system groups into a clean table-style list layout for better density
  - Makes global status cards more compact

## 1.3.6

### Patch Changes

- 4b0934d: Refactored UserMenu to use a responsive grid layout, improved menu item alignment, and implemented a full-screen scrollable portal for mobile devices. Fixed an issue where the UserMenu would instantly close and reopen when clicking the trigger while the menu was open.

## 1.3.5

### Patch Changes

- 286491a: Added automatic FPS detection that enables "Low Power Mode" once for devices running below 50 FPS, ensuring smooth performance even for users unaware of the manual toggle.

## 1.3.4

### Patch Changes

- 692c717: Increased the brightness and color intensity of the AmbientBackground auroras to ensure high visibility through the 1px grid lines.

## 1.3.3

### Patch Changes

- 594eecc: Implemented a manual "Low Power Mode" toggle in the user menu, allowing users to explicitly disable expensive visual effects. This replaces the previous automatic performance diagnostics with a more predictable, user-controlled system that persists to localStorage while still respecting OS-level "Reduced Motion" settings.

## 1.3.2

### Patch Changes

- 0388000: Implemented a global performance-aware UI infrastructure that detects hardware capabilities (using heuristics and frame-budget benchmarks) to automatically disable expensive CSS animations, backdrop-blurs, and glassmorphism effects on low-power or non-hardware-accelerated devices.

## 1.3.1

### Patch Changes

- 765b764: Optimize AmbientBackground performance by replacing thousand-div grid with a single-element CSS mask and hardware-accelerated Aurora Mesh animations.

## 1.3.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

## 1.2.1

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
  - @checkstack/common@0.6.5
  - @checkstack/frontend-api@0.3.9

## 1.2.0

### Minor Changes

- 23c80bc: ### Jira Data Center Support

  Added support for on-premise Jira Data Center installations alongside existing Jira Cloud support:

  - **Authentication mode switching**: New `authMode` field (`cloud` | `datacenter`) on connection configuration. Cloud uses Basic Auth (email + API token), Data Center uses Bearer Auth (Personal Access Token).
  - **API version routing**: Automatically selects REST API v3 for Cloud and v2 for Data Center.
  - **Description format**: Cloud uses Atlassian Document Format (ADF), Data Center uses plain text.
  - **Connection schema v2**: Backward-compatible — defaults to `cloud` mode for existing connections.

  ### DynamicForm `x-hidden-when` Conditional Visibility

  New generic platform feature for conditionally hiding form fields based on sibling field values:

  - Added `x-hidden-when` metadata extension to `ConfigMeta` and `JsonSchemaProperty`.
  - DynamicForm automatically hides fields and skips their validation when conditions match.
  - Used by Jira integration to hide the email field when `authMode` is `datacenter`.

## 1.1.5

### Patch Changes

- 95aa716: Fix LDAP CA certificate input: The custom CA certificate field was rendered as a single-line password input, which stripped newlines from PEM certificates and caused TLS connection failures ("Failed to connect"). The field now renders as a multi-line secret textarea that properly preserves PEM format while still encrypting the value in storage.

## 1.1.4

### Patch Changes

- c0c0ed2: Fix LDAP group-to-role mapping not assigning roles on login. The LDAP search now explicitly requests the `memberOf` operational attribute, which is not returned by default. Also fixes array flattening that discarded multi-valued group memberships, and adds case-insensitive DN comparison for group matching. The test LDAP environment now uses `groupOfUniqueNames` to enable the memberOf overlay. Additionally, the DynamicForm validation no longer blocks saving when optional array fields (like group mappings) are empty.

## 1.1.3

### Patch Changes

- 6c743d4: Resolve AJV version mismatch and update to 8.18.0 for security reasons. Also fixed a TypeScript error in the HealthCheck latency chart caused by the Recharts v3 API change.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8

## 1.1.2

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7

## 1.1.1

### Patch Changes

- a340781: Improve accessibility of SubscribeButton component by adding appropriate ARIA labels and attributes.
- 8d2660d: Added `@testing-library/react` to devDependencies.
- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3
  - @checkstack/frontend-api@0.3.6

## 1.1.0

### Minor Changes

- c842373: ## Animated Numbers & Availability Stats Live Updates

  ### Features

  - **AnimatedNumber component** (`@checkstack/ui`): New reusable component that displays numbers with a smooth "rolling" animation when values change. Uses `requestAnimationFrame` with eased interpolation for a polished effect.
  - **useAnimatedNumber hook** (`@checkstack/ui`): Underlying hook for the animation logic, can be used directly for custom implementations.
  - **Live availability updates**: Availability stats (31-day and 365-day) now automatically refresh when new health check runs are received via signals.

  ### Usage

  ```tsx
  import { AnimatedNumber } from "@checkstack/ui";

  <AnimatedNumber
    value={99.95}
    suffix="%"
    decimals={2}
    duration={500}
    className="text-2xl font-bold text-green-500"
  />;
  ```

## 1.0.0

### Major Changes

- f676e11: Add script execution support and migrate CodeEditor to Monaco

  **Integration providers** (`@checkstack/integration-script-backend`):

  - **Script** - Execute TypeScript/JavaScript with context object
  - **Bash** - Execute shell scripts with environment variables ($EVENT*ID, $PAYLOAD*\*)

  **Health check collectors** (`@checkstack/healthcheck-script-backend`):

  - **InlineScriptCollector** - Run TypeScript directly for health checks
  - **ExecuteCollector** - Bash syntax highlighting for command field

  **CodeEditor migration to Monaco** (`@checkstack/ui`):

  - Replaced CodeMirror with Monaco Editor (VS Code's editor)
  - Full TypeScript/JavaScript IntelliSense with custom type definitions
  - Added `generateTypeDefinitions()` for JSON Schema → TypeScript conversion
  - Removed all CodeMirror dependencies

  **Type updates** (`@checkstack/common`):

  - Added `javascript`, `typescript`, and `bash` to `EditorType` union

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2
  - @checkstack/frontend-api@0.3.5

## 0.5.3

### Patch Changes

- e5079e1: Add contacts management to system editor

  - **catalog-frontend**: New `ContactsEditor` component allows adding/removing platform users and external mailboxes as system contacts directly from the system editor dialog
  - **catalog-common**: Added `instanceAccess` override to contacts RPC endpoints for correct single-resource RLAC checking
  - **ui**: Fixed Tabs component to use `type="button"` to prevent form submission when used inside forms

- 9551fd7: Fix creator display in incident and maintenance status updates

  - Show the creator's profile name instead of UUID in status updates
  - For maintenances, now properly displays the creator name (was missing)
  - For incidents, replaces UUID with human-readable profile name
  - System-generated updates (automatic maintenance transitions) show no creator

## 0.5.2

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4

## 0.5.1

### Patch Changes

- 090143b: ### Health Check Aggregation & UI Fixes

  **Backend (`healthcheck-backend`):**

  - Fixed tail-end bucket truncation where the last aggregated bucket was cut off at the interval boundary instead of extending to the query end date
  - Added `rangeEnd` parameter to `reaggregateBuckets()` to properly extend the last bucket
  - Fixed cross-tier merge logic (`mergeTieredBuckets`) to prevent hourly aggregates from blocking fresh raw data

  **Schema (`healthcheck-common`):**

  - Added `bucketEnd` field to `AggregatedBucketBaseSchema` so frontends know the actual end time of each bucket

  **Frontend (`healthcheck-frontend`):**

  - Updated all components to use `bucket.bucketEnd` instead of calculating from `bucketIntervalSeconds`
  - Fixed aggregation mode detection: changed `>` to `>=` so 7-day queries use aggregated data when `rawRetentionDays` is 7
  - Added ref-based memoization in `useHealthCheckData` to prevent layout shift during signal-triggered refetches
  - Exposed `isFetching` state to show loading spinner during background refetches
  - Added debounced custom date range with Apply button to prevent fetching on every field change
  - Added validation preventing start date >= end date in custom ranges
  - Added sparkline downsampling: when there are 60+ data points, they are aggregated into buckets with informative tooltips

  **UI (`ui`):**

  - Fixed `DateRangeFilter` presets to use true sliding windows (removed `startOfDay` from 7-day and 30-day ranges)
  - Added `disabled` prop to `DateRangeFilter` and `DateTimePicker` components
  - Added `onCustomChange` prop to `DateRangeFilter` for debounced custom date handling
  - Improved layout: custom date pickers now inline with preset buttons on desktop
  - Added responsive mobile layout: date pickers stack vertically with down arrow
  - Added validation error display for invalid date ranges

## 0.5.0

### Minor Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

## 0.4.1

### Patch Changes

- 538e45d: Fixed 24-hour date range not returning correct data and improved chart display

  - Fixed missing `endDate` parameter in raw data queries causing data to extend beyond selected time range
  - Fixed incorrect 24-hour date calculation using `setHours()` - now uses `date-fns` `subHours()` for correct date math
  - Refactored `DateRangePreset` from string union to enum for improved type safety and IDE support
  - Exported `getPresetRange` function for reuse across components
  - Changed chart x-axis domain from `["auto", "auto"]` to `["dataMin", "dataMax"]` to remove padding gaps

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/frontend-api@0.3.3

## 0.4.0

### Minor Changes

- d1324e6: Enhanced DateTimePicker with calendar popup and independent field editing

  - Added calendar popup using `react-day-picker` and Radix Popover for date selection
  - Implemented independent input fields for day, month, year, hour, and minute
  - Added input validation with proper clamping on blur (respects leap years)
  - Updated `onChange` signature to `Date | undefined` to handle invalid states
  - Fixed Dialog focus ring clipping by adding wrapper with negative margin/padding

### Patch Changes

- 2c0822d: ### Queue System

  - Added cron pattern support to `scheduleRecurring()` - accepts either `intervalSeconds` or `cronPattern`
  - BullMQ backend uses native cron scheduling via `pattern` option
  - InMemoryQueue implements wall-clock cron scheduling with `cron-parser`

  ### Maintenance Backend

  - Auto status transitions now use cron pattern `* * * * *` for precise second-0 scheduling
  - User notifications are now sent for auto-started and auto-completed maintenances
  - Refactored to call `addUpdate` RPC for status changes, centralizing hook/signal/notification logic

  ### UI

  - DateTimePicker now resets seconds and milliseconds to 0 when time is changed

## 0.3.1

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/frontend-api@0.3.2

## 0.3.0

### Minor Changes

- 83557c7: ## CodeEditor Multi-Language Support

  - **Refactored CodeEditor** into modular architecture with language-specific support
  - **Added language modes**: JSON, YAML, XML, and Markdown with custom indentation and syntax highlighting
  - **Smart Enter key behavior**: Bracket/tag splitting (e.g., `<div></div>` → proper split on Enter)
  - **Autocomplete fix**: Enter key now correctly selects completions instead of inserting newlines
  - **Click area fix**: Entire editor area is now clickable (per official CodeMirror minHeight docs)
  - **Line numbers**: Now visible with proper gutter styling
  - **185 comprehensive tests** for all language indentation and template position validation

- 6dbfab8: Replace react-simple-code-editor with @uiw/react-codemirror for better maintenance and features. Added new `CodeEditor` component as a reusable abstraction for code editing with syntax highlighting.

### Patch Changes

- d316128: Add "None" option to optional Select fields in DynamicForm

  **Bug Fix:**

  - Optional select fields (using `x-options-resolver` or enums) now display a "None" option at the top of the dropdown
  - Selecting "None" clears the field value, allowing users to unset previously selected values
  - This fixes the issue where optional fields like `defaultRole` in authentication strategies could not be cleared after selection

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/frontend-api@0.3.1

## 0.2.4

### Patch Changes

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas

## 0.2.3

### Patch Changes

- f6464a2: Fix theme toggle showing incorrect state when system theme is used

  - Added `resolvedTheme` property to `ThemeProvider` that returns the actual computed theme ("light" or "dark"), resolving "system" to the user's OS preference
  - Updated `NavbarThemeToggle` and `ThemeToggleMenuItem` to use `resolvedTheme` instead of `theme` for determining toggle state
  - Changed default theme from "light" to "system" so non-logged-in users respect their OS color scheme preference

## 0.2.2

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0

## 0.2.1

### Patch Changes

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

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0

## 0.2.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0

## 0.1.0

### Minor Changes

- 8e43507: # Button component defaults to type="button"

  The `Button` component now defaults to `type="button"` instead of the HTML default `type="submit"`. This prevents accidental form submissions when buttons are placed inside forms but aren't intended to submit.

  ## Changes

  - Default `type` prop is now `"button"` instead of the HTML implicit `"submit"`
  - Form submission buttons must now explicitly set `type="submit"`

  ## Migration

  No migration needed if your submit buttons already have `type="submit"` explicitly set (recommended practice). If you have buttons that should submit forms but don't have an explicit type, add `type="submit"`:

  ```diff
  - <Button onClick={handleSubmit}>Submit</Button>
  + <Button type="submit">Submit</Button>
  ```

### Patch Changes

- 97c5a6b: Fixed DOM clobbering issue in DynamicForm by prefixing field IDs with 'field-'. Previously, schema fields with names matching native DOM properties (like 'nodeName', 'tagName', 'innerHTML') could shadow those properties, causing floating-ui and React to crash during DOM traversal.
- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4

## 0.0.4

### Patch Changes

- f5b1f49: Extended DynamicForm type definitions with additional JSON Schema metadata properties.
- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/frontend-api@0.0.3

## 0.0.3

### Patch Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2

## 0.1.2

### Patch Changes

- 52231ef: # Auth Settings Page Refactoring

  ## Auth Frontend

  Refactored the `AuthSettingsPage` into modular, self-contained tab components:

  - **New Components**: Created `UsersTab`, `RolesTab`, `StrategiesTab`, and `ApplicationsTab` components
  - **Dynamic Tab Visibility**: Tabs are now conditionally shown based on user permissions
  - **Auto-Select Logic**: Automatically selects the first available tab if the current tab becomes inaccessible
  - **Self-Contained State**: Each tab component manages its own state, handlers, and dialogs, reducing prop drilling

  ## UI Package

  - **Responsive Tabs**: Tabs now use column layout on small screens and row layout on medium+ screens

- b0124ef: Fix light mode contrast for semantic color tokens

  Updated the theme system to use a two-tier pattern for semantic colors:

  - Base tokens (`text-destructive`, `text-success`, etc.) are used for text on light backgrounds (`bg-{color}/10`)
  - Foreground tokens (`text-destructive-foreground`, etc.) are now white/contrasting and used for text on solid backgrounds

  This fixes poor contrast issues with components like the "Incident" badge which had dark red text on a bright red background in light mode.

  Components updated: Alert, InfoBanner, HealthBadge, Badge, PermissionDenied, SystemDetailPage

- 54cc787: ### Fix Access Denied Flash on Page Load

  Fixed the "Access Denied" screen briefly flashing when loading permission-protected pages.

  **Root cause:** The `usePermissions` hook was setting `loading: false` when the session was still pending, causing a brief moment where permissions appeared to be denied.

  **Changes:**

  - `usePermissions` hook now waits for session to finish loading (`isPending`) before determining permission state
  - `PageLayout` component now treats `loading=undefined` with `allowed=false` as a loading state
  - `AuthSettingsPage` now explicitly waits for permission hooks to finish loading before checking access

  **Result:** Pages show a loading spinner until permissions are fully resolved, eliminating the flash.

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3

## 0.1.0

### Minor Changes

- ffc28f6: ### Anonymous Role and Public Access

  Introduces a configurable "anonymous" role for managing permissions available to unauthenticated users.

  **Core Changes:**

  - Added `userType: "public"` - endpoints accessible by both authenticated users (with their permissions) and anonymous users (with anonymous role permissions)
  - Renamed `userType: "both"` to `"authenticated"` for clarity
  - Renamed `isDefault` to `isAuthenticatedDefault` on Permission interface
  - Added `isPublicDefault` flag for permissions that should be granted to the anonymous role by default

  **Backend Infrastructure:**

  - New `anonymous` system role created during auth-backend initialization
  - New `disabled_public_default_permission` table tracks admin-disabled public defaults
  - `autoAuthMiddleware` now checks anonymous role permissions for unauthenticated public endpoint access
  - `AuthService.getAnonymousPermissions()` with 1-minute caching for performance
  - Anonymous role filtered from `getRoles` endpoint (not assignable to users)
  - Validation prevents assigning anonymous role to users

  **Catalog Integration:**

  - `catalog.read` permission now has both `isAuthenticatedDefault` and `isPublicDefault`
  - Read endpoints (`getSystems`, `getGroups`, `getEntities`) now use `userType: "public"`

  **UI:**

  - New `PermissionGate` component for conditionally rendering content based on permissions

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

- eff5b4e: Add standalone maintenance scheduling plugin

  - New `@checkstack/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
  - New `@checkstack/maintenance-backend` package with Drizzle schema, service, and oRPC router
  - New `@checkstack/maintenance-frontend` package with admin page and system detail panel
  - Shared `DateTimePicker` component added to `@checkstack/ui`
  - Database migrations for maintenances, maintenance_systems, and maintenance_updates tables
  - @checkstack/frontend-api@0.0.2
