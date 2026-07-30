# @checkstack/frontend-api

## 0.18.0

### Minor Changes

- 88f4333: Link incidents and maintenances with `#` mentions

  Typing `#` in a markdown field now opens a picker over every mentionable record
  and inserts a reference. Referencing another record previously meant pasting a
  URL, which cannot be right everywhere: an admin URL is meaningless on a public
  status page, a status-page URL is meaningless in the admin UI, and neither works
  in an email.

  A mention therefore stores WHAT it points at, never where:
  `[Database upgrade](checkstack:maintenance/<id>)`. That is an ordinary markdown
  link - readable in the raw source, parsed unchanged by existing tooling - and
  only the href is resolved per render context.

  Resolution may REFUSE: a resolver returning nothing renders the label as plain
  text rather than a link. That is a confidentiality property, not a nicety - an
  internal-only incident referenced from a public status update must not become a
  link that confirms it exists. A renderer given no resolver links nothing.

  Incident and maintenance detail pages gained a **Referenced items** section,
  derived by scanning the authored markdown on each render. Nothing is stored
  twice, so an edit that drops a reference drops it from the list too.

  The platform owns the contract (`registerMentionRoutes` / `setMentionSearch` in
  `@checkstack/frontend-api`); each owning plugin registers its own type, so no
  plugin imports another. Search only ever offers records the caller may read.

  Scope: resolution is wired for the admin UI. Public status pages and notification
  bodies do not resolve mentions yet, so a mention renders there as plain text -
  the safe default above, not a broken link.

  Precisely: the admin resolver maps a well-formed reference to a route WITHOUT
  checking that the target still exists or that this viewer may read it, so a
  mention to a deleted or unreadable record links to a not-found or an access gate.
  That is deliberate - gating on the provider's fetched list would silently
  downgrade valid references to plain text (the incident search excludes resolved
  incidents by default), and silently dropping a valid link is worse than one that
  lands on a gate the backend already enforces. The confidentiality property is
  carried by the public renderers, which resolve nothing.

- 88f4333: Resolve `#` mentions on public status pages, and check viewability in the admin UI

  Cross-entity mentions previously resolved only in the admin UI, and did so
  without asking whether the reader could actually open the target. Public
  surfaces resolved nothing at all. Three changes, one per delivery context.

  **The admin UI now checks viewability.** `useMentionResolution({ documents })`
  collects the references a page is about to render and asks each owning plugin -
  in ONE batched request - which of them this viewer may read. A mention to a
  deleted or unreadable record now renders as plain text instead of a link to a
  not-found page or an access gate. Backed by new `resolveIncidentRefs` /
  `resolveMaintenanceRefs` procedures, which return ids only (so an unreadable
  record is indistinguishable from a deleted one) and carry the same `listKey`
  read post-filter as their list procedures. They are deliberately not a filter
  over the authoring search list, which hides resolved incidents and would
  silently downgrade valid references.

  **Public status pages now resolve mentions.** A reference becomes a link to the
  target's public detail page when - and only when - the same page publishes that
  target, which is exactly the anti-enumeration gate the detail pages already
  apply. So an operator writing "caused by #Database upgrade" in a public update
  gets a working link, while a mention of an internal-only incident stays plain
  text rather than becoming a link that confirms it exists. Widgets opt in by
  declaring a `mentionType`, so the status-page packages take no dependency on any
  domain plugin.

  **BREAKING CHANGE (behavioural, no API change):** the in-app public status page
  at `/statuspage/view/<slug>` now builds detail-page hrefs. Previously it passed
  none, so incident and maintenance titles rendered as plain text there while the
  same page on a custom domain linked them. Both now behave identically.

  **Notification bodies no longer leak the internal scheme.** `checkstack:` is
  meaningless outside a Checkstack renderer, and channels leaked it differently:
  the email sanitiser stripped the href and left a dead anchor, while Slack's
  mrkdwn emitted `<checkstack:maintenance/9f1c-abc|Database upgrade>` straight to
  the recipient (Discord, Telegram and Teams render markdown natively and would
  have passed it through too). `sanitizeUpdateMessage` now flattens every mention
  to its label before the body reaches any channel, so no channel has to know the
  scheme exists. Flattening also happens before the length bound, so the excerpt
  budget is spent on visible text rather than on an internal URI.

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/signal-common@0.3.2

