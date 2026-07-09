# @checkstack/incident-frontend

## 0.15.0

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

### Patch Changes

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
  - @checkstack/dashboard-frontend@0.10.6
  - @checkstack/notification-frontend@0.9.0
  - @checkstack/catalog-common@2.7.0
  - @checkstack/ui@1.26.0
  - @checkstack/incident-common@1.10.0
  - @checkstack/notification-common@1.6.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/auth-frontend@0.13.1
  - @checkstack/tips-frontend@0.4.11

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

- f93ee7a: Fix a class of 403s where team-scoped managers were blocked from endpoints they
  needed. A repo-wide audit of every `instanceAccess: { global: true }` procedure
  found more instances of the same bug behind the health-check editor fix: an
  endpoint on a team-scopable resource type, gated so only the GLOBAL access rule
  (never a team grant) authorizes it.

  Automation: the editor utilities and catalogs (`validateDefinition`,
  `listTriggers`, `listActions`, `listArtifactTypes`, `listAutomationGroups`,
  `listAutomationTemplates`, `renderTemplate`, `testScript`) now use `typeScoped`
  so a team-scoped automation manager can author without the global rule. The run
  endpoints (`listRuns`, `getRun`, `cancelRun`, `getRunScopeForReplay`) are scoped
  to their parent automation via `parentScope` on `automationId`; `getRun`,
  `cancelRun`, and `getRunScopeForReplay` now take the owning `automationId`
  (always available in the run URL/editor) and the handler filters the run fetch by
  it, so a run id cannot be paired with a foreign automation the caller happens to
  hold a grant on. The two migration-admin endpoints stay `global: true` (genuine
  platform-admin actions).

  Health check: `validateConfiguration` (editor deep-validate) and
  `getPlatformNotificationDefaults` (fetched on every assignment-editor mount) move
  to `typeScoped`. The paired WRITE `setPlatformNotificationDefaults` stays
  `global: true` on purpose - it rewrites instance-wide defaults for every team, so
  a single team grant must not authorize it. Because that write stays global-only,
  the assignment editor's "Notification defaults" button is now gated on the global
  `configuration.manage` rule (`healthcheck-frontend`), so a team-scoped manager no
  longer sees an editor whose Save always 403'd.

  Anomaly: the anomaly settings panels embedded in the health-check editor
  (`updateAnomalyConfig` / `getAnomalyConfig` and `updateAnomalyAssignmentConfig` /
  `getAnomalyAssignmentConfig`) were authorized against the non-team-scopable
  `anomaly_feed` type (via `global: true` or an `idParam` that could never match a
  team grant), so a team-scoped manager who owns the check/system saw "Save
  Defaults" / "Save Exceptions" buttons whose Save always 403'd. They now
  `parentScope` on the owning health-check configuration (`healthcheck.healthcheck`)
  and catalog system (`catalog.system`) respectively, so managing the check/system
  authorizes reading and editing its anomaly settings. The frontend needed no
  change: those buttons were already disabled for non-managers, and the panels are
  only reachable inside the manager-gated editor. Also, the automation "New
  automation" template picker (`automation-frontend`) gated its page on the bare
  global manage rule; it now uses the create capability, so a team-scoped creator
  (whom the route already reveals the page to) is no longer shown a blocked page.

  Incident & maintenance: `removeLink` was `global: true` because its input carried
  only the link id. It now takes the owning `incidentId` / `maintenanceId`
  (mirroring `addLink`), authorizes per-instance via `idParam`, and the service
  scopes the delete by that parent id so a link cannot be removed by pairing its id
  with a different incident/maintenance the caller manages. The AI `removeLink`
  tools carry the parent id too.

  BREAKING CHANGES: `automation.getRun`, `automation.cancelRun`,
  `automation.getRunScopeForReplay`, `incident.removeLink`, and
  `maintenance.removeLink` now require a parent id (`automationId` /
  `incidentId` / `maintenanceId`) in their input. Endpoints previously gated by a
  global rule alone now also accept the owning team's grant; no endpoint became
  more permissive for a user who lacks both the global rule and a relevant team
  grant.

  Not team-scopable, so intentionally left `global: true` (verified by the audit):
  catalog environments, anomaly config, SLO list/streak/milestone reads and
  health-check history/stats (their read rules are public/default), and every
  hand-rolled HTTP route (global admin/infra or already team-aware).

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/incident-common@1.9.0
  - @checkstack/dashboard-frontend@0.10.5
  - @checkstack/notification-common@1.5.3
  - @checkstack/notification-frontend@0.8.1
  - @checkstack/tips-frontend@0.4.10
  - @checkstack/signal-frontend@0.3.5

