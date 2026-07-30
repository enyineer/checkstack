# @checkstack/announcement-frontend

## 0.11.0

### Minor Changes

- 88f4333: Markdown editor with a live preview tab and formatting toolbar

  Markdown fields were plain textareas with a "Markdown supported" hint, so an
  author found out how their text rendered only after saving - or, for a
  notification, after it had already been delivered.

  New `MarkdownEditor` in `@checkstack/ui`: Write / Preview tabs plus a toolbar
  (bold, italic, link, code, lists, quote). Adopted by the incident and maintenance
  update forms and descriptions, and the announcement message.

  The preview renders through `MarkdownBlock` - the same component, remark/rehype
  chain and sanitiser used for the saved content. A second renderer here would be
  free to drift, and a preview that disagrees with the real render is worse than no
  preview.

  Toolbar marks toggle rather than only adding, and mark lengths are matched
  exactly so italic (`*`) never claims bold's (`**`) delimiters and silently
  downgrades an author's emphasis.

  Note for adopters: `MarkdownEditor` wraps its textarea, so `required` on it does
  nothing - gate submission explicitly instead.

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
  - @checkstack/status-page-common@0.7.0
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/tips-frontend@0.5.6
  - @checkstack/announcement-common@0.7.3
  - @checkstack/signal-frontend@0.3.8

## 0.10.0

### Minor Changes

- be74b01: Make the announcement table sortable and filterable

  Every column except Actions now sorts, and the list can be narrowed by title,
  severity, status and visibility.

  - **Sorting** is on impact rather than alphabet where that differs: severity
    sorts critical -> info, status sorts active -> scheduled -> expired ->
    inactive (the order the stat strip lists its buckets in), and Created sorts on
    the raw timestamp instead of the "3 days ago" prose the cell shows. The two
    icon-only columns sort by the label their tooltip shows.
  - **Filtering** adds a title search plus severity / status / visibility facets,
    a Clear affordance, and a filtered-empty state. Values arriving from the
    `<Select>`s are parsed against the schemas that define them, so an
    unrecognised value degrades to "unconstrained" rather than becoming a filter
    nothing can match. The Status facet matches on the DERIVED lifecycle state, so
    it stays correct as an announcement's window opens and closes.
  - **Reordering** moved out of the Actions cluster into its own sortable "Order"
    column that also shows each announcement's 1-based position. The position is
    what makes the up/down arrows legible while the table is sorted some other
    way. While a filter actually hides rows the arrows are disabled with a "Clear
    filters to reorder" tooltip, since the neighbour being swapped with would be
    off-screen - the same rule the catalog's Groups tab uses.

  The table previously declared itself deliberately unsortable, on the grounds
  that sorting would desync the index-based reorder controls from the visible row
  order. Showing each row's canonical position removes that constraint.

  Also fixes a pre-existing panel-in-panel: the table paints its own bordered
  surface inside an already-opaque Card, so it now passes `surface={false}` like
  the automation list and queue panels do.

- be74b01: Render the announcement block on public status pages (serve core plugins as Module Federation remotes)

  Thanks to @stuajnht for reporting: the Announcements block never rendered on a
  public status page - the lean public bundle (used for both a custom domain and
  the same-origin `/statuspage/view/:slug` path) loads NO plugins, and the
  announcement renderer lives in a core frontend plugin that was only ever bundled
  into the admin app. Declaring the widget's `rendererRemote` was necessary but not
  sufficient: core plugins were never built or served as remotes, so the public
  bundle's `loadRemote` 404'd and the block stayed blank.

  BREAKING CHANGE (mechanism, not API): core frontend plugins can now ship a public
  Module Federation remote so the lean public bundle can load their status-page
  widget renderers on demand - the same mechanism third-party plugins use.

  - `@checkstack/announcement-frontend` gains a federation `vite.config.ts` and a
    `build` script that emit a remote (`mf-manifest.json` + `remoteEntry.js`),
    exposing a LEAN public entry (`public-plugin.tsx`) that contributes ONLY the
    status-widget renderer - not the admin routes/manage page - so the remote stays
    small and avoids the heavy `@checkstack/ui` surface. It shares only `react`,
    `@checkstack/frontend-api`, and (consume-only) `@checkstack/ui/code-editor` with
    the host; react-dom / react-query are left unshared so their dead transitive
    code bundles and tree-shakes rather than breaking the federated consume shim.
  - Opt in with `checkstack.publicRemote: true` in the plugin's package.json. The
    backend plugin discovery now syncs such core frontend plugins into the
    `plugins` table so `/assets/plugins/<name>/*` serves their `dist/` (ordinary
    core frontend plugins, bundled into the admin app, are unaffected and excluded
    from the admin remote list).
  - Build wiring: a new `bun run build:public-remotes` builds every
    `publicRemote` plugin (single source of truth: the same marker discovery uses),
    wired into the `Dockerfile` builder stage and the e2e `pretest:e2e`; the
    runtime image copies each remote's `dist/`.

  Verified end to end in a real browser: the public page fetches the remote's
  `mf-manifest.json` / `remoteEntry.js` (200), Module Federation loads it against
  the host's shared React/frontend-api, and the announcement renders (with its
  markdown) - no console errors.