## 0.17.0

### Minor Changes

- be74b01: Let team members and managers see and manage their own team without a global rule

  Opening the "Who can change this" team-access modal (e.g. on a system) as a
  team manager failed with "Couldn't load team access. Retry or reopen the
  editor.", because the backend 403'd `getTeams` and denied `listObjectRelations`.
  The team-read procedures were gated on the GLOBAL `auth.teams.read` rule, which
  a team-scoped user (a per-team ReBAC grant, no global rule) does not hold - so
  managers and members were locked out of their own team, and managers who tried
  to add / remove / promote members would have been 403'd too.

  The read/metadata procedures (`getTeams`, `getTeam`, `listObjectRelations`,
  `listObjectRelationsBulk`, `listSubjectRelations`, `listTeamCreateGrants`,
  `searchUsers`, `resolveResourceNames`, `getResourceKinds`) are no longer gated
  on the global rule. Each now scopes in the handler:

  - A caller holding global `auth.teams.read` (or a trusted service) still sees
    every team.
  - Everyone else sees ONLY the team(s) they are a member or manager of.
    `getTeams` returns just those teams, `getTeam` returns `undefined` for a team
    the caller has no stake in (no existence leak), and `listObjectRelations` /
    `listObjectRelationsBulk` hide an object's team grants from a caller with no
    stake while still returning the public flag - a successful, empty response,
    never a 403.
  - `searchUsers` keeps its own guard: the directory is still searchable only by a
    global team-manager or a manager of at least one team.

  Team WRITE procedures (`updateTeam`, `addUserToTeam`, `removeUserFromTeam`,
  `addTeamManager`, `removeTeamManager`) already enforced
  `assertTeamManagementAccess` (service, global `teams.manage`, or manager of the
  specific team) and now pass the middleware so a team manager can actually manage
  their own team. Creating and deleting whole teams stays admin-only
  (`auth.teams.manage`).

  Frontend: the standalone Teams page and its nav entry are now shown to a global
  `auth.teams.read` holder OR any user who is a member/manager of at least one
  team - not unconditionally to every authenticated user, and no longer requiring
  the global rule. A user in no team (and holding no global rule) does not see it.
  This is driven by a new `isInAnyTeam` flag on the app-wide `accessRules` query
  (member OR manager, so manager-only teams count), threaded into the sidebar's
  nav-visibility model and exposed to every route's `isVisible` predicate via a
  new `isInAnyTeam` context field (`@checkstack/frontend-api`). The page
  self-scopes via the now-scoped `getTeams`, and per-team management affordances
  stay gated on managing that team.

  BREAKING CHANGE: `auth.teams.read` no longer gates the team read procedures at
  the middleware. If you relied on that rule to hide team existence from
  authenticated users, note that a user now sees the teams they belong to
  regardless; access to a specific team's data is still limited to its
  members/managers or a global-rule holder.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

## 0.16.1

### Patch Changes

- 6c8b36b: Fix a `usePluginClient` wrapped-client cache miss that rebuilt every plugin's
  hook wrappers per component instance. The cache was keyed on
  `pluginUtils = orpcUtils[pluginId]`, but indexing the oRPC `RouterUtils` proxy
  can return a fresh object each render, so gate-heavy pages (e.g. the catalog
  manager, where every system row mounts several auth-gated badges/actions) missed
  the cache and reallocated the whole wrapper (the AuthApi contract alone is ~80
  procedures) per row - a real main-thread GC storm on navigation. The cache is now
  keyed on the stable memoized `orpcUtils` root, so each plugin's wrapper is built
  once app-wide and shared by every instance.
