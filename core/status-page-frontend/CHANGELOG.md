# @checkstack/status-page-frontend

## 0.3.0

### Minor Changes

- 8cad340: feat: live run polling, optimistic automation toggle, and relative public-status freshness

  Implements three loading/feedback UX findings from the read-only review.

  - **Automation run detail goes live.** `RunDetailPage` now polls
    `getRun` every 2s while the run is `running`/`waiting` and stops the
    moment it reaches a terminal status, so a watched execution updates
    its status badge and step timeline without a manual reload. A subtle
    "Live" indicator shows in the header while polling.
  - **Optimistic automation enable/disable.** The per-row toggle on
    `AutomationListPage` now applies the documented optimistic pattern:
    `onMutate` cancels in-flight refetches, snapshots, and flips the row
    in the cache so the switch flips on click; `onError` rolls back from
    the snapshot and surfaces an error toast; `onSettled` invalidates to
    reconcile with server truth. The success toast is suppressed (the
    switch flip is the feedback), per `optimistic-updates.md`.
  - **Relative, visibly-live public-status freshness.** The public status
    page renders "Updated x ago" as relative time (was a static absolute
    timestamp) and ticks periodically so the wording stays honest. A small
    refresh dot pulses on each successful 60s refetch (gated behind
    `usePerformance().isLowPower`, falling back to a static dot on
    low-power devices). The "auto-updates every minute" copy is unchanged.

  BREAKING CHANGE: the automation enable/disable toggle no longer raises a
  "<name> enabled/disabled" success toast; the optimistic switch flip is now
  the sole success feedback (error toast retained on failure).