## 0.13.0

### Minor Changes

- 9d30324: Incidents can now optionally override the health status of their affected
  systems. When creating or editing an incident you can pick "Override system
  health" (Degraded or Unhealthy); while the incident is active (not resolved)
  that status is folded into every affected system's derived health via
  worst-wins, so it shows on every health surface (status pages, dashboards,
  dependency map, catalog badges). A health check reporting a worse status still
  wins, and the override lifts automatically when the incident resolves. This
  covers components that no automated check can monitor (e.g. a running app whose
  licenses were revoked so it won't open).

  The override is a deliberate operator choice, independent of the incident's
  severity. A new service-typed incident RPC `getActiveHealthOverrides` exposes
  active overrides per system, which `@checkstack/healthcheck-backend` reads and
  folds into `getSystemHealthStatus`. The system-health response gains an optional
  `override` field naming the contributing incident so UIs can explain why a
  system reads unhealthy when its checks look fine. The system health badge uses
  it to show, on hover, when a status was forced by an incident.

  The dashboard "problem system" signal attributes an override-forced status to
  the incident ("Forced by incident: <title>") instead of misreporting
  "0 of N checks failing", while a genuinely worse health check still drives the
  signal and its detail. Public status pages reflect the forced status but never
  carry the incident title (the widget DTOs project only the status), so an
  override cannot leak the name of a hidden incident.

  Behavior change: a system's derived health now reflects active incident
  overrides in addition to its health checks. Adds a forward-only migration for
  the new nullable `incidents.health_override` column.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  that shaped this release.

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

- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/incident-common@1.8.0
  - @checkstack/auth-frontend@0.12.0
  - @checkstack/notification-frontend@0.8.0
  - @checkstack/ui@1.25.0
  - @checkstack/dashboard-frontend@0.10.4
  - @checkstack/tips-frontend@0.4.9

## 0.12.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/dashboard-frontend@0.10.3
  - @checkstack/notification-frontend@0.7.3
  - @checkstack/tips-frontend@0.4.8
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/incident-common@1.7.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-frontend@0.3.4

## 0.12.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/catalog-common@2.6.1
  - @checkstack/dashboard-frontend@0.10.2
  - @checkstack/frontend-api@0.13.1
  - @checkstack/incident-common@1.7.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/notification-frontend@0.7.2
  - @checkstack/tips-frontend@0.4.7
  - @checkstack/signal-frontend@0.3.3

## 0.12.1

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1
  - @checkstack/notification-frontend@0.7.1
  - @checkstack/tips-frontend@0.4.6
  - @checkstack/dashboard-frontend@0.10.1

## 0.12.0

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

- e430fbe: Add "Mass delete" and "Mass resolve" to the Incidents and Maintenances lists,
  authorized per item (RLAC).

  The incidents and maintenances list pages now support multi-select with a bulk
  action bar. A user may only select and act on entries they are allowed to
  MANAGE: a row's checkbox appears only when the caller can manage it (the same
  `canAccess(id)` gate as the per-row actions), so a team-scoped member sees
  checkboxes only for their team's entries. Mass delete confirms before running;
  mass resolve (incidents) and mass complete (maintenances, the "resolve"
  equivalent = close, status -> completed) skip entries that are already
  resolved/completed. Each action reports a per-id partial-success summary
  (e.g. "3 deleted, 1 skipped").

  New backend procedures: `incident.bulkDeleteIncidents`,
  `incident.bulkResolveIncidents`, `maintenance.bulkDeleteMaintenances`, and
  `maintenance.bulkCloseMaintenances`. Each authorizes EACH id against the
  caller's manage grant and never fails open: unauthorized ids are filtered out
  before the handler runs and returned as `forbidden`; missing ids as `notFound`;
  a per-id failure is isolated as `error` without aborting the batch. Per-id cache
  invalidation, realtime signals, and subscriber notifications run for every
  success so dashboards and status pages stay consistent.

  Platform: a new `instanceAccess` mode `bulkManage: { idsParam }` is the
  enforcement point for bulk writes. Before the handler runs, `autoAuthMiddleware`
  partitions the input id array into the caller's manageable subset and the denied
  remainder and exposes both on `context.bulkAccess` (fail-closed on an S2S
  error). The boot-time contract validator (`validateContractInstanceAccess`)
  accepts `bulkManage` as one of the mutually-exclusive scoping modes, marks its
  type team-scopable, and cross-checks `idsParam` against the input schema.

  State and scale: authorization is derived per request from the shared team-grant
  store via the existing auth S2S path (no process-local state); the read returns
  the same answer on every pod. No database migration.

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
- Updated dependencies [d1b71b6]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [53666a7]
- Updated dependencies [b3b547c]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/auth-frontend@0.11.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/notification-frontend@0.7.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/incident-common@1.7.0
  - @checkstack/dashboard-frontend@0.10.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/tips-frontend@0.4.5
  - @checkstack/signal-frontend@0.3.2

