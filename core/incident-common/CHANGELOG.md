# @checkstack/incident-common

## 1.11.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/frontend-api@0.19.0
  - @checkstack/catalog-common@2.8.3

## 1.11.0

### Minor Changes

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

- 1deaac5: Make endpoint authorization self-documenting in the generated API docs

  Every procedure's authorization is now derived from its contract metadata (its
  `access` rules + `instanceAccess` mode) via a shared mode-descriptor registry and
  emitted into the OpenAPI spec - both structurally (`x-orpc-meta.authorization`)
  and as a human `**Authorization.**` sentence folded into the operation
  description. Previously the docs surfaced only a flat list of global rule ids, so
  an integrator (an API-key/application principal that CAN hold team grants) never
  saw the team-grant / per-object dimension, and endpoints gated purely in the
  handler showed no restriction at all.

  For authorization that no declarative mode can express and is therefore enforced
  in the handler (a compound OR, a graded verdict, a DB-derived id set), a new
  optional `accessNote` on the procedure metadata surfaces the real rule in the
  docs as an explicitly handler-enforced addendum. The note is documentation, not a
  guarantee: per `.claude/rules/rlac.md` the drift guard for such authz is
  behavioral tests over an extracted pure decision function, and the note must
  state exactly what those tests pin.

  Every handler-enforced authorization endpoint now carries such a note so the docs
  are complete: the team read/scoping and team-management endpoints
  (`@checkstack/auth-common`), the health-check assignment/history reads
  (`@checkstack/healthcheck-common`), the audience-graded incident/maintenance
  reads (`@checkstack/incident-common`, `@checkstack/maintenance-common`), status
  -page publish's bound-resource check (`@checkstack/status-page-common`), the
  stream `setSystemLinks` readable-additions check
  (`@checkstack/{metricstream,tracestream,logstream}-common`), and the automation
  `runAs` escalation guard (`@checkstack/automation-common`). These are
  metadata-only additions - no runtime behavior changed. The notes describe the
  rule for API-doc readers only; the drift guard is behavioral tests over the
  check's decision function (per `.claude/rules/rlac.md`), so the notes name no
  internal test files.

  The API docs viewer (`@checkstack/api-docs-frontend`) now renders each
  operation's description as Markdown, so the `**Authorization.**` block (and any
  inline `code`) formats correctly instead of showing raw markdown.

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/notification-common@1.9.0
  - @checkstack/catalog-common@2.8.2
  - @checkstack/signal-common@0.3.2

## 1.10.5

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/notification-common@1.8.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/catalog-common@2.8.1

## 1.10.4

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/catalog-common@2.8.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/notification-common@1.7.2
  - @checkstack/signal-common@0.3.1

## 1.10.3

### Patch Changes

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/frontend-api@0.16.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/notification-common@1.7.1

## 1.10.2

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/frontend-api@0.15.0
  - @checkstack/catalog-common@2.7.2

## 1.10.1

### Patch Changes

- Updated dependencies [b80160a]
- Updated dependencies [bd41130]
  - @checkstack/frontend-api@0.14.2
  - @checkstack/notification-common@1.7.0
  - @checkstack/catalog-common@2.7.1

## 1.10.0

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

- 43e4484: Count incident-forced downtime against SLOs. When an incident forces a system to
  degraded/unhealthy via its health override, that downtime is now recorded as an
  SLO downtime event for each of the system's objectives (consuming the error
  budget and appearing in the downtime history) and is closed when the incident is
  resolved, deleted, or its override is cleared - and only once the system's health
  checks are also healthy. Downtime is never double-counted with a concurrent
  health-check outage, and one cause never closes downtime the other is still
  holding open (resolving an incident while checks still fail, or checks recovering
  while an override is still active, both leave the outage open).

  Adds a nullable `source` column (`healthcheck` | `incident`, NULL read as
  `healthcheck`) to `slo_downtime_events` and a `DowntimeSource` schema in
  slo-common, so the cause of each downtime event is recorded and the orphan
  self-heal skips incident-owned events. incident-backend now emits an
  `incident.lifecycle.changed` hook (contract in incident-common) on every incident
  lifecycle change - including override-only edits that the reactive `incident`
  entity change does not surface - which slo-backend subscribes to with
  exactly-once delivery to reconcile downtime.

