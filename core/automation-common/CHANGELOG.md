# @checkstack/automation-common

## 0.10.1

### Patch Changes

- Updated dependencies [4568dcc]
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0
  - @checkstack/template-engine@0.4.11

## 0.10.0

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
  - @checkstack/common@0.22.0
  - @checkstack/signal-common@0.2.17
  - @checkstack/template-engine@0.4.11

## 0.9.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/signal-common@0.2.16
  - @checkstack/template-engine@0.4.10

## 0.9.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/signal-common@0.2.15
  - @checkstack/template-engine@0.4.9

## 0.9.0

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

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/signal-common@0.2.14
  - @checkstack/template-engine@0.4.8

## 0.8.2

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/signal-common@0.2.13
  - @checkstack/template-engine@0.4.7

## 0.8.1

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
  - @checkstack/signal-common@0.2.12
  - @checkstack/common@0.17.0
  - @checkstack/template-engine@0.4.6

## 0.8.0

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

## 0.7.1

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0
  - @checkstack/signal-common@0.2.11
  - @checkstack/template-engine@0.4.6

## 0.7.0

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
  - @checkstack/common@0.16.0
  - @checkstack/signal-common@0.2.10
  - @checkstack/template-engine@0.4.5

## 0.6.0

### Minor Changes

- 748268c: Add an example-automation template catalogue. Creating a new automation now
  opens a picker (`/automation/new`) with curated, ready-to-use starting points
  grouped by category, plus a "Blank automation" option. Selecting a template
  seeds the editor (the operator still chooses a service account and saves).

  Templates are an extensible registry: external plugins contribute their own via
  the new `automationTemplateExtensionPoint`, exactly like actions / triggers /
  artifact types. Every registered template is validated against the LIVE
  trigger/action/artifact registries at server startup - a template that
  references a capability that is not installed is withheld with a console
  warning, and one whose definition no longer validates (interface drift) is
  withheld with a console error - so a template can never silently drift when an
  action, trigger, condition, or artifact interface changes.

  Ships five built-in templates spanning incident response and alerting
  (AI-triage-and-file-Jira-bug, close-Jira-on-recovery, AI-summarize-incident,
  page-on-call-on-sustained-degradation, AI-severity-escalation).

### Patch Changes

- Updated dependencies [079369a]
  - @checkstack/template-engine@0.4.4

## 0.5.0

### Minor Changes

- ebef442: feat(automation): gate integration actions on the runAs service account's permissions

  **BREAKING.** Integration automation actions resolve credentials through a
  trusted service rather than the bounded `runAs` client, so they previously
  bypassed the runAs least-privilege model entirely: anyone able to author an
  automation could create Jira tickets, send Teams/Webex messages, etc. on any
  configured connection, with a zero-permission service account. This closes that
  gap.

  - **Actions declare `requiredAccessRules`** and the dispatch engine enforces
    them against the resolved `runAs` principal BEFORE the action runs (failing
    the step if missing) - the authorization point integration actions lacked.
  - **Each integration plugin defines per-action access rules**, e.g.
    `integration-jira.create_issue.manage` / `search_issues.read` /
    `transition_issue.manage` / `add_comment.manage`,
    `integration-teams.post_message.manage`,
    `integration-webex.post_message.manage`.
  - **`automation.propose` checks the same up front**, surfacing a per-action
    missing-permission error on the review card; `listActions` now exposes each
    action's `requiredAccessRules`, and `getBindableApplications` now returns each
    app's effective `accessRules`.
  - **New `integration.read` rule** gates `listConnectionSummaries` /
    `resolveConnectionOptions` (previously open to any authenticated user), so
    discovering connections and resolving their field options requires a grant.
  - **The AI assistant picks a capable runAs up front.**
    `automation.listServiceAccounts` now returns each account's `accessRules` and
    `automation.getCapabilitySchema` returns each action's `requiredAccessRules`,
    so the model selects a service account whose permissions cover the actions it
    uses instead of proposing and being rejected. When the operator did not name a
    runAs and more than one account qualifies, it ASKS which to use rather than
    choosing the automation's identity itself; when none has the needed rules it
    says which rule(s) to grant.

  **Migration:** existing automations whose service account does not hold the new
  rules will fail at the gated action until an admin grants the matching rule(s)
  to the service account's role (e.g. add `integration-jira.create_issue.manage`).
  Admin (`*`) service accounts are unaffected. Grant `integration.read` to roles
  that author integration-using automations so the editor's connection pickers and
  dropdowns keep working for non-admins.

## 0.4.3

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
  - @checkstack/template-engine@0.4.3

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/signal-common@0.2.8
  - @checkstack/template-engine@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/signal-common@0.2.7
  - @checkstack/template-engine@0.4.1

## 0.4.0

### Minor Changes

