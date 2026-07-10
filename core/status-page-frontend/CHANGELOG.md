# @checkstack/status-page-frontend

## 0.7.2

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/auth-frontend@0.13.3
  - @checkstack/catalog-common@2.7.2
  - @checkstack/status-page-common@0.6.2

## 0.7.1

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/frontend-api@0.14.2
  - @checkstack/auth-frontend@0.13.2
  - @checkstack/catalog-common@2.7.1
  - @checkstack/status-page-common@0.6.1

## 0.7.0

### Minor Changes

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

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/catalog-common@2.7.0
  - @checkstack/ui@1.26.0
  - @checkstack/status-page-common@0.6.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/auth-frontend@0.13.1

## 0.6.0

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

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/status-page-common@0.5.3

## 0.5.4

### Patch Changes

- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/auth-frontend@0.12.0
  - @checkstack/ui@1.25.0

## 0.5.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/status-page-common@0.5.2

## 0.5.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/catalog-common@2.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/status-page-common@0.5.1

## 0.5.1

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1

## 0.5.0

### Minor Changes

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

- Updated dependencies [0d912a3]
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
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/status-page-common@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2

## 0.4.1

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/frontend-api@0.12.1
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
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/auth-frontend@0.10.0
  - @checkstack/status-page-common@0.4.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/common@0.17.0

## 0.3.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1

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