- 8cad340: feat(status-pages): page-wide overall-status summary banner

  The public status page now shows a page-wide status banner at the top,
  summarising the whole page in one line (for example "All systems
  operational" or "Major outage").

  - `status-page-common` gains a pure, fully unit-tested
    `deriveOverallStatus({ blocks })` plus an `OverallStatusSummary`
    (`{ status, label }`) zod schema/type. The summary reuses the existing
    public status vocabulary (`operational` / `degraded` / `partial_outage`
    / `major_outage` / `maintenance` / `unknown`).
  - The published-page DTO (`PublishedStatusPageSchema`) now carries a
    required `overallStatus` field. The backend resolver derives it from the
    blocks it already resolves - worst-status-wins over each block's public
    DTO - so it adds no new data exposure and no domain-plugin dependency
    (it reads only the field-allow-listed widget output the resolver already
    produces).
  - `status-page-frontend` renders the banner at the top of the public page
    (shared by the in-app and custom-domain surfaces) using the existing
    semantic status tokens, so the banner always matches the widgets below.

  BREAKING: `PublishedStatusPageSchema` now requires `overallStatus`.
  Consumers that build a `PublishedStatusPage` by hand must include it; the
  status-page resolver populates it automatically.

- 8cad340: Public status page polish and accessible builder confirmations.

  - The public status page now re-fetches its published snapshot every 60s
    (bounded `refetchInterval`) so the "Updated" timestamp stays honest while a
    visitor watches during an incident, with an "auto-updates every minute"
    affordance. The not-found and empty states now use the shared `EmptyState`
    for visual consistency.
  - The status page builder replaces the native `globalThis.confirm` prompts
    (remove verified custom domain, discard unsaved changes) with the accessible
    `ConfirmationModal`, so those high-stakes flows are themed, keyboard-/screen-
    reader-accessible, and show a busy state.

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

- 8cad340: Fix accessibility labeling defects on status-page and auth forms.

  Radix `SelectTrigger` renders a `combobox` whose accessible name comes from
  `aria-label`/`aria-labelledby`, not from its `SelectValue` placeholder child, so
  screen readers previously announced several comboboxes as unnamed. Every such
  trigger in the status-page builder (system, heading level, group, visibility) and
  in the auth team/scope/ownership/resource-grant pickers now carries an
  `aria-label` matching its visible intent.

  Form labels that were rendered as detached `<label>`/`<Label>` elements (no
  `htmlFor`/`id` pairing) are now associated with their inputs, so clicking a label
  focuses its field and assistive tech announces the field name. This covers the
  "Create Application" dialog (Name, Description) in auth, and the status-page
  builder fields (Title, Slug, Brand color, Logo URL, uptime Days, event-feed max
  updates / max age). No visual or behavioral change beyond the added accessible
  names and label associations.

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

- 8cad340: Give the status-page builder's "Add a block" widget-type select an explicit
  `aria-label`. A `combobox` derives its accessible name from `aria-label` /
  `aria-labelledby`, not from its placeholder child text, so the control was
  previously announced as an unlabeled combobox to screen-reader users. Labeling
  it also makes the control reliably targetable by assistive tech and tests.
- 8cad340: Extract the status-page create-dialog `slugify` helper into a tested module.

  The "New status page" dialog already auto-fills the slug from the title until the
  operator edits the slug themselves. That derivation logic lived inline in
  `StatusPagesListPage.tsx` with no test coverage. It now lives in
  `src/utils/slugify.ts` with unit tests (`slugify.test.ts`) covering lowercasing,
  hyphenation, invalid-character stripping, leading/trailing-hyphen trimming, and
  empty input. No behavioral change: the title-to-slug prefill and the
  edit-the-slug-to-stop-overriding flow are unchanged.

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
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/status-page-common@0.3.0
  - @checkstack/catalog-common@2.4.2

## 0.2.0

### Minor Changes

- b1a5f3c: Status pages: first-class custom domains with a locked-down public surface.

  A published status page can now be served on its own host (e.g. `status.acme.com`),
  isolated from the admin UI at three layers:

  - **Data.** A new platform extension point (`publicHostResolverExtensionPoint` in
    `@checkstack/backend-api`) lets the owning plugin map an incoming `Host` to a
    published page. On a matched custom domain, a core host-routing middleware
    serves ONLY the single public read (`getPublishedStatusPage`), `/api/config`,
    the public bundle's assets, and the on-demand-TLS hook. Every other `/api/*`,
    all of `/rest/*`, the admin docs, and the platform endpoints
    (`/.checkstack/*`, `/.well-known/jwks.json`) return 404. `/api/config` returns
    the custom domain itself as `baseUrl`, so the bundle's RPC client can only
    call back into the same locked-down origin - never the admin origin.
  - **Code.** The custom-domain host loads a separate minimal public bundle that
    ships none of the admin app (no sidebar, auth, signals, command palette, or
    plugin loader). The frontend entry checks `/api/config` first and dynamically
    imports only the public bundle on a public host, so the admin chunk is never
    fetched there.
  - **Ownership.** Domains are added in the builder, verified via a DNS TXT record
    (`_checkstack-verify.<domain>`), and route only once verified AND published.
    An `/.well-known/checkstack/authorize-domain` hook lets an on-demand-TLS edge
    (Caddy, Cloudflare for SaaS, cert-manager automation) mint certificates only
    for verified domains. TLS is terminated at the edge, matching how the platform
    already serves its primary domain.

  Builder gains a Custom domain panel (set / verify / remove + DNS instructions).

  Widget renderers are now pluggable too. A plugin that contributes a backend
  widget type can ship its frontend renderer with `defineStatusWidgetRenderer`
  (in `@checkstack/status-page-common`) via its `extensions[]`; the status-page
  frontend resolves each block's renderer by id, merging built-ins (which win on a
  clash) with plugin-contributed ones. Previously only the built-in renderers
  existed, so a third-party widget type had no way to draw on a page.

  Third-party renderers work on custom domains too. A backend widget type can
  declare `rendererRemote` (its frontend npm package); the published-page response
  then lists exactly the renderer remotes that page needs, and the minimal
  custom-domain bundle loads only those on demand via Module Federation. The set
  is derived from the page's widget types (operator-controlled, never visitor
  input) and the loaded code is the operator's own trusted plugin, so it does not
  widen the data surface (the only reachable data endpoint on a public host is
  still the single public read).

  Hardening (from review): WebSocket upgrades are gated on custom-domain hosts
  (they bypass the HTTP middleware), so no socket endpoint is reachable there;
  custom domains route ONLY `public`-visibility published pages (an
  `authenticated` page never routes nor leaks its slug); `setCustomDomain` rejects
  the platform's own host, IP literals, and internal suffixes; and the host-lookup
  cache is size-bounded against unique-host floods. The host-routing decision is
  unit-tested.

  NOT breaking. New `status-page-common` contract procedures (`setCustomDomain`,
  `verifyCustomDomain`, `removeCustomDomain`) and `customDomain*` columns on the
  `status_pages` table (additive migration).

  (`@checkstack/ai-backend` is a patch only: its generated docs index now includes the custom-domain documentation.)

### Patch Changes

- b1a5f3c: Status pages: render the optional "Block heading" (label) on content widgets.
  Text, Heading, Links, and Image blocks previously dropped the per-block heading
  on the public page (only status widgets, which wrap in a titled section, showed
  it); they now render it consistently.
- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/status-page-common@0.2.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/ui@1.16.2

## 0.1.0

### Minor Changes