- Updated dependencies [6c8b36b]
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1

## 0.16.0

### Minor Changes

- a74fa01: Fix the catalog manage page render storm: with many visible systems, every
  parent render (typing in the filter, any query refresh, opening a dialog)
  re-rendered every row's slot fillers - rows x fillers x auth/query hook trees

  - profiling as a GC-dominated main thread.

  - `ExtensionSlot` now renders each extension through a memoized component
    that bails out on SHALLOW slot-context equality (`slotContextEquals`,
    regression-tested): inline context objects keep working, but an unchanged
    row no longer re-runs its fillers. Call sites must keep context VALUES
    referentially stable - primitives are free, memoize arrays/objects (the
    catalog already memoizes `visibleSystemIds`).
  - `useCanAccessType`/`useSurfaceAccess` (`useTypeSurface`) now resolve the
    global rule and the authenticated gate from ONE `useAccessRules` call
    instead of two, halving the session/rules query observers each gated
    control allocates - noticeable when the gate is mounted once per row.

- 4568dcc: Add per-resource scoping to realtime signal auto-invalidation. Signals may now
  declare an optional `resourceKey` extractor (`createSignal({ ..., resourceKey })`);
  when a received signal carries one and it yields an id, `SignalAutoInvalidator`
  narrows invalidation from the whole owning plugin's react-query cache to only
  the queries whose key contains that resource id, plus queries that opted into
  whole-plugin refresh with `meta: { signalScope: "plugin" }` (exported as
  `signalScopeMeta`). A plugin registers its resource-scoped signal defs on its
  frontend config's new `signals` field so the invalidator can recover the
  extractor from a received signal's id. The invalidation coalescer now buckets on
  `pluginId` + `resourceId`, so bursts for different resources stay independent.

  This is fully backward compatible: a signal WITHOUT a `resourceKey` keeps the
  original blanket-plugin invalidation, so every existing signal behaves exactly
  as before. Foreign (`foreignSignals`) invalidation also stays blanket.

  Logstream adopts it: `LOGSTREAM_ACTIVITY` and `LOGSTREAM_IMPORTANT_EVENT` scope
  to their `streamId`, so a viewer on one stream's detail page is no longer
  refetched (including the heavy list-page summaries) whenever any other stream
  ingests. The stream list page opts its two resource-agnostic queries back into
  whole-plugin refresh with `signalScopeMeta`.

### Patch Changes

- Updated dependencies [4568dcc]
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0

## 0.15.0

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

## 0.14.2

### Patch Changes

- b80160a: perf(frontend-api): share the wrapped plugin client across component instances

  `usePluginClient` memoized `wrapPluginUtils` per component instance only.
  `wrapPluginUtils` walks a plugin's ENTIRE contract and allocates a hook-wrapper
  closure per procedure (the AuthApi contract alone is ~80), so a page that gates
  many rows on auth - the catalog manager, where every system row mounts several
  auth-gated badges/actions (each calling `usePluginClient(AuthApi)` via
  `useResourceAccess`/`useAccess`/`useProcedureAccess`) - rebuilt the whole wrapper
  once PER ROW on navigation: hundreds of throwaway closures and a main-thread GC
  storm (visible in a profile as `updateMemo` hot under every gating hook, ~half
  its time in GC/CC).

  The wrappers are render-agnostic - their methods call React hooks at CALL time
  and close over only stable values - so the wrapped object is a pure function of
  `(pluginUtils, contract)` and safe to build ONCE and share. It is now cached in
  a module-level WeakMap keyed on the stable `pluginUtils` (with the contract as a
  second key), so it is built once per plugin and reused by every caller, and the
  whole cache falls away automatically when the provider re-creates its rpc client.
  This collapses navigation cost from O(instances x procedures) to
  O(plugins x procedures).

## 0.14.1

### Patch Changes

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