## 0.11.4

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2
  - @checkstack/dashboard-frontend@0.9.4
  - @checkstack/notification-frontend@0.6.4
  - @checkstack/tips-frontend@0.4.4

## 0.11.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/dashboard-frontend@0.9.3
  - @checkstack/incident-common@1.6.4
  - @checkstack/frontend-api@0.12.1
  - @checkstack/notification-common@1.4.2
  - @checkstack/notification-frontend@0.6.3
  - @checkstack/tips-frontend@0.4.3
  - @checkstack/signal-frontend@0.3.1

## 0.11.2

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
  - @checkstack/incident-common@1.6.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/notification-frontend@0.6.2
  - @checkstack/tips-frontend@0.4.2
  - @checkstack/common@0.17.0

## 0.11.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1
  - @checkstack/dashboard-frontend@0.9.1
  - @checkstack/notification-frontend@0.6.1
  - @checkstack/tips-frontend@0.4.1

## 0.11.0

### Minor Changes

- 8cad340: Upgrade the Incident editor's form quality.

  - Inline, per-field validation: a single error map now drives both the inline
    `FormError` messages under the Title and Affected Systems fields and submit
    validity, replacing the submit-only generic toast. Errors reveal on blur /
    after a submit attempt (touched-based) so the form does not nag while typing.
  - The editor body is wrapped in `<form onSubmit>` with a `type="submit"`
    primary button, so Enter submits.
  - Mandatory fields (Title, Severity, Affected Systems) now render the `Label`
    `required` affordance.
  - Every label is associated with its control: the Severity select and the
    Affected Systems group are linked via `aria-labelledby`, and the Title input
    wires `aria-describedby` to its error.
  - The Title field auto-focuses when the dialog opens.
  - An unsaved-changes guard (via the `useUnsavedChanges` hook) warns on tab
    close / reload and shows a discard confirmation when closing a dirty form.

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
  - @checkstack/notification-frontend@0.6.0
  - @checkstack/tips-frontend@0.4.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/incident-common@1.6.2
  - @checkstack/signal-frontend@0.2.6

## 0.10.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/dashboard-frontend@0.8.11
  - @checkstack/incident-common@1.6.1
  - @checkstack/notification-frontend@0.5.9
  - @checkstack/tips-frontend@0.3.9
  - @checkstack/ui@1.16.2

## 0.10.0

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

- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/incident-common@1.6.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/dashboard-frontend@0.8.10
  - @checkstack/notification-frontend@0.5.8
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-frontend@0.2.5

## 0.9.9

### Patch Changes

- @checkstack/dashboard-frontend@0.8.9

## 0.9.8

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/auth-frontend@0.7.7
  - @checkstack/dashboard-frontend@0.8.8
  - @checkstack/notification-frontend@0.5.7
  - @checkstack/tips-frontend@0.3.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/incident-common@1.5.2

## 0.9.7

### Patch Changes

- @checkstack/auth-frontend@0.7.6
- @checkstack/catalog-common@2.3.5
- @checkstack/notification-frontend@0.5.6
- @checkstack/tips-frontend@0.3.6
- @checkstack/dashboard-frontend@0.8.7
- @checkstack/incident-common@1.5.1

## 0.9.6

### Patch Changes