- 9ab73c5: Status pages: configurable incident/maintenance updates + recently resolved/completed items.

  The Incidents and Maintenance widgets gain four config options (in the builder):

  - **Show updates** (default on) — render the per-item update timeline so visitors
    can follow progress. The maintenance widget now renders its timeline too
    (previously it fetched updates but didn't show them). Turning this off also
    skips the per-item detail fetch (a perf win).
  - **Max updates per item** (default 3) — show only the latest N updates,
    most-recent first, so a chatty incident doesn't dominate the page.
  - **Show recently resolved / completed** (default off) — include resolved
    incidents / completed maintenances, rendered in a separate "Recently resolved"
    / "Past maintenance" subsection below the active items.
  - **Max age (days)** (default 7) — only include past items resolved/completed
    within the window.

  Scoping and isolation are unchanged: still only the systems the operator bound,
  still fail-closed when none are bound, still field-allow-listed DTOs (no
  `createdBy`). The active/past partition + max-age + cap is a pure, unit-tested
  helper (`selectEvents`).

- 5c6393f: Add operator-built public Status Pages (phase 1: secure, extensible core).

  Operators compose a public status page from widgets (status banner, system
  health, group status, 90-day uptime, incidents, scheduled maintenance) plus
  content blocks (text/Markdown, heading, links, image, divider), each bound to the
  resources they choose, then publish it.

  Security model — "only published widgets reveal data":

  - A single public endpoint, `getPublishedStatusPage(slug)`, returns the layout
    plus each widget's already-resolved, field-ALLOW-LISTED DTO. The public surface
    has no generic data API, so it can only ever show what was placed on the page.
  - Three gates: edit-time (you can only bind resources you can access), publish-time
    (an audited, deliberate exposure that re-checks the editor can read every bound
    resource via a user-scoped client), and render-time (resolvers run as a trusted
    service but emit only DTO fields — never internal config, ids, or `createdBy`;
    the service re-validates each DTO against its schema, so a resolver bug fails
    closed).
  - The overall banner rolls up only the bound systems; private resources are never
    exposed beyond their public-safe status; per-binding label overrides avoid
    internal-name leaks.

  Coherence + extensibility:

  - Status pages are team-scopable resources (RLAC): created via the standard
    owning-team picker + create-capability flow, resolvable by name in the Teams
    admin.
  - Widget types come from an extension-point registry, so any plugin can contribute
    a widget (config schema + public DTO + `resolvePublic`); the public renderers
    are pure, prop-only components with no data access, so third-party widgets can
    never leak.
  - Draft vs published layouts; per-page visibility (public / authenticated-only)
    and theming (brand color, logo).

  Dependency direction: the status-page platform owns the widget-type registry and
  the content widgets, but the DOMAIN widgets are contributed by their owning
  plugins via the `statusWidgetTypeExtensionPoint` — system health / uptime /
  banner / group status by `healthcheck-backend`, incidents by `incident-backend`,
  scheduled maintenance by `maintenance-backend`. So `status-page-backend` depends
  only on `backend-api` / `common` / `status-page-common`; the owning plugins
  depend on the platform, never the reverse. `catalog-common` gains
  `assertCatalogResourcesReadable` for the publish-time access check.

  Phase 1 scope: the secure core, the admin builder, and the public page (served as
  a no-access-rule route). A fully separate public bundle, custom domains + TLS,
  drag-reorder, live-data preview, and distribution (embeds/badges/RSS/subscriptions)
  are the next phases.

### Patch Changes

- 9ab73c5: Status pages: render the public page without the admin chrome, fix slug auto-fill, and polish the widgets.

  - **Standalone routes.** A plugin route may now set `standalone: true` to render
    WITHOUT the app chrome (no sidebar, header, ambient background, or command
    palette). The router renders standalone routes as siblings of a new shell
    LAYOUT route (`<Outlet/>`), so they show none of the authenticated UI while
    still living inside the API/session providers. The public status page
    (`/status/:slug`) uses it, so a published page no longer embeds the whole
    Checkstack admin UI.
  - **Slug auto-fill fix.** In the "new status page" dialog the slug now follows
    the title as you type, until you edit the slug yourself (previously it stopped
    after the first character).
  - **Widget polish.** The public renderers and page were redesigned to look like a
    real status page: a brand-accent top bar, a centered header, card sections with
    proper spacing, an icon-led status banner, clearer status pills, nicer uptime
    bars, an incident timeline, and severity-coloured incident badges.
  - **Uptime "no data" fix.** A system with no run history in the window showed a
    misleading "0.00%"; the uptime widget now shows "No uptime data for this period
    yet" (a healthy system with no history is not 0% uptime), with accurate
    start/end date labels under the bars.

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/ui@1.16.1
  - @checkstack/status-page-common@0.1.0
  - @checkstack/frontend-api@0.10.0