## 0.14.0

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

- f93ee7a: Fuse authorization into the RPC call so a frontend gate can't drift from - or be
  forgotten alongside - the procedure it guards. This is the structural endpoint of
  the contract-derived gating work: instead of pairing `client.X.useMutation()` with
  a separate `useProcedureAccess(X)`, the gate is welded to the call.

  - `useGatedMutation` / `useGatedQuery` (`@checkstack/frontend-api`): the plugin
    client's mutation/query hooks now have gate-fused variants that derive the
    authorization verdict from the SAME contract procedure and input the call uses
    and return it as `{ allowed, accessLoading }` on the result. A control cannot
    obtain `mutate` without the verdict, and a gated query stays disabled until the
    caller is authorized (no guaranteed-403 fetch). The id a mutation gates on is
    passed as `gateInput` (e.g. `{ id }`), the same id `mutate` will send.
  - `accessApi.useSurfaceAccess(procedure)` (`@checkstack/auth-frontend`): the
    coarse "can the user reach this management surface" gate, DERIVED from a
    representative procedure of the page (its access rule + object/parent type from
    the contract) instead of hand-passed `objectType`/`parentType` that can drift.
    Generalizes the hand-authored `useCanAccessType` surface gate.
  - Runtime gating-drift detector (`@checkstack/backend-api`): the auth middleware
    logs, in dev/e2e only (no-op in production), when a real user is denied a
    global-only gate - a candidate for the "shown-but-denied" drift class. A
    belt-and-suspenders net for hand-rolled/dynamic call paths the fused hooks
    don't cover.

  The automation editor is the reference surface: its create/update gates are fused
  directly into the create/update mutations, so there is no separate gate hook to
  keep in sync, and its surface gate uses `useSurfaceAccess`. The run-detail page's
  "Cancel run" control is also fused onto
  `cancelRun` - a real drift fix: it previously gated on a bare
  `useAccess(automation.manage)` (the GLOBAL rule), so a team-scoped manager with a
  grant on the automation but no global rule saw no Cancel button even though the
  `parentScope`d backend would authorize them; the fused gate derives the verdict
  from the page's `automationId`, so they now see it. A
  `checkstack/prefer-gated-mutation` lint rule (dev tooling, scoped, `warn`) nudges
  raw `.useMutation()` toward the fused variant so fusion is the default and raw
  mutations become the deliberate, greppable exception (the remaining raw automation
  mutations - per-row toggle/delete gated via `useResourceAccess`, and the
  stateless `renderTemplate` utility - carry a documented suppression).

  No behavior change for existing call sites: `useMutation` / `useQuery` /
  `useCanAccessType` are unchanged and remain for per-row arrays, non-procedure
  gates, and compound controls.

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/signal-common@0.2.17

## 0.13.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/signal-common@0.2.16

## 0.13.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/signal-common@0.2.15

## 0.13.0

### Minor Changes

- d9f4654: Add `auditManageCapabilities`, a pure RLAC drift auditor. Given the plugins and
  the set of backend-team-scopable resource types, it returns every management
  route/nav entry that is gated on a team-scopable `manage` rule but is missing (or
  mis-declares) its `manageCapability` - the class of bug where a team-scoped user
  can act per the backend but never sees the surface. A new CI check
  (`bun run check:manage-capabilities`) derives the team-scopable types from the
  backend contracts' `instanceAccess` (mirroring the RPC middleware's grant keying)
  and runs the auditor over the real plugins, failing when frontend gating drifts
  from the backend authorization contract.