### Patch Changes

- be74b01: Fix info-severity announcements rendering in the neutral grey "unknown" hue

  An announcement with `info` severity mapped onto the grey `unknown` status
  tone, so its severity pill, its card accent stripe and the global announcement
  banner all rendered grey - reading as "inert/disabled" rather than
  "informational" - on the announcements manage page, the dashboard and the
  public status page widget.

  `info` severity now maps to the blue `info` tone that the design system already
  defines (`--status-info`) and that incidents and status pages already use.
  The announcement plugin's private copy of the tone table, which was missing the
  `info` entry entirely, is replaced by the shared `pillToneStyles` from
  `@checkstack/ui`, and the banner now derives its classes from the same
  severity-to-tone mapping as the pills instead of carrying its own switch, so the
  two can no longer drift.

  `pillToneStyles` gains `text`, `tint`, `border` and `tintHover` class sets per
  tone (additive - existing `pill` / `dot` / `accent` are unchanged) so banner-like
  surfaces can be tinted from the shared table.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- be74b01: Give announcement lifecycle states deliberate colours instead of accidental grey

  "Scheduled", "Expired" and "Inactive" all fell through a `default:` arm in
  `statusToTone` to the neutral grey `unknown` tone, so a scheduled announcement
  was indistinguishable from an inert one and none of the three had been chosen
  on purpose.

  Colour is now split by what it answers:

  - **A row is coloured by its SEVERITY.** The manage table's leading dot and the
    mobile card's accent stripe follow the announcement's severity (info blue /
    warning amber / critical red), matching the banner, the dashboard card and
    the status-page widget, which already worked this way.
  - **A row's lifecycle is stated in words.** The Status column is now a neutral
    pill (`Active` / `Scheduled` / `Expired` / `Inactive`), so it no longer puts a
    second, competing colour scale on the same line.
  - **The stat strip above the table keeps lifecycle colour**, because each card
    IS a lifecycle bucket: active stays green, scheduled becomes informational
    blue (deliberately not amber, which means "degraded" everywhere else and would
    make a correctly scheduled announcement read as a fault), and expired and
    inactive stay grey - the tone the design system defines for inert states -
    now by explicit decision. The cards keep their neutral border and carry the
    tone on the existing left accent stripe.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- be74b01: Make filtering part of the column contract

  Filtering now joins sorting and searching on `DataTableColumn`: providing
  `filterValue` is what makes a column filterable, with no separate boolean flag,
  exactly as `sortValue` makes it sortable.

  A status column already reads the row for `sortValue` and renders it in `cell`;
  declaring the filter there too means the value is stated ONCE, so the badge, the
  sort and the filter cannot drift apart. Previously the same value had to be
  repeated in a standalone facet.

  ```tsx
  {
    id: "severity",
    header: "Severity",
    cell: (a) => <SeverityBadge severity={a.severity} />,
    sortValue: (a) => severityRank[a.severity],
    filterValue: (a) => a.severity,
    filterOptions: SEVERITY_OPTIONS,  // omit to derive from the data
  }
  ```

  `filterOptions` is optional: omitted, the options are derived from the distinct
  values present in the data, sorted and labelled by the raw value. Declare them
  when the raw values are not what a person should read, when the order carries
  meaning (severity by impact, which deriving would sort alphabetically into
  critical / info / warning), or when an option must stay on offer even though no
  row currently has it.

  Options are derived from the FULL row set, never from what is currently visible.
  Reading them off the filtered rows would let selecting one option delete every
  other option, leaving no way back - the same reason a cell cannot simply publish
  its value upward: rows excluded by a filter never render.

  The standalone `facets` prop keeps its place for a dimension no single column
  owns - the catalog's group and tag filters match several values per row and
  narrow two different row types. Column-derived facets render first, in column
  order, followed by those.

  The announcements table is converted: its severity, status and visibility
  filters now live on the columns that display them.