- 0b6f01b: feat(incident): contribute incident signals to the backend system.issues aggregator

  The incident plugin now registers a `system.issues` contributor (sourceId
  `incident`) from its backend `init`, so the AI assistant surfaces open incidents
  alongside SLOs, health checks, anomalies, and dependency problems.

  The contributor enforces its own `incident.read` access gate (returning an empty
  map - never throwing - when the principal lacks access; service users carry no
  access rules and so get no signals), then reads every OPEN (not-resolved)
  incident for all systems from the shared, durable `incidents` +
  `incident_systems` tables via a new global `listOpenIncidentsBySystem` service
  method. The answer is therefore identical on every pod, and only systems with an
  open incident appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/since/iconName)
  is extracted into a new pure `deriveIncidentSignals` deriver in
  `@checkstack/incident-common`, shared by both the backend contributor and the
  frontend `IncidentSignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

- Updated dependencies [0b6f01b]
  - @checkstack/incident-common@1.5.0
  - @checkstack/dashboard-frontend@0.8.6

## 0.9.5

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

- Updated dependencies [0626782]
- Updated dependencies [460ffd6]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-frontend@0.7.5
  - @checkstack/dashboard-frontend@0.8.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/notification-frontend@0.5.5
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/incident-common@1.4.4
  - @checkstack/notification-common@1.3.3
  - @checkstack/tips-frontend@0.3.5
  - @checkstack/signal-frontend@0.2.4

## 0.9.4

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
  - @checkstack/dashboard-frontend@0.8.4
  - @checkstack/notification-frontend@0.5.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/catalog-common@2.3.3
  - @checkstack/incident-common@1.4.3
  - @checkstack/common@0.14.1
  - @checkstack/notification-common@1.3.2

## 0.9.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/auth-frontend@0.7.3
  - @checkstack/dashboard-frontend@0.8.3
  - @checkstack/notification-frontend@0.5.3
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-frontend@0.2.2

## 0.9.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-frontend@0.7.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/dashboard-frontend@0.8.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/notification-frontend@0.5.2
  - @checkstack/tips-frontend@0.3.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.9.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/auth-frontend@0.7.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/dashboard-frontend@0.8.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/incident-common@1.4.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/notification-frontend@0.5.1
  - @checkstack/tips-frontend@0.3.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.9.0

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

- 9dcc848: Guard component animations behind isLowPower, and add a shared inline Spinner.

  - `@checkstack/ui` shared components (`Tabs`, `ConfirmationModal`, `Accordion`, `CodeEditor` popout-button backdrop blur) now drop their `animate-*` / `backdrop-blur` classes when the device reports the low-power tier, matching `LoadingSpinner` / `Skeleton`. No public API change; normal-power rendering is unchanged.
  - A new shared inline `Spinner` (`@checkstack/ui`) renders a lucide `Loader2` whose `animate-spin` is gated internally behind `usePerformance().isLowPower`, so call sites inherit the low-power guard. Props: `size` (`sm`/`md`/`lg`), `className`, rest spread to the icon; decorative by default (`aria-hidden`), `role="status"` when given `aria-label`. The hand-rolled `Loader2` button/table spinners in `HealthCheckDrawer`, `HealthCheckRunsTable`, `IncidentEditor`, `IncidentUpdateForm`, `ProviderConnectionsPage`, `MaintenanceEditor`, `MaintenanceUpdateForm`, `UserChannelCard`, and `DynamicOptionsField` are migrated onto it.
  - Remaining unguarded `animate-*` / `animate-in` / blur classes across the auth, gitops, healthcheck, incident, integration, maintenance, and notification frontends are gated behind `usePerformance().isLowPower`, so effects degrade gracefully on low-power devices per the performance rule.

  Normal-power behavior is unchanged; low-power rendering drops the animations.

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
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/auth-frontend@0.7.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/dashboard-frontend@0.8.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/notification-frontend@0.5.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/incident-common@1.4.0
  - @checkstack/signal-frontend@0.2.0

## 0.8.8

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
  - @checkstack/dashboard-frontend@0.7.8
  - @checkstack/notification-frontend@0.4.7
  - @checkstack/tips-frontend@0.2.7

## 0.8.7

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
  - @checkstack/catalog-common@2.2.3
  - @checkstack/dashboard-frontend@0.7.7
  - @checkstack/incident-common@1.3.1
  - @checkstack/notification-frontend@0.4.6
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-frontend@0.1.5

## 0.8.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/incident-common@1.3.0
  - @checkstack/dashboard-frontend@0.7.6

## 0.8.5

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
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/notification-frontend@0.4.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/dashboard-frontend@0.7.5
  - @checkstack/ui@1.10.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/incident-common@1.2.2
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.8.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/ui@1.9.0
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dashboard-frontend@0.7.4
  - @checkstack/incident-common@1.2.1
  - @checkstack/notification-frontend@0.4.4
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/tips-frontend@0.2.4

## 0.8.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/dashboard-frontend@0.7.3
  - @checkstack/notification-frontend@0.4.3
  - @checkstack/tips-frontend@0.2.3

## 0.8.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/dashboard-frontend@0.7.2
  - @checkstack/notification-frontend@0.4.2
  - @checkstack/tips-frontend@0.2.2

## 0.8.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/dashboard-frontend@0.7.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/notification-frontend@0.4.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.8.0

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
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/notification-frontend@0.4.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/dashboard-frontend@0.7.0
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.7.1

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
  - @checkstack/notification-frontend@0.3.1
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/frontend-api@0.4.2
  - @checkstack/incident-common@1.0.1
  - @checkstack/notification-common@1.0.1

## 0.7.0

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

- 32d52c6: feat: notification target pattern + per-spec subscriptions

  Replaces the all-or-nothing catalog system/group notification model with a
  platform-level target pattern. Each notification-emitting plugin declares
  _subscription specs_ against typed _target_ objects exported from the
  target's owning plugin (catalog ships `catalogSystemTarget` and
  `catalogGroupTarget`). Notification-backend handles every per-resource
  group lifecycle, parent-edge inheritance, and legacy-subscription seeding
  — plugins never author groupId helpers, lifecycle hooks, or migration
  code again.

  **Plugin-author surface area is now ~12 lines per emitter:**

  ```ts
  // <plugin>-common
  const { defineSubscription } = createSubscriptionFactory(pluginMetadata);
  export const fooSystemSubscription = defineSubscription({
    localId: "system",
    target: catalogSystemTarget,
    display: { title: "Foo Alerts", description: "...", iconName: "Bell" },
  });

  // <plugin>-backend register()
  env.registerSubscriptionSpecs([fooSystemSubscription]);
  //   ^ feeds the plugin loader's dependency sorter — each spec's
  //     target.ownerPlugin becomes an implicit init-order dep, so this
  //     plugin automatically waits for catalog (the target owner) to
  //     finish init + afterPluginsReady before its own runs.

  // <plugin>-backend afterPluginsReady
  await notificationClient.registerSubscriptionSpec(
    specToRegistration(fooSystemSubscription)
  );
  // dispatch
  await notificationClient.notifyForSubscription({
    specId: fooSystemSubscription.specId,
    resourceKeys: [systemId],
    title,
    body,
    importance,
    action,
    collapseKey,
    subjects,
  });

  // <plugin>-frontend
  createNotificationSubscriptionExtension({ spec: fooSystemSubscription });
  ```

  **Migrated plugins**: anomaly, incident, maintenance, healthcheck,
  dependency. Each lost its bespoke `notification-groups.ts`,
  `bootstrap*NotificationGroups`, `ensure*Group`, and inheritance walk —
  all of that is now centralized in notification-backend's
  `subscription-engine`.

  **Plugin loader change** (`@checkstack/backend-api`,
  `@checkstack/backend`): the register-time API gains
  `env.registerSubscriptionSpecs([...specs])`. The dependency sorter
  walks `spec.target.ownerPlugin` for every declared spec and adds the
  target owner as an init-order dependency of the emitting plugin. This
  guarantees that catalog (the owner of the platform's `system` and
  `group` targets) completes init + afterPluginsReady before any
  emitting plugin tries to register its specs against the notification
  service — no string-prefix heuristics, no manual `dependsOnPlugins`
  list, no stub rows. Plugins that fail to declare their specs at
  register time get a clear `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
  error from the dispatcher.

  **Removed** (no backwards compat):

  - `catalogClient.notifySystemSubscribers` and
    `catalogClient.notifyManySystemSubscribers`
  - `notificationClient.notifyUsers` and `notificationClient.notifyGroups`
    as direct dispatch primitives — replaced by spec-bound
    `notifyForSubscription`
  - catalog's `bootstrapNotificationGroups` (replaced by
    `bootstrapNotificationTargets`)

  **Enforcement**: the dispatcher rejects calls referencing unregistered
  specIds, specs owned by other plugins, or resourceKeys that haven't been
  pushed via `upsertNotificationResource`. Display metadata for any
  groupId is recoverable via the spec registry, so audit lists render
  correct labels even when an emitter's frontend isn't loaded.

  **Per-field anomaly mute** keeps working — it now lives inside the
  generic SubscriptionRow's optional `SubControls` panel
  (`AnomalyFieldMuteList`), exposed through the catalog system detail
  page's notifications card.

  The catalog system detail page renders a "Notifications" card hosting
  `SystemNotificationSubscriptionsSlot`. The matching group surface is
  not yet rendered — group-level subscriptions are wired end-to-end on
  the backend; a follow-up will add the host UI.

  **Migration of existing subscribers**: target types declare a
  `legacyGroupIdTemplate`; on first registration of each spec,
  notification-backend reads subscribers from the legacy
  `catalog.system.<id>` / `catalog.group.<id>` groups and seeds the new
  spec groups exactly once per (spec × resource) pair, tracked in
  `subscription_migrations`. Anomaly stays opt-in (its target also
  declares the template, but the user-explicit nature of the original
  opt-in flow means the seeding produces the same set of subscribers
  they already had).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-common@1.0.0
  - @checkstack/notification-frontend@0.3.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/dashboard-frontend@0.6.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0