- 9dcc848: Automations now run as a configured service account, removing implicit god-mode from the dispatch path.

  BREAKING: every automation must declare a `runAs` application (service account). Previously every automation action ran as the trusted service client, bypassing all access-rule, per-resource, and team-scope checks - so an automation could touch any team's data. Now each automation runs as a bounded `application` principal, and every data-access call an action makes is authorized exactly as that identity. An automation with no `runAs` fails to run with a clear error rather than falling back to the trusted client; legacy automations must be assigned a service account before they run again.

  What changed:

  - New top-level field `runAs` on automations (a `run_as_application_id` column + create/update inputs; `AutomationSchema.runAs`). Required on create; GitOps sets it via the `run-as` metadata label.
  - A new `coreServices.rpcClientAs(applicationId)` mints a short-lived, backend-signed app-principal token; the auth service resolves it LIVE to an `application` principal (reusing `enrichApplicationPrincipal`), so it flows through full `autoAuthMiddleware` enforcement. The dispatch engine threads this client into every action's `execute` as the required `context.rpcClient`.
  - Bind authority (anti-escalation): a user may only bind an application whose access rules are a subset of their own (`isApplicationBindable`); `getBindableApplications` lists only bindable apps, and the create/update handlers enforce the check.
  - `notification.sendTransactional` moves from service-only to access-gated (`notification.send`, a new access rule), so an automation's `runAs` can call the built-in `notify_user` / `notification.send` actions; trusted services still bypass via short-circuit.
  - A "Run as (Service Account)" picker in the automation editor, populated from `getBindableApplications` (server-side filtered to bindable apps), seeding from the loaded `runAs` on edit and passing it into create + update. First-class teaching UX: an inline info banner, a blocked Save with an inline hint until one is chosen, and an empty state linking to the Applications admin + docs when none are bindable.

  State and scale: `runAs` resolution is a pure read over shared tables; the app-principal token is self-contained and verified statelessly, so the per-run client is correct under horizontal scale.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Assorted bug fixes and small hardening across the platform.

  - announcement-backend: `updateAnnouncement` now invalidates the active-announcements and admin-list caches (it was missing the `invalidateAllActive` / `invalidateListAll` calls), so an edited announcement no longer stays stale up to the 45s TTL.
  - anomaly-backend: anomaly/drift state transitions (confirmations, recoveries, self-resolutions) now log at `debug` instead of info/warn - they are already surfaced via the `ANOMALY_STATE_CHANGED` signal, so logging them louder just added noise; genuine failure paths stay `warn`.
  - backend: the `/api/:pluginId/*` dispatcher now populates `requestHeaders` on the per-request RPC context, so a handler that re-enters the router as the originating user (e.g. an AI tool's user-scoped client) can forward the caller's session cookie / bearer - previously the loopback failed with "Authentication required". Guarded by a real end-to-end integration test. The HTTP server idle timeout is also raised (default 255s, configurable via `CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS`, clamped 0-255, reset on each streamed chunk) so long AI chat SSE turns are not severed mid-stream.
  - backend: a request for an unknown plugin id (`/api/<unknown>/...`) now returns `404 Not Found` instead of `500` (and logs at warn, not error, since it is a client request) - an unknown _procedure_ on a known plugin already 404'd. The in-app docs namespace `/checkstack/*` now serves Starlight's own `404.html` with a real 404 status for a missing doc, instead of falling through to the SPA catch-all and 200-ing the app shell. Both guarded by tests.
  - automation-common: remove polynomial-time backtracking from `toShellEnvKey`'s underscore-trim (CodeQL `js/polynomial-redos`); a negative look-behind anchors the trailing run, keeping the trim linear.
  - common + script-packages-common: the pure transport-safe sandbox-policy schema (`sandboxPolicySchema` and its sub-schemas + inferred types) moved to `@checkstack/common` (the neutral base), removing two inverted deps that existed only to reach the shape; `@checkstack/backend-api` continues to re-export it. The schema is no longer exported from `@checkstack/script-packages-common`. Pure refactor, no behavior change.
  - catalog-backend: reject duplicate system names (a `CONFLICT` on create/rename, enforced by a pre-write check AND a new DB unique index on `systems.name`, migration 0004 which first resolves pre-existing duplicates by suffixing).
  - catalog-frontend: detail-page cleanups (use `<NotFound />` not `<AccessDenied />` on the not-found branch, a readable key/value metadata list via `normalizeMetadata`, runtime locale via `formatDate`); and stop the browse view re-rendering on every health report (adopt a new statuses report only when a value actually changed, via `healthStatusesEqual`, so rows stay stable and interactive).
  - healthcheck-backend: fix the daily-rollup retention step failing with an `ON CONFLICT` mismatch (SQLSTATE 42P10) after `environmentId` joined the `health_check_aggregates` unique constraint - the rollup now groups by (day, environmentId, sourceId) and uses a single exported conflict-target constant (`DAILY_AGGREGATE_CONFLICT_TARGET`) kept in lock-step with the schema by a unit test.
  - automation-frontend: the service-account picker's "Learn more" links are now absolute URLs to the deployed Astro docs site (they 404ed as in-app relative paths). The Monaco script editor double-init crash is fixed (serialized cold init, a guarded `monacoGuard` accessor, theme/type effects gated on `apiReady`).
  - auth-frontend: bound the desktop user-menu popover height (`max-h-[var(--radix-popover-content-available-height)]` + `overflow-y-auto`) so it no longer clips on short viewports, and fold the standalone `Account > Profile` item into a focusable name/email header (`profileHref` on `UserMenu`); the now-empty `Account` group no longer renders.
  - satellite-frontend: picked up via the sidebar-nav migration (account-only user menu).

  (Related UI fixes - the Monaco editor following the app theme, the `DynamicOptionsField` no-flash fix, the shared `Spinner`, GFM tables, and the user-menu popover bound - land their `@checkstack/ui` bump in the UI/perf changesets where `@checkstack/ui` is already minored.)

  This is a beta patch.

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0
  - @checkstack/template-engine@0.4.0
  - @checkstack/signal-common@0.2.6

## 0.3.0

### Minor Changes

- b995afb: Add grouping to automations so they are easier to find.

  Each automation now carries an optional single free-text `group` label (HA-style "category"), stored as its own column on the `automations` row alongside `name` / `description` / `status` - it is NOT part of the definition / YAML. The automations list renders one collapsible section per group (sorted alphabetically, with an implicit "Ungrouped" bucket last), and the edit page gains a type-new-or-pick-existing group picker fed by the new `listAutomationGroups` query. `listAutomations` accepts an optional `group` filter.

  Declaratively managed automations express their group via GitOps `metadata.labels.group`; the reconciler threads it onto the row (blank clears it).

  A Drizzle migration adds the nullable `"group"` column and an index. Existing automations default to no group (Ungrouped) and behave exactly as before.

- 270ef29: Add live state in scope plus duration helpers to the automation sensing layer (Wave 2 Phase 14).

  - `@checkstack/template-engine` ships four pure, synchronous duration filters: `minutes` and `hours` (number to milliseconds), `duration_since` (ms elapsed since an ISO timestamp), and `older_than(thresholdMs)` (boolean dwell check). They compute against real time at call time, so "now" is fresh per evaluation. Fail-safe on null/unparseable input.
  - The dispatch engine pre-resolves live health state into scope before any condition or template evaluation (the engine is synchronous, so inline state queries are impossible). State is folded under a `health` namespace - `health.system.*` for the trigger's context system and `health.systems[<id>]` for ids listed in the automation's new `uses_state` field. One batched `getBulkHealthState` query per evaluation, wired at the fresh-run, resume, and trigger-gate sites. Fail-open: a missing client or provider error yields an empty namespace and a warning, never wedging unrelated automations.
  - New `automationFilterExtensionPoint` lets plugins contribute pure template filters without forking the engine's default registry. Name collisions with built-ins are skipped with a warning.
  - The editor variable-scope resolver and autocomplete catalogue now surface the `health.*` namespace and the new duration filters.

  With this phase alone, an operator can build "notify me when a system has been unhealthy for 30 minutes" using an interval trigger plus a single `health.*` condition - no dwell timer required (the precise event-driven path lands in Phase 15).

- 270ef29: Add the `for:` dwell on triggers (Wave 2 Phase 15) - precise, event-driven, restart-safe "fire only if the matched state still holds after Y".

  - New first-class `TriggerSchema.for` (decision D1): a single-unit duration (`{ seconds | minutes | hours }`) or `{ template }` rendering to seconds. A `durationToMs` helper resolves it. Not buried in `config`.
  - New pre-run `automation_dwell_timers` table (decision D5): a dwell arms before any run exists, so it cannot reuse the run-scoped wait locks. Unique on `(automationId, triggerId, contextKey)` so a re-fire re-arms (pushes `fireAt`) rather than stacking timers.
  - Arm / re-arm / fire / cancel wired into the trigger fan-in. When a `for:` trigger fires and its filter passes, the engine snapshots the current status, upserts the dwell row, and enqueues an `automation-dwell` wake job with the matching `startDelay` - no run starts yet.
  - At expiry the dwell re-confirms (via the Phase 13 health-state provider) that the system is still in the armed status, then re-checks the automation's pre-run conditions, then starts the run honouring the concurrency mode. A recovery within the window cancels the pending fire even without an explicit inverse event.
  - Cancellation is DB-side (delete the row; the queue job no-ops when it pops, since queue jobs are not cancellable). A contradicting state-change event eagerly deletes a stale dwell. Deleted automations drop their dwells via FK cascade; disabled automations drop them at fire time.
  - Durability: the dwell row is the source of truth. A new `automation-dwell` queue consumer fires dwells, and the stalled sweeper catches expired rows whose job was lost. Both paths are idempotent via delete-on-fire, so a dwell fires at most once and survives restart.

  Example:

  ```yaml
  triggers:
    - event: healthcheck.system.degraded
      for: { minutes: 30 }
  actions:
    - action: incident.create
      config:
        title: "{{ trigger.payload.systemName }} is critical"
        severity: critical
        systemIds: ["{{ trigger.payload.systemId }}"]
  ```

- 270ef29: Add the `numeric_state` trigger and three structured condition variants (Wave 2 Phase 16, backend-only).

  - New built-in `numeric_state` trigger: hook-backed on `healthcheck.check.completed`, fires when a numeric field (`latencyMs` top-level, or a `collectors.<id>.<field>` path) crosses an `above` / `below` threshold. The per-automation threshold is enforced by a new structured config gate (`TriggerDefinition.evaluateConfig`) that runs before the operator's template filter. Pairs with a trigger-level `for:` (Phase 15) for sustained thresholds. v1 is level-triggered; edge de-duplication is deferred. (Per-check `p95LatencyMs` is not in the hook payload; read windowed p95 via a `numeric_state` _condition_ against `health.system.p95_latency_ms` instead.)
  - Corrected the Phase 15 dwell `arm` semantics to be insert-if-absent: a re-fire while a dwell is still armed PRESERVES the original `fireAt` instead of pushing it. Required for the level-triggered `numeric_state` trigger above - otherwise a trigger firing on every check completion (e.g. every 60s) with `for: 10m` would re-arm and push the deadline forward indefinitely, never elapsing. A genuine recover-then-recur still deletes the row (re-confirm / inverse-cancel) so a fresh window starts.
  - Extended the condition grammar (`ConditionInput`) beyond `string | and | or | not` with three typed variants evaluated over the pre-resolved `health.*` scope plus a FRESH `now` per evaluation:
    - `numeric_state`: `{ value, above?, below? }` (value is a literal number or a template/path string).
    - `time`: `{ after?, before?, weekday?[], timezone? }` for on-call / quiet-hours gating, including overnight windows wrapping midnight, weekday filtering, and IANA timezone resolution via `Intl`.
    - `state`: `{ entity, status, for? }` - a condition-side dwell read from `health.systems[entity].in_status_for_ms` (no new timer; it reads, it doesn't time).
  - The raw template string stays the escape hatch. Everything round-trips through zod and YAML.

  Editor widgets (ConditionEditor branches, duration/time-of-day inputs, operator selects) are intentionally deferred to Phase 19; the YAML editor already round-trips the new schema, so the feature is fully usable and testable via YAML today.

- 270ef29: Add the `wait_until` action primitive (Wave 2 Phase 17) - suspend a running automation until a condition becomes true, with an optional timeout (HA's `wait_template`).

  - New `wait_until: { condition, timeout_seconds?, continue_on_timeout? }` primitive. `continue_on_timeout` defaults to true (HA semantics). Added to the schema, the action union, and `detectActionKind`. (The wait is fully reactive - see the reactive-dispatch-pipeline changeset; there is no `poll_seconds`.)
  - `condition` accepts any condition shape - a template string or the Phase 16 structured `numeric_state` / `time` / `state` variants.
  - Reactive resume: if the condition is already true it continues inline; otherwise it persists a `kind: "until"` wait lock (carrying the condition + timeout policy in a new `wait_config` jsonb column). The reactive-dispatch-pipeline changeset replaces the original poll-based re-check with a wake-index + a single timeout timer, so the wait is woken by a relevant entity change rather than ticked on an interval. Resumes take the per-run advisory lock so a wake and a sweep can't double-resume.
  - Survives restart: the wait lock is the source of truth, and the stalled sweeper applies the timeout policy as a backstop if the wake/timer signal is lost.
  - Works nested inside `choose` / `parallel` / `repeat` via the existing resume-remainder mechanism.
  - Editor: a `wait_until` action card (frontend) mirroring `wait_for_trigger` - a `ConditionEditor` plus timeout and continue-on-timeout inputs. The structured numeric/time/state ConditionEditor branches land with the rest of the sensing-layer editor work; the card uses the expression-based editor for now.

- 270ef29: Add a windowed transition count to the health provider - the building block for custom flapping rules (Wave 2 Phase 18).

  Flapping is already buildable today via the built-in `healthcheck.flapping_detected` trigger; this phase ships the GENERALIZATION for arbitrary "N status changes in M minutes" rules.

  - `countStateTransitionsInWindow` counts aggregate status transitions for a system over a trailing window (from the Phase 13 `health_check_state_transitions` table - all statuses, generalizing the unhealthy-only flapping detector). Fail-safe to 0.
  - `getHealthState` / `getBulkHealthState` now return `transitionsInWindow` + `transitionWindowMinutes`, and accept an optional `transitionWindowMinutes` input (default 60).
  - The automation definition gains an optional top-level `state_window_minutes` (default 60), threaded through `enrichScopeWithState` so `health.system.transitions_in_window` / `health.system.transition_window_minutes` are folded into scope per evaluation.
  - Operators author custom flapping as a `numeric_state` condition over `health.system.transitions_in_window` - no new condition variant, no editor change. The variable-scope resolver surfaces the new fields for autocomplete.

- 270ef29: Add per-context-key concurrency scope to automations (Phase 20 prerequisite).

  A new optional `concurrency_scope: "automation" | "context_key"` field on the automation definition controls the bucket the concurrency `mode` is evaluated over:

  - `automation` (default, backward-compatible): one bucket for the whole automation - `single` allows one in-flight run total, `restart` cancels every active run. Existing automations are unchanged.
  - `context_key`: an independent bucket per `contextKey` (typically per system / incident) - `single` allows one in-flight run _per context key_ (system A and system B run concurrently, but a second run for system A is deduped), and `restart` cancels only the active runs sharing the incoming context key.

  `RunStore.hasActiveRun` / `countActiveRuns` / `cancelActiveRuns` gain an optional `contextKey` filter (the `automation_runs.context_key` column already exists, so no migration). `respectConcurrencyMode` threads the scope through. This is the primitive the default auto-incident automations need for faithful per-system deduplication.

- b995afb: Add the entity state machine core (`defineEntity`) - the foundational primitive of the reactive automation engine - as a Model-B plugin-backed reactive WRAPPER with NO framework-owned current-state storage.

  `defineEntity` owns NO current-state storage of its own. Each kind declares a required plugin `read` accessor pointing at wherever its state lives (its own durable table, or a value computed on read from its own durable tables), and `defineEntity` makes that state reactive. There is no framework current-state store and no "homeless" fallback: every kind is plugin-backed. This makes a non-reactive write structurally impossible and guarantees every transition is durably logged without duplicating the plugin's state.

  - `@checkstack/automation-backend`:

    - New `automation.entity` extension point exposing `defineEntity(input)`, `declareNonReactiveState(input)`, `onEntityChanged(...)`, and `registerChangeDeriver(...)`. automation-backend registers the impl in `register`, so other plugins can resolve it and declare entities during their own `register`/`init` (Proxy-buffered until the impl registers).
    - **Driven single mutation entry point.** All reactive-state writes go through `handle.mutate({ id, opts?, apply: () => Promise<TState> })`. The handle snapshots `prev` via `read` BEFORE the write, runs the plugin's `apply` (the actual write, committed in the PLUGIN's own transaction, returning the resulting state), validates `next` (zod), masks run-originated writes through the run-secret registry, diffs prev to next, and on a real diff appends the field-level transition rows to `entity_transitions` and emits `ENTITY_CHANGED` - both AFTER the plugin write commits (never on a rolled-back / throwing write). A structurally-unchanged write is a no-op. `handle.remove({ id, opts?, apply: () => Promise<void> })` is the tombstone counterpart (records the tombstone transition, emits next = null).
    - **Cross-plugin transaction boundary.** `apply` takes NO framework tx: a plugin-backed kind lives behind a DIFFERENT drizzle client than `entity_transitions`, and two clients cannot share one transaction. The plugin write is authoritative; the transition-log append runs in the framework's own transaction AFTER the plugin write commits. A failure between them leaves correct plugin state with a missing history row (a gap, never a corruption).
    - **`get` / `getMany`** route to the kind's `read`; **`inStateSince` / `inStateForMs` / `transitionCount`** read the per-field `entity_transitions` log (generalizing Phase-13 health transitions to any entity).
    - **No framework keyed store.** There is no generic `entity_state` table, no `createKeyedStore`, and no `entityKeyedStoreServiceRef`: kinds whose state has no domain table of their own (the `health` aggregate, the `slo` budget/streak view) compute their `read` on demand from their own durable data instead of materializing a framework copy. `entity_transitions` (the change-history log) is the framework's ONLY persistent table and is written for EVERY kind regardless of where current state lives.
    - **`entityResolverFor(kind)`** routes scope enrichment + the reactive `wait_until` wake re-eval to each kind's `read` accessor. Generalized scope enrichment (`enrichScopeWithEntities`) folds any `state.<kind>.<id>` ref into `scope.state.<kind>.<id>.<field>`. The rich `scope.health.*` condition snapshot (status, latency, success rate, in-maintenance, transitions-in-window, ...) is resolved EXCLUSIVELY through the healthcheck RPC path (the health aggregate is computed on read, not stored as a framework row) and the generic entity pass never writes `scope.health`; `state.health.*` remains the minimal reactive entity view. These are two complementary projections by design, not a migration shim.
    - **Horizontal-scale read-consistency guard.** A reactive entity's current state MUST be globally readable from shared/durable storage, never process-local memory (`.agent/rules/state-and-scale.md`). Enforced by the `checkstack/no-pod-local-entity-state` ESLint tripwire at the `defineEntity({ read })` boundary (wired at `warn`) and the deterministic `cross-pod-read-consistency.it.test.ts` integration test.
    - Load-time validation hard-fails a malformed registration (non-`z.object` state, missing/duplicate `kind`, or a missing / non-function `read`).
    - The `ENTITY_CHANGED` hook is internal (not exported); the change emitter buffers events produced during the init window and flushes them in order once the hook wiring is available in `afterPluginsReady`.

  - `@checkstack/automation-common`:

    - New `EntityChangedSchema` (the `ENTITY_CHANGED` payload - `kind`, `id`, `prev`, `next`, `delta`, `changedFields`, `actor`, `occurredAt`) and `DispatchJobSchema` (the Stage-2 `trigger` / `wake` dispatch job).

  - `@checkstack/automation-frontend`: the `wait_until` editor no longer offers the inert `poll_seconds` field (reactive waits don't poll).

  This phase adds the primitive only: domains are migrated in their own changesets. No external behavior changes for existing automations.

  BREAKING CHANGES: There is no framework current-state store. Any out-of-tree plugin must own its entity state in its own durable storage (its own table, or a compute-on-read over it) and pass a `read` accessor to `defineEntity`. `createKeyedStore` / `KeyedStore` / `entityKeyedStoreServiceRef` / `EntityKeyedStoreService` do not exist, and there is no `entity_state` table. `handle.set` / `handle.patch` and the `indexes` option do not exist; all writes go through `handle.mutate` / `handle.remove`.

- b995afb: Fix four reactive-automation-engine defects in the `wait_until` / entity-change dispatch path.

  - **Lost-wakeup re-evaluate-on-registration guard (HIGH, data-loss race).** `executeWaitUntil` evaluated its condition, then committed the wait lock + wake-index rows with NO re-evaluation after arming. An `ENTITY_CHANGED` for a relevant ref landing in that arm window was routed by Stage-1 against a not-yet-visible lock, enqueued no wake job, and — for a no-timeout wait (`timeoutAt` null, skipped by the sweeper) — the run stalled permanently (silent run leak). After arming the lock the engine now re-evaluates ONCE against freshly re-enriched scope; if the condition already holds it deletes the lock (its wake-index rows cascade) and continues the run inline. Idempotent via the lock delete + the per-run advisory lock.

  - **Wildcard health wake drops the changed system (MEDIUM, correctness).** `reEnrichWaitScope` resolved health only for the trigger `contextKey` + `uses_state` ids and excluded the changed ref from health resolution. A wildcard health wait (`health:*`) woken by `health:sysX` — where `sysX` was neither the contextKey nor in `uses_state` — never had `scope.health.systems[sysX]` populated, so the condition read stale/empty state and failed to resume. The changed system's concrete id is now injected into health resolution during a wildcard wake.

  - **`changeId` for dispatch dedup (LOW, correctness).** The Stage-2 trigger `jobId` embedded `changed.occurredAt` (millisecond granularity), so two DISTINCT changes to the same entity within one millisecond collapsed onto one job (the second run silently dropped). `EntityChangedSchema` gains an additive, back-compatible `changeId` (generated ONCE at emit time so it travels with redeliveries of the same change); the Stage-2 jobId now uses `changed.changeId` (falling back to `occurredAt` for legacy payloads). Redeliveries of one change still dedup; two real changes stay distinct.

  - **Run-originated `mutate` returns the unmasked next state (LOW, correctness).** `handle.mutate` returned the `maskForRun`-masked next state, contradicting its "returns the resulting state" contract. Masking is now confined to the emitted `ENTITY_CHANGED` payload and the `entity_transitions` rows only; `mutate` returns the unmasked, zod-validated resulting state.

  BREAKING CHANGES: none. The `changeId` field is additive and optional; all changes are behavior-preserving except where they fix the defects above.

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

- 270ef29: Extend in-UI script testing to health-check collectors, and add
  load-from-run replay for automation script tests.

  - Health-check collectors: a new `testCollectorScript` RPC runs the
    inline-script (TypeScript) collector and the shell `script` collector
    against an editable, auto-seeded sample context using the same
    sandboxed runner the real collector uses. Surfaces beneath the
    collector script fields in the collector editor (both marked
    `x-script-testable`). Gated by `healthcheck.configuration.manage`.
  - Automation replay: a new `getRunScopeForReplay` RPC reconstructs an
    editable test context from a real run (trigger + persisted artifacts,
    plus the durable scope snapshot when the run is still in-flight), and
    the script-test panel gains a "Load from run" picker that seeds the
    sample context from a past run.

  Note: health-check executions do not persist the script / config /
  check / system that produced a result, so there is no health-check
  replay - auto-seed is the only context source for collector tests. This
  is by design; see the feature plan.

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

- b995afb: Add an optional `partitionBy` override to the windowed-count trigger gate.

  A trigger's `window` block now accepts `partitionBy`, a bare expression (same flavour as `filter`, no `{{ }}`) that controls the key the occurrence count is bucketed by. When omitted, the gate keys by the trigger's built-in context key exactly as before (per system for health triggers), so existing automations are unchanged. When set, the expression is evaluated against the same trigger scope `filter` uses and coerced to a string - e.g. `trigger.payload.severity` for a per-severity rate, or `trigger.payload.systemId + ":" + trigger.payload.checkId` for a composite key. If the expression evaluates to null/undefined/empty or fails to evaluate, the gate falls back to the built-in context key (never global counting); eval errors are logged, matching the gate's fail-open posture.

  Triggers can now declare `contextKeyLabel` (a UI hint, e.g. `"system"`) describing their built-in context dimension. It is surfaced through `TriggerInfo` so the editor's window "Partition by" field shows the default partition ("Leave blank to count per system" / "per automation" when a trigger has no context key). The healthcheck system triggers (`system_health_changed`, `system_degraded`, `system_healthy`, `check_failed`) and the built-in `numeric_state` trigger set it to `"system"`. This is a pure UI hint with no runtime behaviour.

  The automation editor's window block gains a "Partition by" expression input (reusing the trigger filter's `trigger.payload.*` autocomplete), and the collapsed trigger card summary shows the partition when set.

- b995afb: Add a generic windowed-count / rate trigger gate, and express flapping detection on it.

  Any trigger can now carry a `window: { count, minutes, refire }` block: the automation engine records each qualifying occurrence (after the structured config gate and the operator's `filter`) in a durable append log and counts rows within the trailing sliding window, scoped per context key (e.g. per system). `refire: "every"` (default) fires on every occurrence at/over the threshold; `refire: "once"` fires only on the crossing edge and re-arms as old occurrences age out. The gate runs in `maybeStartRun` after `filter` and before the `for:` dwell, so it composes with both.

  Flapping is now an instance of this mechanism rather than a bespoke detector. The healthcheck `system_health_changed` raw change event plus a `filter` (`trigger.payload.newStatus != "healthy"`) plus `window: { count: 3, minutes: 60, refire: "once" }` reproduces flapping in the engine.

  State-and-scale: window state lives in the new `automation_window_events` Postgres table (FK-cascade on the automation, the same delete-lifecycle as `automation_dwell_timers`). The count is read with pure SQL so every pod computes the same answer; the work-queue claim gives exactly one INSERT per emission, so there is no double-count. Rows older than the 24h schema cap are pruned by the existing stalled-sweeper. The `once` policy is best-effort under at-least-once redelivery (a redelivered emission can skip the exact crossing edge; `every` is redelivery-tolerant).

  **BREAKING CHANGES:**

  - The `healthcheck.flapping_detected` automation trigger and the `healthcheck.flapping_detected` hook are REMOVED. Flapping is now detected by the windowed-count gate on the `healthcheck.system_health_changed` trigger (`window` block, `refire: "once"`).
  - Flapping is now PER-SYSTEM (the aggregated `health` entity), not per-`(system, configuration)`. Subscribe to `check_failed` with a `window` instead if you need per-check rate detection.
  - The healthcheck `health_check_unhealthy_transitions` table is DROPPED (the per-check flapping audit log is no longer kept; counting moved into the engine).
  - The backend-only `automation.subscriptions` service ref (`automationSubscriptionsRef` / `AutomationSubscriptions`) is REMOVED. The engine enumerates subscribers internally and the window gate runs per-automation inside `maybeStartRun`, so the external read-ref is no longer needed.
  - Existing user-created flapping automations are AUTO-MIGRATED on boot: any trigger on `healthcheck.flapping_detected` is rewritten to `healthcheck.system_health_changed` + the canonical unhealthy-transition filter + `window: { count: transitions ?? 3, minutes: windowMinutes ?? 60, refire: "once" }`, dropping the old `config`. A pre-existing trigger filter is replaced with the canonical one (logged per row). An enabled automation that still references the removed event after migration logs a warning.

### Patch Changes

- Updated dependencies [270ef29]
  - @checkstack/template-engine@0.3.0

## 0.2.0

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

- e1a2077: feat(automation): reference artifacts by explicit action id (`artifacts.<id>.<name>`)

  Multiple actions of the same type (e.g. two "create Jira issue" steps) used
  to collide: both produced the artifact type `integration-jira.issue`, so a
  template could only ever reach "the most recent one of that type". Artifacts
  are now addressed by the producing action's instance `id` instead.

  - Templates reference a produced artifact solely as
    `{{ artifacts.<actionId>.<localArtifactName>.<field> }}`, e.g.
    `{{ artifacts.open_jira.issue.issueKey }}`. The local artifact name is the
    producing action's `produces` id with the owning plugin prefix stripped
    (`integration-jira.issue` -> `issue`).
  - `@checkstack/automation-backend`: the dispatch engine nests each produced
    artifact under `artifacts[actionId][localName]` in the template scope and
    records the `actionId` on the artifact row. `validate-definition` now
    enforces that action ids are unique within an automation and that every
    artifact-producing action carries an id.
  - `@checkstack/automation-common`: action `id` is constrained to an
    identifier (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) so it is always usable as a
    plain template segment. The variable-scope resolver surfaces
    `artifacts.<id>.<name>` (with full field completion) in the editor.
  - `@checkstack/automation-frontend`: the action editor now has editable `Id`
    and `Description` inputs (previously settable only via the YAML view), and
    new steps get an auto-assigned, unique, log-friendly default id that the
    operator can rename. Action ids are recorded on every run step, so run
    logs are parseable by id regardless of kind.

  **BREAKING (beta):** the previous flat, type-keyed scope form
  `{{ artifacts["integration-jira.issue"] }}` is removed. Reference artifacts
  by the producing action's id instead. Action ids may no longer contain
  hyphens or dots (identifier characters only). Artifacts are per-run and
  ephemeral, so no stored-data migration is needed.

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

- 41c77f4: feat(automation): backend RPC router with the full 15-endpoint contract

  Wires up `core/automation-backend/src/router.ts` covering automation CRUD,
  definition validation, manual runs, run history, registry introspection,
  and a template playground. The contract is refactored to use the
  project's `proc()` pattern so `autoAuthMiddleware` enforces `read` /
  `manage` access automatically, and `AutomationApi` is exported via
  `createClientDefinition` for the frontend client.

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

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

- 6d52276: feat(automation): expose `trigger.actor` so automations can filter on who/what caused an event

  Every platform event now carries an **actor** - the user, application (API
  client), service (backend-to-backend), or `system` (background /
  unauthenticated) that caused it - and the automation engine surfaces it to
  automations as `trigger.actor`. This lets a trigger filter gate on the
  origin of the event it reacts to:

  ```text
  {{ trigger.actor.type == "system" }}      # auto-created by the platform
  {{ trigger.actor.type == "user" }}         # a human
  {{ trigger.actor.id == "app-deploybot" }}  # a specific application
  ```

  `trigger.actor` is available on **every** trigger - it is injected by the
  platform, not declared per trigger - and editor autocomplete + Run Script
  context types include `trigger.actor.{type,id,name}`.

  How it works:

  - **`@checkstack/common`** adds the canonical `Actor` type / `ActorSchema`
    and `SYSTEM_ACTOR`.
  - **`@checkstack/backend-api`** adds `resolveActor(user)` and a
    `HookEventMeta` envelope. The hook listener / `onHook` signature gains an
    optional second `meta` argument (additive, backward compatible).
  - **`@checkstack/backend`** wraps emitted hooks in an envelope so the actor
    travels with the payload through the distributed queue, unwrapping it
    before delivery. The RPC emit path captures the authenticated caller;
    background emits default to the system actor. Raw/legacy queue data is
    treated as a system-actor payload, so delivery stays backward compatible.
  - **`@checkstack/automation-backend`** threads the actor into the dispatch
    scope (`trigger.actor`), available to trigger filters, top-level
    conditions, and all run templates, and persisted in the run's scope
    snapshot. Manual runs are attributed to the invoking user.
  - **`@checkstack/automation-common`** / **`@checkstack/automation-frontend`**
    expose `trigger.actor` in the editor variable scope and the generated
    Run Script `context.trigger.actor` types.

  No database migration and no per-trigger schema changes: the actor rides as
  event-envelope metadata and in the run scope snapshot.

- 6d52276: feat(automation): expose `trigger.id` and reconcile the trigger scope so multiple triggers are distinguishable

  Automations with more than one trigger could not tell which trigger fired:
  the trigger id wasn't queryable, and scripts only received `trigger.event`
  (so two triggers on the same event were indistinguishable). This exposes a
  consistent trigger contract everywhere - `trigger.id`, `trigger.event`,
  `trigger.actor`, `trigger.payload` - in templates, shell, and TypeScript
  scripts.

  - **`trigger.id` is now available** in templates (`{{ trigger.id }}`) and in
    the script context (`context.trigger.id`). It is typed as the **literal
    union** of the automation's trigger ids, so it discriminates triggers -
    including two subscribed to the same `event`.
  - **Auto-generated trigger ids.** The editor now assigns a unique, log-
    friendly id to every trigger (derived from its event, e.g.
    `incident_created`, deduped as `incident_created_2`), mirroring action ids:
    seeded on the starter automation, assigned on add, and re-filled on blur.
  - **Scripts now receive `trigger.id` and `trigger.actor`.** The
    `ActionRunScope` projection previously dropped both (it only forwarded
    `event` + `payload`), so `context.trigger.actor` was typed but never
    populated - that gap is fixed.
  - **Scope key reconciled.** The internal dispatch scope now exposes
    `trigger.event` as the canonical key (matching the editor and script
    contract) instead of leaking `trigger.eventId`; `trigger.eventId` is kept
    as a back-compat alias, so `{{ trigger.event }}` now resolves in template
    fields where it previously returned `undefined`.

  No database migration: the actor and id ride in the run scope snapshot. A
  shared `deriveTriggerId` is exported from `@checkstack/automation-common` so
  the editor, generated script types, and the runtime all agree on derived ids.

### Patch Changes

- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
  - @checkstack/template-engine@0.2.0
  - @checkstack/common@0.12.0
  - @checkstack/signal-common@0.2.5