- eab80e3: Add an instance-namespace runtime mode so a secondary backend instance can run
  alongside the default one on shared external infrastructure without colliding.

  - `@checkstack/backend-api` now exposes `coreServices.instanceRuntime`
    (`InstanceRuntime { namespace, isDefault }`) plus `parseInstanceNamespace` /
    `createInstanceRuntime` / `instanceNamespaceSchema`. The core backend reads
    `CHECKSTACK_INSTANCE_NAMESPACE` at boot (validated, failing fast on a bad
    value), registers the service, and advertises a non-empty namespace on
    `/api/config`.
  - Plugin-author contract: a plugin that keeps state on infrastructure SHARED
    across instances (redis key space, shared cache prefix, consumer group, topic)
    MUST fold `instanceRuntime.namespace` into that key/name. Namespace rather than
    suppress: user-visible behaviour keeps running in a secondary instance, only
    the shared keys change. See the new "Parallel instances and namespacing"
    developer-guide page.
  - `@checkstack/queue-bullmq-backend` is the reference implementation: it folds
    the namespace into the effective redis key prefix (`checkstack:` becomes
    `checkstack:preview:` under the `preview` namespace), isolating queues, jobs,
    schedulers and consumer groups. The default instance's prefix is byte-for-byte
    unchanged.
  - The admin frontend shows a slim "preview instance" banner when the runtime
    config carries a non-empty `instanceNamespace`.

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

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/signal-common@0.2.14

## 0.12.1

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/signal-common@0.2.13

## 0.12.0

### Minor Changes

- 2e20792: Speed up app loading: inline boot config, load plugins non-blocking, stream the shell

  The SPA used to hold a full-page spinner through a serial boot waterfall before
  first paint: it fetched `/api/config` (twice) and `/api/plugins`, then awaited
  every plugin's registration before rendering anything.

  - **Inlined bootstrap (backend).** The backend now injects a small
    non-user-specific blob (`config` + `enabledPlugins`) into the served HTML, and
    the frontend reads it synchronously via `readBootstrap()`. This removes the
    boot-time `/api/config` and `/api/plugins` round-trips entirely. The per-user
    session is not inlined (it stays a better-auth fetch); the HTML is served
    `no-cache`. The Vite dev server has no blob, so it falls back to the original
    fetches.
  - **Non-blocking plugin load (frontend).** Local (bundled) plugins register
    synchronously and the shell renders immediately; remote (installed) plugins
    load in the background and register reactively, so first paint no longer waits
    on the plugin network phase.
  - **Skeleton-streamed first paint (frontend).** Route pages and the
    pre-providers window now show content/shell skeletons instead of full-page
    spinners, so the chrome stays put and only content streams in.

  `RuntimeConfigProvider` seeds from the inlined config and skips the reachability
  probe for a same-origin `baseUrl`; a misconfigured cross-origin `BASE_URL` still
  surfaces the same loud error.

### Patch Changes

- Updated dependencies [2e20792]
  - @checkstack/signal-common@0.2.12
  - @checkstack/common@0.17.0

## 0.11.1

### Patch Changes

- 8cad340: Give failed plugin pages and shell render errors a real, actionable fallback.

  A plugin page that throws or fails to code-split previously fell back to a bare
  line of text ("This page failed to load. Try reloading."), and
  `PluginErrorBoundary`'s default fallback was an invisible `null`, so a broken
  slot extension simply vanished.

  - The route-level error fallback in `@checkstack/frontend` is now a real
    `error`-variant card (icon + message + a "Reload page" button) that mirrors
    the look of `@checkstack/ui`'s `QueryErrorState`. It reloads the page rather
    than retrying a single query, since a failed module/render can't be retried in
    place.
  - Added a top-level `ShellErrorBoundary` around the app so a render error
    OUTSIDE a plugin contribution (in the chrome, a slot, or a provider) degrades
    to the same friendly, reloadable fallback instead of white-screening.
  - `LazyContribution`'s `PluginErrorBoundary` now renders a small, visible
    "this section failed to load" notice with a reload action as its default,
    instead of invisible `null`, so contributions without an explicit
    `errorFallback` degrade visibly. The default stays framework-agnostic so
    `frontend-api` keeps no dependency on `@checkstack/ui`.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0
  - @checkstack/signal-common@0.2.11

## 0.11.0

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