## 0.6.1

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
  - @checkstack/incident-common@0.5.0
  - @checkstack/dashboard-frontend@0.5.1
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/catalog-common@1.5.3
  - @checkstack/ui@1.6.1

## 0.6.0

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
  - @checkstack/dashboard-frontend@0.5.0
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/catalog-common@1.5.2
  - @checkstack/frontend-api@0.3.11
  - @checkstack/incident-common@0.4.9
  - @checkstack/signal-frontend@0.0.16

## 0.5.6

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/dashboard-frontend@0.4.6
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29
  - @checkstack/catalog-common@1.5.1
  - @checkstack/incident-common@0.4.8

## 0.5.5

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/dashboard-frontend@0.4.5

## 0.5.4

### Patch Changes

- @checkstack/dashboard-frontend@0.4.4

## 0.5.3

### Patch Changes

- @checkstack/dashboard-frontend@0.4.3
- @checkstack/auth-frontend@0.5.28
- @checkstack/catalog-common@1.4.1

## 0.5.2

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27
  - @checkstack/dashboard-frontend@0.4.2

## 0.5.1

### Patch Changes

- @checkstack/dashboard-frontend@0.4.1

## 0.5.0

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
  - @checkstack/auth-frontend@0.5.26

## 0.4.25

### Patch Changes