- 43e4484: Eliminate N+1 RPC fan-outs in the public status-page widget resolvers.

  Each of these widgets renders a PUBLIC page, so every per-item RPC was real
  external DB load. Three bulk-by-id endpoints replace the per-item fetches:

  - `healthcheck-common`: new `getBulkRunStats({ systemIds, startDate, endDate,
maxBuckets })` -> `{ stats: Record<systemId, RunStats> }`. The `systemHealth`
    widget's uptime column now issues ONE request for all systems instead of one
    `getRunStats` per system. Systems with no runs in the window are omitted, so
    the resolver's output is unchanged.
  - `incident-common`: new `getBulkIncidentUpdates({ incidentIds })` ->
    `{ updates: Record<incidentId, IncidentUpdate[]> }`. The incidents widget now
    fetches every selected incident's update timeline in ONE request instead of
    one `getIncident` per incident.
  - `maintenance-common`: new `getBulkMaintenanceUpdates({ maintenanceIds })` ->
    `{ updates: Record<maintenanceId, MaintenanceUpdate[]> }` (symmetric with the
    incident endpoint) for the maintenance widget.

  The new update endpoints apply the same per-item audience filter as
  `getIncident` / `getMaintenance`, so internal/logged-in updates and author
  identity never leak to a non-manager caller. Each endpoint is keyed by the
  resource id and gated with the record post-filter (`recordKey`) matching the
  single endpoint's read scope, mirroring `getBulkSystemHealthStatus` /
  `getBulkIncidentsForSystems`. Widget DTO output is unchanged - this is a pure
  request-count optimization.

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/catalog-common@2.7.0
  - @checkstack/notification-common@1.6.0
  - @checkstack/frontend-api@0.14.1

## 1.9.0

### Minor Changes

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
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/notification-common@1.5.3
  - @checkstack/signal-common@0.2.17

## 1.8.0

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

## 1.7.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-common@0.2.16

## 1.7.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/catalog-common@2.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/signal-common@0.2.15

## 1.7.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [d1b71b6]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [53666a7]
- Updated dependencies [0d912a3]
  - @checkstack/notification-common@1.5.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/signal-common@0.2.14

## 1.6.4

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/frontend-api@0.12.1
  - @checkstack/notification-common@1.4.2
  - @checkstack/signal-common@0.2.13

## 1.6.3

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/common@0.17.0

## 1.6.2

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/notification-common@1.4.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/signal-common@0.2.11

## 1.6.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1

## 1.6.0

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
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/frontend-api@0.10.0
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-common@0.2.10

## 1.5.2

### Patch Changes

- @checkstack/catalog-common@2.3.6

## 1.5.1

### Patch Changes

- @checkstack/catalog-common@2.3.5

## 1.5.0

### Minor Changes

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

## 1.4.4

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
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/common@0.15.0
  - @checkstack/notification-common@1.3.3
  - @checkstack/signal-common@0.2.9

## 1.4.3

### Patch Changes

- Updated dependencies [fb705df]
  - @checkstack/frontend-api@0.8.0
  - @checkstack/catalog-common@2.3.3
  - @checkstack/common@0.14.1
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/catalog-common@2.3.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/signal-common@0.2.7

## 1.4.0

### Minor Changes

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
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/signal-common@0.2.6

## 1.3.1

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [6d52276]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5

## 1.3.0

### Minor Changes