## 0.10.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0
  - @checkstack/signal-common@0.2.10

## 0.9.0

### Minor Changes

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

- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0
  - @checkstack/signal-common@0.2.9

## 0.8.0

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

- @checkstack/common@0.14.1
- @checkstack/signal-common@0.2.8

## 0.7.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/signal-common@0.2.8

## 0.7.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/signal-common@0.2.7

## 0.7.0

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

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

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
  - @checkstack/common@0.13.0
  - @checkstack/signal-common@0.2.6

## 0.6.0

### Minor Changes

- e2d6f25: feat(automation): connection picker for integration actions + restore Integrations menu

  Connection-backed automation actions (Jira, Teams, Webex) now render a
  working connection picker plus cascading provider dropdowns in the
  visual editor, and the Integrations entry is back in the user menu.

  **Contract.** `ActionDefinition` gained an optional
  `connectionProviderId` (and it is surfaced on `ActionInfoSchema` and
  mapped in the `listActions` router). It carries the integration
  provider's fully-qualified id, derived from the provider plugin's own
  `pluginMetadata.pluginId` (never a hardcoded string), so the editor
  knows which provider backs an action's dropdowns and it matches the
  `qualifiedId` the integration provider registry assigns.

  **Providers.** Jira, Teams and Webex each export
  `*_PROVIDER_LOCAL_ID` / `*_PROVIDER_QUALIFIED_ID`, register their
  provider with the local id, and add a `CONNECTION_OPTIONS`
  (`"connectionOptions"`) resolver name. Their `post_message` /
  issue actions set `connectionProviderId` and expose `connectionId`
  as an `x-options-resolver` dropdown instead of a hidden field.

  **Frontend bridge.** A new `useConnectionOptionResolvers` hook
  (`@checkstack/automation-frontend`, which now depends on
  `@checkstack/integration-common`) turns an action's
  `x-options-resolver` schema fields into live data: the
  `connectionOptions` resolver lists the provider's connections via
  `listConnections`, and every other resolver name is forwarded to
  `getConnectionOptions` for the selected `connectionId`, passing the
  live form values as `context` for dependent fields. `ProviderActionBody`
  now passes this map to `DynamicForm` (it was previously missing
  entirely, so connection-backed actions had no working dropdowns).

  **frontend-api.** `usePluginClient` procedures now also expose a typed
  imperative `.call(input)` alongside `.useQuery` / `.useMutation`, for
  async callbacks that cannot host a hook (such as a `DynamicForm`
  options resolver). Additive, non-breaking.

  **Integrations menu.** Re-added `IntegrationMenuItem` and a new
  `IntegrationsLandingPage`, wired into `integration-frontend` as a list
  route and a `UserMenuItemsSlot` entry under the "Configuration" group.

  **Action card polish.** The action editor's secondary metadata (id,
  description, failure behaviour) is now grouped into one quiet settings
  panel with consistent small uppercase "eyebrow" labels, so the action's
  own configuration stays the focal point. The raw failure checkbox was
  replaced with the standard `Checkbox` control, and the provider action
  picker / configuration sections gained consistent section headers and a
  divider. The per-step "type" dropdown was removed: an action's kind is
  fixed at creation, so changing it now means adding a new step and
  deleting the old one (avoids the surprising full-config reset that
  switching kinds used to trigger).

  **Add-step picker.** Adding a step now opens a Home-Assistant-style
  dialog where the operator decides the step type up front: an "Actions"
  tab lists the registered provider actions grouped by category
  (searchable; picking one presets the step's `action`), and a "Blocks"
  tab lists the structural building blocks (choose / parallel / repeat /
  etc.). Because the concrete action is chosen here, the in-card action
  switcher was removed - a step's action is fixed once created. Composite
  blocks now start with an empty child list (filled via the nested
  add-step picker) instead of seeding an unconfigurable empty action.

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0
  - @checkstack/signal-common@0.2.5

## 0.5.2

### Patch Changes

- f23f3c9: Establish the canonical optimistic-UI pattern for oRPC mutations
  (`onMutate` snapshot / patch, `onError` rollback, `onSettled`
  invalidate) and apply it to the two highest-frequency toggles where
  perceived latency was most visible:

  - `markAsRead` on the Notifications page — clicking the check on a
    notification card now flips the read state immediately instead of
    waiting for the round-trip.
  - `pauseConfiguration` / `resumeConfiguration` on the Health Check
    Config page — pause/resume now flip the row's badge instantly,
    rolling back on server error.

  The wrapper type for `useMutation` on each plugin client gained an
  optional `TContext` generic so optimistic sites can return a snapshot
  from `onMutate` and consume it in `onError` without `unknown` casts.
  The runtime behaviour and the auto-invalidation on success are
  unchanged; the change is additive on the type surface only.

  Full pattern and "when NOT to use it" guidance live in
  `docs/frontend/optimistic-updates.md`.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/signal-common@0.2.4

## 0.5.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/signal-common@0.2.3

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/signal-common@0.2.2

## 0.4.2

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0
  - @checkstack/signal-common@0.2.1

## 0.4.1

### Patch Changes

- 32d52c6: Add missing workspace/runtime deps that were only resolving locally via stale `node_modules` symlinks: `@checkstack/signal-common` in `anomaly-backend` and `@orpc/contract` in `frontend-api`. Both were imported as `import type` and went unflagged by the `no-extraneous-runtime-deps` rule, but failed `tsc` on clean CI installs.

## 0.4.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0

## 0.3.11

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0

## 0.3.10

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

## 0.3.9

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

## 0.3.8

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4

## 0.3.7

### Patch Changes

- 0603d39: Fix onboarding flow not appearing on fresh Docker deployments (issue #79)

  The `.env.example` had `BASE_URL` defaulting to `http://localhost:5173`
  (the Vite dev server port). Users copying this file verbatim for a Docker
  deployment would get a frontend that silently made all API calls to the
  wrong origin, causing empty state and extreme sluggishness.

  **Changes:**

  - `.env.example`: Adds clear comments explaining the value must match the
    container's exposed port.
  - `frontend-api` (`RuntimeConfigProvider`): Removes the silent fallback when
    `/api/config` returns an unreachable baseUrl — instead propagates the error
    so it can be surfaced.
  - `frontend` (`App.tsx`): Renders an actionable error screen when the backend
    config cannot be loaded, showing the exact `BASE_URL` fix and the
    `docker compose` command to recover.
  - `docs/getting-started/docker.md`: Adds a dedicated troubleshooting section
    for this exact misconfiguration.

## 0.3.6

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3

## 0.3.5

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2

## 0.3.4

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1

## 0.3.3

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0

## 0.3.0

### Minor Changes

- 4eed42d: Fix "No QueryClient set" error in containerized builds

  **Problem**: The containerized application was throwing "No QueryClient set, use QueryClientProvider to set one" errors during plugin registration. This didn't happen in dev mode.

  **Root Cause**: The `@tanstack/react-query` package was being bundled separately in different workspace packages, causing multiple React Query contexts. The `QueryClientProvider` from the main app wasn't visible to plugin code due to this module duplication.

  **Changes**:

  - `@checkstack/frontend-api`: Export `useQueryClient` from the centralized React Query import, ensuring all packages use the same context
  - `@checkstack/dashboard-frontend`: Import `useQueryClient` from `@checkstack/frontend-api` instead of directly from `@tanstack/react-query`, and remove the direct dependency
  - `@checkstack/frontend`: Add `@tanstack/react-query` to Vite's `resolve.dedupe` as a safety net

## 0.2.0

### Minor Changes

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

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0

## 0.1.0

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

## 0.0.4

### Patch Changes

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2

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

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

### Patch Changes

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0

## 0.0.3

### Patch Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
  - @checkstack/common@0.1.0
