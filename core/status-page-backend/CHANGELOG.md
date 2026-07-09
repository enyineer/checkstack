# @checkstack/status-page-backend

## 0.6.0

### Minor Changes

- bd41130: fix(status-page): scope email subscriptions to published environments and author-selected systems

  Two correctness fixes to status-page email subscriptions:

  - **Health notifications now respect the page's published environments.** A
    per-environment health transition carries the environment it happened in
    (`originEnvironmentId`, threaded through `notifyForSubscription` ->
    `NotificationAudienceEvent` -> the status-page fan-out). A page that publishes
    a specific environment set is now skipped for a change in an environment it
    does not publish - so a `development` failure never emails a prod-only page's
    subscribers, even for a system that is also shown in prod. Pages publishing all
    environments, and env-less sources (incident, maintenance, whole-system health
    rollup), are unaffected.
  - **Notifications are scoped per category to the widgets the author placed.** The
    send-time fan-out now surfaces a notification only through widgets of its own
    category: a health status change reaches a page only through a HEALTH widget
    (`banner` / `systemHealth` / `groupStatus` / `uptime`, which now implement
    `resolveScopedSystems` and declare `subscriptionCategory: "health"`), an
    incident only through an incident widget, and so on. A page that lists a
    system's incidents but never its health no longer emails health subscribers
    about it, and a health-only page now correctly surfaces its systems for
    subscription. Health widgets also participate in the public subscribe picker.

  BREAKING CHANGE: on a page publishing a specific environment set, health
  subscribers now only receive changes that occurred in a published environment
  (previously any environment of a surfaced system triggered a notification), and a
  notification is surfaced only by a widget of its own category (previously any
  scoping widget on the page could surface any category). Legacy subscribers (NULL
  categories) and all-environment pages are unchanged; no data migration is needed.

- bd41130: perf(status-page): add composite index `status_page_subscribers_page_verified_idx` on (status_page_id, verified)

  Serves the verified-subscriber email fan-out query
  `WHERE status_page_id = ? AND verified = true`, run once per surfaced page per
  incident/maintenance/health event. The existing plain
  `status_page_subscribers_page_idx` on (status_page_id) left `verified` as a heap
  filter; the composite index covers both predicates. The plain index is retained
  (migrations are append-only).

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/notification-backend@1.8.0
  - @checkstack/notification-common@1.7.0
  - @checkstack/command-backend@0.2.23
  - @checkstack/status-page-common@0.6.1

## 0.5.0

### Minor Changes

- 43e4484: Status pages can now publish only a subset of catalog environments. The page
  builder gains a "Published environments" picker (empty = all environments, the
  backward-compatible default). When a non-empty set is selected, the page omits
  status, incidents, maintenances and uptime for systems that belong to none of
  the selected environments.

  - Status pages store an optional `publishedEnvironmentIds` set (new nullable
    `published_environment_ids` column; NULL = all environments, so existing pages
    are unchanged) exposed on `StatusPage`, `createStatusPage`, and
    `updateStatusPage`.
  - The scope is threaded onto `WidgetResolveContext.publishedEnvironmentIds` as
    opaque strings and passed identically to `resolvePublic`,
    `resolveScopedSystems`, and `resolveScopedSystemsDetailed` (and the email
    subscribe clamp + fan-out), so what a page shows, offers for subscription, and
    emails about all agree.
  - Health widgets recompute per environment: they read the per-environment health
    matrix and roll up only the selected environments. `getBulkRunStats` and
    `getRunStats` gain an optional `environmentIds` filter so uptime counts only
    runs recorded in the selected environments.
  - Incident and maintenance widgets filter their feed and scope by intersecting
    each item's affected systems with the environment-visible systems. Incidents
    and maintenance windows carry no environment of their own, so a system in
    several environments makes its items visible on a page publishing ANY of them
    (the multi-environment caveat).

- 43e4484: Granular status-page email subscriptions: subscribers now choose WHICH update
  categories (Incidents, Scheduled maintenance, Health & status changes) and WHICH
  systems (all systems on the page, or a chosen subset) they receive, instead of
  the previous all-or-nothing fan-out.

  - New subscriptions default to incidents + maintenance (health OFF) and all
    systems. Legacy subscribers (NULL scope) keep receiving everything, so the
    change is fully backward compatible.
  - The subscribe endpoint clamps invalid categories and systems not surfaced by
    the page silently, preserving its constant, non-enumerable response.
  - Send-time fan-out (`notifyForSystems`) now honors each subscriber's category
    scope (derived from the notification's source plugin: incident -> incident,
    maintenance -> maintenance, healthcheck -> health) and system scope, on top of
    the existing page-scope privacy boundary.
  - The public subscribe form gains category checkboxes and an all/selected system
    chooser; the admin subscriber list shows each subscriber's scope. The public
    read exposes the page's subscribable systems, resolved from the same live scope
    source the fan-out uses so the picker can never offer a hidden system.

  Adds a nullable `categories` / `system_ids` column to `status_page_subscribers`
  (forward-only migration; existing rows stay NULL = "everything").

  Docs: updated the notifications subscriptions guide and the status-pages
  architecture page to describe per-subscription category + system scope.

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

- 43e4484: Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

  The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

  - healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
  - incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
  - ai: `appendMessage`, memory `saveOrUpdate`.
  - notification: `resolveInheritedGroups`.
  - status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
  - announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
  - gitops: `upsertProvenance`.

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
  - @checkstack/backend-api@0.31.1
  - @checkstack/notification-common@1.6.0
  - @checkstack/notification-backend@1.7.0
  - @checkstack/status-page-common@0.6.0
  - @checkstack/command-backend@0.2.22

## 0.4.8

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/command-backend@0.2.21
  - @checkstack/status-page-common@0.5.3

## 0.4.7

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/command-backend@0.2.20

## 0.4.6

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/command-backend@0.2.19
  - @checkstack/status-page-common@0.5.2

## 0.4.5

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/command-backend@0.2.18
  - @checkstack/status-page-common@0.5.1

## 0.4.4

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/command-backend@0.2.17

## 0.4.3

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/command-backend@0.2.16

## 0.4.2

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/status-page-common@0.5.0
  - @checkstack/command-backend@0.2.15

## 0.4.1

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/status-page-common@0.4.1

## 0.4.0

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
  - @checkstack/backend-api@0.26.0
  - @checkstack/status-page-common@0.4.0
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0

## 0.3.0

### Minor Changes

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

### Patch Changes

- 8cad340: Widen Cmd+K command-palette coverage to every top-level sidebar destination.

  The command palette previously only surfaced commands from a handful of plugins,
  so large feature areas were silently unreachable from search. Each of these
  plugins now registers a "navigate to <feature>" command per top-level route via
  `registerSearchProvider`, so every sidebar destination they own is reachable
  from Cmd+K (entity search can come later):

  - dependency: "Dependency Map"
  - status-page: "Status pages"
  - satellite: "Satellites"
  - gitops: "GitOps", "Kind Registry"
  - secrets: "Secrets"
  - notification: "Notification Settings"
  - script-packages: "Script Packages", "Script Sandbox"

  Each command reuses the plugin's own route helper (`resolveRoute`) for its href
  and carries the same access rule that gates its sidebar nav entry, so palette
  visibility matches sidebar visibility. The notification command carries no
  access rule, matching its authenticated-only nav entry.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/status-page-common@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1

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

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/status-page-common@0.2.0

## 0.1.0

### Minor Changes

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

- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/status-page-common@0.1.0