- ba07ae2: Quiet down notification spam on flapping systems, auto-open incidents when a check goes critical, and let operators land directly on the broken checks.

  Notification policy lives **per healthcheck assignment** (one row per `system × configuration`). Different checks on the same system are fully independent — disabling a setting on one check does not affect the others. Defaults preserve existing behaviour for `suppressDeEscalations`; **auto-incident defaults to on** for new and existing assignments.

  - **`suppressDeEscalations`** (off by default). When on, transitions from a worse state to a better-but-still-failing state (e.g. `unhealthy → degraded`) no longer fire a notification. Escalations and full recoveries to `healthy` are unaffected. Resolved per assignment (the just-ran check is the one driving any aggregate transition).
  - **`autoOpenIncidentOnUnhealthy`** (on by default). Either of two independent triggers can open the auto-incident:
    - **`sustainedUnhealthyTrigger`** (default 30 min) — opens when the check stays continuously unhealthy for the configured duration. Catches real outages.
    - **`flappingTrigger`** (default 3 transitions in 60 min) — opens when the check flips to unhealthy that many times in the window. Catches persistent flapping where each unhealthy phase is too brief for the sustained trigger.
      Each trigger can be individually disabled. One incident per system: triggering checks attach to an existing active auto-incident.
  - **`useNotificationSuppression`** (on by default, only meaningful when auto-open is on). Controls whether the auto-opened incident is created with `suppressNotifications: true` — leaving this off opens the incident but still pings operators on each transition.
  - **`skipDuringMaintenance`** (on by default). No auto-incident is opened while the system has an active maintenance window with suppression. The system is intentionally down and shouldn't trip the on-call.
  - **`autoCloseAfterMinutes`** (default 30). Auto-close cooldown is now per-assignment and snapshotted per-incident at open time — later policy edits don't alter in-flight incidents. Setting `null` ("Never auto-close") leaves the incident for manual resolution.
  - **Require-recovery rule.** After any auto-incident closes (manual or auto), no new auto-incident can open until the check has logged at least one healthy run. Prevents a "operator dismissed but it's still broken" loop.
  - **Auto-close worker** ticks every 60s and resolves auto-opened incidents whose systems have been healthy for their per-row `cooldownMinutes`. Rows with `null` cooldown are skipped entirely. Per-incident: failed close attempts are logged but never abort the sweep.
  - **`incidentResolved` hook subscriber** syncs the auto-incident mapping when an operator manually resolves the incident, so the require-recovery rule sees the close immediately.
  - **Platform-wide defaults.** New admin RPCs `getPlatformNotificationDefaults` / `setPlatformNotificationDefaults` (under the existing `healthcheck.configuration.{read,manage}` access rules) let operators set notification policy once for the whole instance. Per-assignment rows with `notificationPolicy: null` inherit the platform defaults at read time. UI: a "Notification defaults" button in the Assignment IDE opens a modal editor. The per-assignment Notifications panel shows an inheritance banner — "Using platform defaults" (read-only) with an "Override" button, or "Custom override" with a "Use platform defaults" button to revert. The all-or-nothing model keeps the mental model simple: each assignment is either fully inherited or fully overridden.
  - **New service-level RPCs** on the incident plugin (`createAutoIncident`, `resolveAutoIncident`) let other plugins open/close incidents without a user context. Reused by the healthcheck auto-incident flow.
  - **Health-state notification CTA** now deep-links to `?filter=failing` on the system detail page for non-recovery transitions (label changes to "View failing checks"). The system overview gains an `All / Failing / Healthy` segmented filter wired to the same `?filter=…` param.
  - **Notification bell badge** now counts collapse groups instead of raw rows, so the number matches what the user sees in the notifications list. Built on `COUNT(DISTINCT COALESCE(collapse_key, id))` — notifications without a collapse key still each count as one.
  - **`statusFilter` on `getHistory` / `getDetailedHistory`** lets the run-history page and the drawer's Recent Runs panel filter to `All / Healthy / Failing` via shared pills, with the page resetting to the first page on filter change.
  - **Pagination defaults aligned with selector options.** Several pages defaulted to a page size (5 or 20) that wasn't in the dropdown's options (`[10, 25, 50, 100]`), so the page-size `<Select>` rendered empty. The drawer's Recent Runs now defaults to 10; the Run History, History List, and Delivery Logs pages now default to 25.

  Includes Drizzle migrations adding the `notification_policy` jsonb column to `system_health_checks`, plus two new tables: `health_check_unhealthy_transitions` (for threshold counting) and `health_check_auto_incidents` (for mapping back to incident ids during auto-close).

## 1.2.2

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/notification-common@1.2.0
  - @checkstack/frontend-api@0.5.2
  - @checkstack/catalog-common@2.2.2
  - @checkstack/signal-common@0.2.4

## 1.2.1

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/catalog-common@2.2.1

## 1.2.0

### Minor Changes