- @checkstack/dashboard-frontend@0.3.35

## 0.4.24

### Patch Changes

- @checkstack/dashboard-frontend@0.3.34

## 0.4.23

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6
  - @checkstack/dashboard-frontend@0.3.33
  - @checkstack/auth-frontend@0.5.25

## 0.4.22

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24
  - @checkstack/dashboard-frontend@0.3.32

## 0.4.21

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23
  - @checkstack/dashboard-frontend@0.3.31

## 0.4.20

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22
  - @checkstack/dashboard-frontend@0.3.30

## 0.4.19

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29
  - @checkstack/auth-frontend@0.5.21

## 0.4.18

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20
  - @checkstack/dashboard-frontend@0.3.28

## 0.4.17

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/auth-frontend@0.5.19
  - @checkstack/dashboard-frontend@0.3.27

## 0.4.16

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
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/catalog-common@1.3.1
  - @checkstack/incident-common@0.4.7
  - @checkstack/signal-frontend@0.0.15

## 0.4.15

### Patch Changes

- @checkstack/dashboard-frontend@0.3.25

## 0.4.14

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
  - @checkstack/dashboard-frontend@0.3.24
  - @checkstack/catalog-common@1.3.0

## 0.4.13

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/dashboard-frontend@0.3.23

## 0.4.12

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16
  - @checkstack/dashboard-frontend@0.3.22

## 0.4.11

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15
  - @checkstack/dashboard-frontend@0.3.21

## 0.4.10

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-common@1.2.11
  - @checkstack/dashboard-frontend@0.3.20

## 0.4.9

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-common@1.2.10
  - @checkstack/common@0.6.4
  - @checkstack/dashboard-frontend@0.3.19
  - @checkstack/frontend-api@0.3.8
  - @checkstack/incident-common@0.4.6
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3