- be74b01: Add native facet filtering to DataTable, with URL-persisted state

  Search and "narrow by status/severity/type" had no home in `DataTable`, which
  owned only a free-text box whose query lived in internal state a page could not
  observe. So every surface that needed to know what was filtered - to gate a
  control, to render its own empty state, to put the view in a shareable link -
  abandoned the built-in search entirely and hand-rolled the lot. Across the repo
  that produced 18 surfaces rendering filter UI outside `DataTable` against 17
  using only its built-in search, with six different renderings of the same select
  and three different "show everything" sentinels.

  `DataTable` now accepts:

  - `facets` - declarative `{ id, label, options, value }` filters rendered beside
    the search box, ANDed with each other and with the search, with a Clear
    affordance and a `noResultsState` that fires on facet emptiness.
  - `filters` / `onFiltersChange` / `onClearFilters` - the state is controllable,
    so a page can observe it. Omit them and the table owns it internally.
  - `surface={false}` now also insets the filter bar with a separating rule, so a
    table nested full-bleed in a page's own Card no longer has its controls flush
    against the card's edges.

  New exports:

  - `useDataTableFilters` persists filter state to the URL, so a filtered view is
    shareable, survives a reload, and returns intact from a row's detail page. It
    exposes `active` (for gating controls a filtered view makes ambiguous) and a
    `debounced` variant for server-side query inputs, plus `paramPrefix` for two
    filtered tables on one page.
  - `DataTableFilterBar` renders the same controls for a list surface that is not
    a table, so a card grid filters identically to one.
  - `useDebouncedValue`, which had been copied verbatim into six plugin packages,
    each carrying a comment noting that no shared version existed.

  The announcements manage table is migrated onto it as the first consumer,
  dropping its local filter module in favour of facet declarations.

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
  - @checkstack/ui@1.30.0
  - @checkstack/auth-frontend@0.15.0
  - @checkstack/status-page-common@0.6.5
  - @checkstack/frontend-api@0.17.0
  - @checkstack/tips-frontend@0.5.5

## 0.9.6

### Patch Changes

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
  - @checkstack/ui@1.29.0
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/tips-frontend@0.5.4
  - @checkstack/status-page-common@0.6.4
  - @checkstack/announcement-common@0.7.2
  - @checkstack/signal-frontend@0.3.7

## 0.9.5

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/tips-frontend@0.5.3
  - @checkstack/announcement-common@0.7.1
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/signal-frontend@0.3.6
  - @checkstack/status-page-common@0.6.3

## 0.9.4

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/auth-frontend@0.13.5
  - @checkstack/tips-frontend@0.5.2

## 0.9.3

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/tips-frontend@0.5.1
  - @checkstack/announcement-common@0.7.1
  - @checkstack/common@0.22.0
  - @checkstack/signal-frontend@0.3.6
  - @checkstack/status-page-common@0.6.3

## 0.9.2

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/tips-frontend@0.5.0
  - @checkstack/auth-frontend@0.13.3
  - @checkstack/status-page-common@0.6.2

## 0.9.1

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/auth-frontend@0.13.2
  - @checkstack/tips-frontend@0.4.12
  - @checkstack/status-page-common@0.6.1

## 0.9.0

### Minor Changes