- 9016526: Add a `/rest/:pluginId/*` HTTP mount that serves every plugin's oRPC contract
  through the REST/OpenAPI shape described by `/api/openapi.json`. Queries are
  `GET` with query parameters, mutations are `POST` with the input as the raw
  JSON body. The existing `/api/:pluginId/*` mount continues to serve oRPC's
  native wire protocol unchanged, so existing clients are not affected.

  The OpenAPI spec at `/api/openapi.json` now reflects the real mount: every
  `paths` entry is prefixed with `/rest` instead of `/api`.

  Also fixes a SPA-fallback bug: the backend's `/api-docs` route previously
  returned 404 on production deployments because the static-file middleware
  skipped any path starting with `/api`, capturing `/api-docs` along with real
  API routes. The skip now requires a trailing slash (`/api/`, `/rest/`).

  Required access rules are now visible in the API Docs UI. The OpenAPI spec
  generator was reading a non-existent `accessRules` field on procedure
  metadata; the real field is `access: AccessRule[]`. Each procedure's access
  rules are now flattened to fully-qualified IDs (e.g. `catalog.system.read`)
  and emitted under `x-orpc-meta.accessRules`, which the existing
  `Required Access Rules` section in the docs UI already knew how to render.

  The API Docs schema renderer now handles record types (zod `z.record`),
  `$ref`s into `components.schemas`, `oneOf`/`anyOf`/`allOf`, nullable union
  types (`type: ["string", "null"]`), and `format` qualifiers. Previously
  record outputs like `{ statuses: object }` masked the actual value type;
  they now render as `{ [key]: <ResolvedType> { ... } }` with the inner
  schema expanded, capped at 12 levels with cycle detection.

  **REST method conventions.** `proc()` now defaults to `GET` for queries and
  `POST` for mutations on the `/rest` mount, using bracket-notation query
  params (`?filter[status]=active&ids[0]=a`) for GET inputs. Existing
  procedures were updated to follow REST semantics:

  - `update*` mutations → `PATCH`
  - `delete*` / `remove*` mutations → `DELETE`
  - `getBulk*` queries and any query taking a large array input → `POST`
    (because `@orpc/openapi@1.13.x` has no GET→POST URL-length fallback)

  GET endpoints require an `object` input — bare scalars like
  `.input(z.string())` are not valid on GET. `getSystemConfigurations` was
  refactored from `.input(z.string())` to `.input(z.object({ systemId: ... }))`
  to fit the GET shape; the only call-site update was the in-process router
  unpacking `input.systemId` instead of passing `input` directly.

  The API Docs UI now renders query parameters (path/query/header/cookie) in a
  dedicated table for GET endpoints, and the fetch example shows them in the
  URL with `<required>` / `<optional>` placeholders.

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/frontend-api@0.5.1
  - @checkstack/signal-common@0.2.3

## 1.1.0

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

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
  - @checkstack/common@0.9.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 1.0.1

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/frontend-api@0.4.2
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 1.0.0

### Major Changes

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

### Minor Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/frontend-api@0.4.1

## 0.5.0

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
  - @checkstack/frontend-api@0.4.0

## 0.4.9

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-common@0.1.10

## 0.4.8

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10

## 0.4.7

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/frontend-api@0.3.9
  - @checkstack/signal-common@0.1.9

## 0.4.6

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/signal-common@0.1.8

## 0.4.5

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7

## 0.4.4

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3
  - @checkstack/frontend-api@0.3.6
  - @checkstack/signal-common@0.1.7

## 0.4.3

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2
  - @checkstack/frontend-api@0.3.5
  - @checkstack/signal-common@0.1.6

## 0.4.2

### Patch Changes

- 9551fd7: Fix creator display in incident and maintenance status updates

  - Show the creator's profile name instead of UUID in status updates
  - For maintenances, now properly displays the creator name (was missing)
  - For incidents, replaces UUID with human-readable profile name
  - System-generated updates (automatic maintenance transitions) show no creator

## 0.4.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/signal-common@0.1.5

## 0.4.0

### Minor Changes

- cce5453: Add notification suppression for incidents

  - Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
  - When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
  - Mirrors the existing maintenance notification suppression pattern
  - Added toggle UI in the IncidentEditor dialog
  - Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries

## 0.3.4

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/frontend-api@0.3.3
  - @checkstack/signal-common@0.1.4

## 0.3.3

### Patch Changes

- 8a87cd4: Updated access rules to use new `accessPair` interface

  Migrated to the new `accessPair` interface with per-level options objects for cleaner access rule definitions.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/frontend-api@0.3.2
  - @checkstack/signal-common@0.1.3

## 0.3.2

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/frontend-api@0.3.1
  - @checkstack/signal-common@0.1.2

## 0.3.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0

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

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/signal-common@0.1.1

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
  - @checkstack/signal-common@0.1.0

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
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/frontend-api@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.2

### Patch Changes

- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/signal-common@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3

## 0.1.0

### Minor Changes

- 4dd644d: Enable external application (API key) access to management endpoints

  Changed `userType: "user"` to `userType: "authenticated"` for 52 endpoints across 5 packages, allowing external applications (service accounts with API keys) to call these endpoints programmatically while maintaining RBAC permission checks:

  - **incident-common**: createIncident, updateIncident, addUpdate, resolveIncident, deleteIncident
  - **maintenance-common**: createMaintenance, updateMaintenance, addUpdate, closeMaintenance, deleteMaintenance
  - **catalog-common**: System CRUD, Group CRUD, addSystemToGroup, removeSystemFromGroup
  - **healthcheck-common**: Configuration management, system associations, retention config, detailed history
  - **integration-common**: Subscription management, connection management, event discovery, delivery logs

  This enables automation use cases such as:

  - Creating incidents from external monitoring systems (Prometheus, Grafana)
  - Scheduling maintenances from CI/CD pipelines
  - Managing catalog systems from infrastructure-as-code tools
  - Configuring health checks from deployment scripts

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [b55fae6]
  - @checkstack/common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/frontend-api@0.0.2