## 0.4.8

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-common@1.2.9
  - @checkstack/dashboard-frontend@0.3.18
  - @checkstack/incident-common@0.4.5
  - @checkstack/ui@1.1.2

## 0.4.7

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/dashboard-frontend@0.3.17
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/catalog-common@1.2.8
  - @checkstack/frontend-api@0.3.6
  - @checkstack/incident-common@0.4.4
  - @checkstack/signal-frontend@0.0.13

## 0.4.6

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10
  - @checkstack/dashboard-frontend@0.3.16

## 0.4.5

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/dashboard-frontend@0.3.15
  - @checkstack/catalog-common@1.2.7
  - @checkstack/frontend-api@0.3.5
  - @checkstack/incident-common@0.4.3
  - @checkstack/signal-frontend@0.0.12

## 0.4.4

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/ui@0.5.3
  - @checkstack/incident-common@0.4.2
  - @checkstack/dashboard-frontend@0.3.14
  - @checkstack/auth-frontend@0.5.8

## 0.4.3

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-common@1.2.5
  - @checkstack/common@0.6.1
  - @checkstack/dashboard-frontend@0.3.13
  - @checkstack/frontend-api@0.3.4
  - @checkstack/incident-common@0.4.1
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.4.2

### Patch Changes

- @checkstack/dashboard-frontend@0.3.12

## 0.4.1

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1
  - @checkstack/dashboard-frontend@0.3.11
  - @checkstack/auth-frontend@0.5.6

## 0.4.0

### Minor Changes

- cce5453: Add notification suppression for incidents

  - Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
  - When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
  - Mirrors the existing maintenance notification suppression pattern
  - Added toggle UI in the IncidentEditor dialog
  - Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries

### Patch Changes

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

- Updated dependencies [cce5453]
- Updated dependencies [223081d]
  - @checkstack/incident-common@0.4.0
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/dashboard-frontend@0.3.10

## 0.3.10

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/dashboard-frontend@0.3.9
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/frontend-api@0.3.3
  - @checkstack/incident-common@0.3.4
  - @checkstack/signal-frontend@0.0.10

## 0.3.9

### Patch Changes

- d1324e6: Removed redundant inner scroll wrapper from IncidentEditor - Dialog now handles scrolling
- Updated dependencies [d1324e6]
- Updated dependencies [1f1f6c2]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/dashboard-frontend@0.3.8
  - @checkstack/auth-frontend@0.5.3

## 0.3.8

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/incident-common@0.3.3
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/dashboard-frontend@0.3.7
  - @checkstack/frontend-api@0.3.2
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.3.7

### Patch Changes

- @checkstack/dashboard-frontend@0.3.6

## 0.3.6

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/dashboard-frontend@0.3.5
  - @checkstack/catalog-common@1.2.2
  - @checkstack/frontend-api@0.3.1
  - @checkstack/incident-common@0.3.2
  - @checkstack/signal-frontend@0.0.8

## 0.3.5

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/dashboard-frontend@0.3.4

## 0.3.4

### Patch Changes

- Updated dependencies [cad3073]
  - @checkstack/dashboard-frontend@0.3.3

## 0.3.3

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/dashboard-frontend@0.3.2

## 0.3.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/dashboard-frontend@0.3.1

## 0.3.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/dashboard-frontend@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/incident-common@0.3.1
  - @checkstack/ui@0.2.2

## 0.3.0

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

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/dashboard-frontend@0.2.0
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/incident-common@0.3.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

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
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/incident-common@0.2.0
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

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/frontend-api@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/catalog-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.0.4

### Patch Changes

- 97a6a23: Improve incident and maintenance detail page layout consistency and navigation

  **Layout consistency:**

  - Incident detail page now matches maintenance detail page structure
  - Both use PageLayout wrapper with consistent card layout
  - Affected systems moved into main details card with server icons
  - Standardized padding, spacing, and description/date formatting

  **Back navigation with system context:**

  - Detail pages now track source system via `?from=systemId` query parameter
  - "Back to History" navigates to the correct system's history page
  - Works when navigating from system panels, history pages, or system detail page
  - Falls back to first affected system if no query param present

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/incident-common@0.1.2
  - @checkstack/signal-frontend@0.1.1

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/catalog-common@0.1.1
  - @checkstack/incident-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