- 43e4484: Status page enhancements:

  - Group-status widget can collapse its member rows while every member is
    operational (auto-expanding on any issue or maintenance).
  - New "Announcements" status-page widget, contributed fully externally by the
    announcement plugin: it surfaces active `visibility: "all"` announcements
    through a public-safe DTO (title/message/severity/timestamps only) and never
    affects the page status rollup.
  - Incident and maintenance widgets can scope by catalog GROUPS with per-system
    exceptions. Scope is resolved at read time (`(systemIds ∪ members(groupIds)) −
excludedSystemIds`), so members added to a group later are reflected
    automatically. The builder gets a nested group/system picker.
  - Incident and maintenance items on a public page link to dedicated public
    detail pages, gated server-side to items the page's published widgets actually
    surface (no enumeration, no internal-field leak). The custom-domain public
    bundle gains a minimal in-memory router for the two detail pages.
  - Fix the custom-domain "Cannot connect to Checkstack backend" screen: a
    configured-but-not-servable custom domain now serves the lean public
    "not available" page instead of the admin shell; the public bundle skips the
    cross-origin `/api/config` probe; CORS admits resolved custom domains; the
    request origin is normalized for proxy scheme/port variance; and re-saving an
    unchanged custom domain no longer clears its verification.
  - Anonymous email subscriptions (double opt-in) for incident updates, opt-in per
    status page (`emailSubscriptionsEnabled`, default off): a new
    `status_page_subscribers` table, public subscribe/verify/unsubscribe
    procedures with constant-time responses that fail closed when the page has not
    enabled subscriptions, and team-scoped admin list/remove + an enable toggle in
    the builder. Emails are delivered through a new `sendRawEmail` primitive in
    notification-backend that sends to an arbitrary external address (no auth
    account) via every enabled email strategy (SMTP), with a mandatory unsubscribe
    link.
  - Incident/maintenance update fan-out to subscribers via a new
    `notificationAudienceExtensionPoint` in notification-backend. Every
    notification funnelled through `notifyForSubscription` (incident, maintenance,
    health - all unchanged) now also invokes each registered audience sink exactly
    once, enriched with the affected systems and their catalog groups (resolved
    from notification-backend's own resource-parent graph, never a domain import).
    status-page-backend contributes a sink that, AT SEND TIME, matches each
    notification's affected systems against the systems each published + public +
    email-enabled page currently surfaces in its incident/maintenance widgets
    (honoring group membership and per-system exclusions) and emails that page's
    verified subscribers. Send-time scoping against the live layout is the privacy
    boundary: a page only ever emails about systems its widgets surface right now.
    Because `notifyForSubscription` is a single-pod point RPC, each notification
    fans out exactly once cluster-wide.
  - Subscriber reconcile on page deletion: the subscriber FK is `ON DELETE
CASCADE` and page deletion also explicitly purges subscribers (invalidating
    pending verify/unsubscribe tokens) - no orphan rows, no post-deletion send.
    Removing all systems from a page or disabling email is intentionally NOT a
    prune: send-time scoping plus the email-enabled gate make those subscribers
    dormant with no data loss, and re-enabling restores the audience without a
    re-subscribe.
  - Send-time scoping is single-source: the fan-out asks each event-feed widget for
    its CURRENT effective system scope (the same live catalog group expansion the
    widget renders from) instead of a parallel copy of group membership, so it can
    never over- or under-deliver relative to what the page shows.
  - `sendRawEmail` in notification-backend is now `userType: "service"` (was an
    authenticated procedure gated on `notification.send`). Sending to an arbitrary
    address is an open-relay / email-bomb primitive, so it is callable only by a
    trusted backend-to-backend caller (the status-page subscriber mailer), never by
    an end user.
  - Incident/maintenance widgets gain an optional per-system PUBLIC label override
    (`systemLabels`), the same override path the system-health widget uses, so the
    public incident/maintenance detail pages present clean labels instead of raw
    catalog names.
  - The anonymous subscribe endpoint adds a coarse per-page quota (max new
    subscribers per rolling hour, counted over durable rows so it holds across
    pods) on top of the per-(page,email) cooldown, capping verification-email
    amplification. The quota is CONFIGURABLE per status page (new nullable
    `email_subscribers_hourly_quota` column; null uses the default of 50, so
    existing pages are unchanged), validated as a positive integer up to 5000,
    editable in the builder next to the email opt-in toggle and gated by the same
    page-manage capability.
  - Email verification is now per-page configurable and backed by a platform-global
    once-per-address registry:
    - New `email_verification_required` column (boolean, default true) on
      `status_pages`, exposed on the admin StatusPage DTO + `updateStatusPage`
      input (same page-manage gate) with a builder toggle. When OFF, a new
      subscriber is created active immediately - no verification email, and the
      address is NOT written to the global registry (the operator's trust choice
      for e.g. an internal page).
    - New `status_page_verified_emails` table: one row per normalized address that
      has completed verification on ANY page. When a verification-required page is
      subscribed by an already-globally-verified address, the row is created active
      immediately and a COURTESY email (with one-click unsubscribe) is sent instead
      of a verification email, so a malicious add is always caught. `verify` upserts
      the address into this registry and activates every other pending row for the
      same address in one update (confirm once, all pages).
    - Fan-out is unchanged: it still gates on the per-row `verified` flag; the
      registry only governs whether a NEW subscribe short-circuits to active.

  BREAKING CHANGE: `sendRawEmail` is now service-only. Any (non-existent in-tree)
  authenticated caller must invoke it through a trusted service client instead.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ui@1.26.0
  - @checkstack/status-page-common@0.6.0
  - @checkstack/announcement-common@0.7.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/auth-frontend@0.13.1
  - @checkstack/tips-frontend@0.4.11

## 0.8.1

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/ui@1.25.1
  - @checkstack/announcement-common@0.6.3
  - @checkstack/tips-frontend@0.4.10
  - @checkstack/signal-frontend@0.3.5

## 0.8.0

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

- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/auth-frontend@0.12.0
  - @checkstack/ui@1.25.0
  - @checkstack/tips-frontend@0.4.9

## 0.7.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/tips-frontend@0.4.8
  - @checkstack/announcement-common@0.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/signal-frontend@0.3.4

## 0.7.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/announcement-common@0.6.1
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/frontend-api@0.13.1
  - @checkstack/tips-frontend@0.4.7
  - @checkstack/signal-frontend@0.3.3

## 0.7.1

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1
  - @checkstack/tips-frontend@0.4.6

## 0.7.0

### Minor Changes

- a7f7e98: Announcements now have a stable, operator-controlled display order.

  ## What changed

  - **Stable ordering (bugfix).** `getActiveAnnouncements` had no `ORDER BY`, so
    Postgres returned rows in heap order, which shifts after any `UPDATE` - that
    is why announcements jumped position whenever one was edited. Both
    `getActiveAnnouncements` and `listAllAnnouncements` now order by
    `sort_order`, with `created_at` and `id` as stable tiebreakers, so the
    sequence never changes on its own.
  - **Manual sorting.** `announcements` gained a `sort_order` integer column
    (migration `0001`, back-filled from existing creation order). A new
    `reorderAnnouncements` admin procedure takes the full ordered id list and
    writes each announcement's position in one atomic `UPDATE ... CASE`. Operators
    reorder from the management page with per-row up/down arrows (desktop table
    and mobile cards). New announcements append at the end; editing an
    announcement never moves it.
  - **Pure manual order everywhere.** The public banner no longer force-sorts by
    severity - banner, dashboard, and admin list all render the operator's order.
  - The `announcement.updated` signal payload's `action` gained a `"reordered"`
    value so listeners refetch after a reorder.

  ## Notes

  - `sort_order` is backend-internal; it is not exposed on the public
    `Announcement` schema (the frontend derives order from query order).
  - Migration `0001_typical_omega_red.sql` adds the column (default `0`) and
    back-fills distinct values via `row_number()` over `created_at, id`. It
    applies cleanly to both fresh and already-populated databases.

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

### Patch Changes

- 07546ed: Give the Edit and Delete row actions on the announcement management page
  accessible names (`aria-label`). The icon-only buttons previously exposed no
  accessible name, so assistive technology announced them only as "button" and
  tests had to target them positionally - which broke once the reorder Move
  up/down controls were added to the same action group. The buttons now read as
  "Edit announcement" / "Delete announcement".
- Updated dependencies [0d912a3]
- Updated dependencies [a7f7e98]
- Updated dependencies [0d912a3]
- Updated dependencies [d9f4654]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/auth-frontend@0.11.0
  - @checkstack/announcement-common@0.6.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/tips-frontend@0.4.5
  - @checkstack/signal-frontend@0.3.2

## 0.6.2

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2
  - @checkstack/tips-frontend@0.4.4

## 0.6.1

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/announcement-common@0.5.7
  - @checkstack/frontend-api@0.12.1
  - @checkstack/tips-frontend@0.4.3
  - @checkstack/signal-frontend@0.3.1

## 0.6.0

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
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/auth-frontend@0.10.0
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/announcement-common@0.5.6
  - @checkstack/tips-frontend@0.4.2
  - @checkstack/common@0.17.0

## 0.5.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1
  - @checkstack/tips-frontend@0.4.1

## 0.5.0

### Minor Changes

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

### Patch Changes

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
  - @checkstack/tips-frontend@0.4.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/announcement-common@0.5.5
  - @checkstack/signal-frontend@0.2.6

## 0.4.9

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/tips-frontend@0.3.9
  - @checkstack/ui@1.16.2

## 0.4.8

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/announcement-common@0.5.4
  - @checkstack/signal-frontend@0.2.5

## 0.4.7

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/auth-frontend@0.7.7
  - @checkstack/tips-frontend@0.3.7

## 0.4.6

### Patch Changes

- @checkstack/auth-frontend@0.7.6
- @checkstack/tips-frontend@0.3.6

## 0.4.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-frontend@0.7.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/announcement-common@0.5.3
  - @checkstack/tips-frontend@0.3.5
  - @checkstack/signal-frontend@0.2.4

## 0.4.4

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
  - @checkstack/auth-frontend@0.7.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/announcement-common@0.5.2
  - @checkstack/common@0.14.1

## 0.4.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/auth-frontend@0.7.3
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/announcement-common@0.5.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/signal-frontend@0.2.2

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/announcement-common@0.5.2
  - @checkstack/auth-frontend@0.7.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/tips-frontend@0.3.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/announcement-common@0.5.1
  - @checkstack/auth-frontend@0.7.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/tips-frontend@0.3.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.4.0

### Minor Changes

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
  - @checkstack/ui@1.13.0
  - @checkstack/auth-frontend@0.7.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/announcement-common@0.5.0
  - @checkstack/signal-frontend@0.2.0

## 0.3.7

### Patch Changes

- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/auth-frontend@0.6.7
  - @checkstack/tips-frontend@0.2.7

## 0.3.6

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
  - @checkstack/auth-frontend@0.6.6
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/announcement-common@0.4.2
  - @checkstack/signal-frontend@0.1.5

## 0.3.5

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
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/ui@1.10.0
  - @checkstack/announcement-common@0.4.1
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.3.4

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/tips-frontend@0.2.4

## 0.3.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/tips-frontend@0.2.3

## 0.3.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/tips-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/announcement-common@0.4.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.3.0

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
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/announcement-common@0.3.2
  - @checkstack/signal-frontend@0.1.2

## 0.2.16

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/announcement-common@0.3.1
  - @checkstack/common@0.8.0
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/frontend-api@0.4.2

## 0.2.15

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0

## 0.2.14

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
  - @checkstack/announcement-common@0.3.0
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/ui@1.6.1

## 0.2.13

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/announcement-common@0.2.2
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-frontend@0.0.16

## 0.2.12

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29

## 0.2.11

### Patch Changes

- @checkstack/auth-frontend@0.5.28

## 0.2.10

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27

## 0.2.9

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/auth-frontend@0.5.26

## 0.2.8

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/auth-frontend@0.5.25

## 0.2.7

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24

## 0.2.6

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23

## 0.2.5

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22

## 0.2.4

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/auth-frontend@0.5.21

## 0.2.3

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20

## 0.2.2

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/auth-frontend@0.5.19

## 0.2.1

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
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/frontend-api@0.3.9
  - @checkstack/announcement-common@0.2.1
  - @checkstack/signal-frontend@0.0.15

## 0.2.0

### Minor Changes

- dee86ec: feat: add portal announcement system

  Introduces a complete announcement system for communicating with portal users:

  - **announcement-common**: Zod schemas for announcements (severity, visibility, display mode), oRPC contract with 6 procedures (public retrieval, user dismissal, admin CRUD), access rules, and `ANNOUNCEMENT_UPDATED` signal definition
  - **announcement-backend**: Drizzle schema with `announcements` and `announcement_dismissals` tables, router with temporal filtering, visibility control, per-user dismissal persistence, user cleanup hook, real-time signal broadcasting on create/update/delete, and command palette registration ("Create Announcement", "Manage Announcements" with `⇧⌘A` shortcut)
  - **announcement-frontend**: Admin management page with create/edit dialog, global banner component above the navbar (severity-colored, expandable markdown), dashboard cards with compact expand/collapse, admin menu link, and real-time WebSocket signal subscription for instant UI updates
  - **frontend**: Integrates AnnouncementBanner into App.tsx for global visibility

### Patch Changes

- Updated dependencies [dee86ec]
  - @checkstack/announcement-common@0.2.0
