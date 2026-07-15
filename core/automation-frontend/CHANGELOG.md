# @checkstack/automation-frontend

## 0.12.7

### Patch Changes

- 6c8b36b: Annotate two deliberate effect-based state mirrors with the
  `checkstack/no-state-seed-in-effect` lint rule: the automation edit page's
  YAML-tab mirror of the visual editor's `definition`, and the theme toggle's
  mirror of the global resolved theme. Both are one-way mirrors of values the user
  never edits directly, so they are safe exceptions to the rule. Comment-only - no
  runtime behavior change.
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/ui@1.29.0
  - @checkstack/auth-common@0.15.0
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/gitops-frontend@0.7.8
  - @checkstack/secrets-frontend@0.3.16
  - @checkstack/common@0.23.0
  - @checkstack/script-packages-frontend@0.4.17
  - @checkstack/ai-common@0.6.7
  - @checkstack/automation-common@0.10.2
  - @checkstack/integration-common@0.9.10
  - @checkstack/template-engine@0.4.12
  - @checkstack/signal-frontend@0.3.7

## 0.12.6

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/gitops-frontend@0.7.7
  - @checkstack/script-packages-frontend@0.4.16
  - @checkstack/secrets-frontend@0.3.15
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-common@0.14.0
  - @checkstack/automation-common@0.10.1
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/integration-common@0.9.9
  - @checkstack/signal-frontend@0.3.6
  - @checkstack/template-engine@0.4.11

## 0.12.5

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/auth-frontend@0.13.5
  - @checkstack/gitops-frontend@0.7.6
  - @checkstack/script-packages-frontend@0.4.15
  - @checkstack/secrets-frontend@0.3.14

## 0.12.4

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/gitops-frontend@0.7.5
  - @checkstack/script-packages-frontend@0.4.14
  - @checkstack/secrets-frontend@0.3.13
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-common@0.14.0
  - @checkstack/automation-common@0.10.1
  - @checkstack/common@0.22.0
  - @checkstack/integration-common@0.9.9
  - @checkstack/signal-frontend@0.3.6
  - @checkstack/template-engine@0.4.11

## 0.12.3

### Patch Changes

- Updated dependencies [5e704cd]
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/auth-frontend@0.13.3
  - @checkstack/gitops-frontend@0.7.4
  - @checkstack/script-packages-frontend@0.4.13
  - @checkstack/secrets-frontend@0.3.12
  - @checkstack/catalog-common@2.7.2

## 0.12.2

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/auth-common@0.14.0
  - @checkstack/frontend-api@0.14.2
  - @checkstack/auth-frontend@0.13.2
  - @checkstack/gitops-frontend@0.7.3
  - @checkstack/script-packages-frontend@0.4.12
  - @checkstack/secrets-frontend@0.3.11
  - @checkstack/catalog-common@2.7.1

## 0.12.1

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/catalog-common@2.7.0
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/auth-frontend@0.13.1
  - @checkstack/gitops-frontend@0.7.2
  - @checkstack/script-packages-frontend@0.4.11
  - @checkstack/secrets-frontend@0.3.10

## 0.12.0

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
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/automation-common@0.10.0
  - @checkstack/auth-common@0.13.0
  - @checkstack/ai-common@0.6.6
  - @checkstack/gitops-frontend@0.7.1
  - @checkstack/integration-common@0.9.8
  - @checkstack/script-packages-frontend@0.4.10
  - @checkstack/secrets-frontend@0.3.9
  - @checkstack/template-engine@0.4.11
  - @checkstack/signal-frontend@0.3.5

## 0.11.0

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
  - @checkstack/gitops-frontend@0.7.0
  - @checkstack/ui@1.25.0
  - @checkstack/script-packages-frontend@0.4.9
  - @checkstack/secrets-frontend@0.3.8

## 0.10.3

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/gitops-frontend@0.6.8
  - @checkstack/script-packages-frontend@0.4.8
  - @checkstack/secrets-frontend@0.3.7
  - @checkstack/ai-common@0.6.5
  - @checkstack/auth-common@0.12.2
  - @checkstack/automation-common@0.9.2
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/integration-common@0.9.7
  - @checkstack/template-engine@0.4.10
  - @checkstack/signal-frontend@0.3.4

## 0.10.2

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/ui@1.23.0
  - @checkstack/secrets-frontend@0.3.6
  - @checkstack/ai-common@0.6.4
  - @checkstack/auth-common@0.12.1
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/automation-common@0.9.1
  - @checkstack/catalog-common@2.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/gitops-frontend@0.6.7
  - @checkstack/integration-common@0.9.6
  - @checkstack/script-packages-frontend@0.4.7
  - @checkstack/template-engine@0.4.9
  - @checkstack/signal-frontend@0.3.3

## 0.10.1

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1
  - @checkstack/gitops-frontend@0.6.6
  - @checkstack/script-packages-frontend@0.4.6

## 0.10.0

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
  - @checkstack/auth-common@0.12.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/automation-common@0.9.0
  - @checkstack/gitops-frontend@0.6.5
  - @checkstack/script-packages-frontend@0.4.5
  - @checkstack/secrets-frontend@0.3.5
  - @checkstack/ai-common@0.6.3
  - @checkstack/integration-common@0.9.5
  - @checkstack/signal-frontend@0.3.2
  - @checkstack/template-engine@0.4.8

## 0.9.3

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2
  - @checkstack/gitops-frontend@0.6.4
  - @checkstack/script-packages-frontend@0.4.4
  - @checkstack/secrets-frontend@0.3.4

## 0.9.2

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/ui@1.20.0
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/ai-common@0.6.2
  - @checkstack/auth-common@0.11.2
  - @checkstack/automation-common@0.8.2
  - @checkstack/frontend-api@0.12.1
  - @checkstack/gitops-frontend@0.6.3
  - @checkstack/integration-common@0.9.4
  - @checkstack/script-packages-frontend@0.4.3
  - @checkstack/secrets-frontend@0.3.3
  - @checkstack/template-engine@0.4.7
  - @checkstack/signal-frontend@0.3.1

## 0.9.1

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
  - @checkstack/ai-common@0.6.1
  - @checkstack/auth-common@0.11.1
  - @checkstack/automation-common@0.8.1
  - @checkstack/catalog-common@2.4.3
  - @checkstack/gitops-frontend@0.6.2
  - @checkstack/integration-common@0.9.3
  - @checkstack/script-packages-frontend@0.4.2
  - @checkstack/secrets-frontend@0.3.2
  - @checkstack/common@0.17.0
  - @checkstack/template-engine@0.4.6

## 0.9.0

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

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-common@0.8.0
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1
  - @checkstack/gitops-frontend@0.6.1
  - @checkstack/script-packages-frontend@0.4.1
  - @checkstack/secrets-frontend@0.3.1

## 0.8.0

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

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

- 8cad340: Explain why Save is disabled and guard against losing unsaved edits in the
  automation and health-check editors.

  - A greyed-out Save is no longer a dead end: both editors now render a
    "N issue(s) blocking" affordance next to the Save button. Opening it
    lists every blocker, and clicking one jumps to the offending field/section
    (the automation Name / Run-as fields or the visual definition editor; the
    health-check tree node that owns the issue). The existing validation logic is
    unchanged - the blockers are just surfaced and made actionable.
  - The first field of a fresh automation (Name) now auto-focuses so keyboard-first
    users can type immediately.
  - Both editors now use the shared `useUnsavedChanges` hook for unsaved-changes
    protection: a native prompt on tab close / refresh plus an in-app
    "Discard unsaved changes?" confirmation when navigating away mid-edit. The
    health-check editor's previous hand-rolled `beforeunload` listener is migrated
    to the shared hook; the automation editor gains dirty tracking and the same
    guard.

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

- 8cad340: fix: make data tables responsive on narrow viewports

  The users, teams, and roles management tables (auth-frontend), the automation
  run-history table (automation-frontend), and the integration provider
  connections table (integration-frontend) previously overflowed horizontally on
  phone-width (~375px) viewports. Each now uses the `ResponsiveTable` +
  `MobileCardList` dual-layout primitive from `@checkstack/ui`: the existing table
  renders unchanged on `sm` and up, with a stacked per-row card surfacing the key
  fields and action buttons below `sm`. Shared per-row rendering (role checkboxes,
  team/role/connection action buttons, connection status) was lifted into small
  local components so both layouts stay in sync.

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
  - @checkstack/auth-frontend@0.9.0
  - @checkstack/ai-common@0.6.0
  - @checkstack/ui@1.17.0
  - @checkstack/gitops-frontend@0.6.0
  - @checkstack/script-packages-frontend@0.4.0
  - @checkstack/secrets-frontend@0.3.0
  - @checkstack/common@0.17.0
  - @checkstack/auth-common@0.11.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/automation-common@0.7.1
  - @checkstack/integration-common@0.9.2
  - @checkstack/template-engine@0.4.6
  - @checkstack/signal-frontend@0.2.6

## 0.7.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/gitops-frontend@0.5.9
  - @checkstack/script-packages-frontend@0.3.13
  - @checkstack/secrets-frontend@0.2.8
  - @checkstack/ui@1.16.2

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

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/ai-common@0.5.0
  - @checkstack/auth-common@0.10.0
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-common@0.7.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/gitops-frontend@0.5.8
  - @checkstack/integration-common@0.9.1
  - @checkstack/script-packages-frontend@0.3.12
  - @checkstack/secrets-frontend@0.2.7
  - @checkstack/template-engine@0.4.5
  - @checkstack/signal-frontend@0.2.5

## 0.6.1

### Patch Changes

- @checkstack/script-packages-frontend@0.3.11

## 0.6.0

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

- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
  - @checkstack/ai-common@0.4.0
  - @checkstack/ui@1.16.0
  - @checkstack/automation-common@0.6.0
  - @checkstack/auth-common@0.9.1
  - @checkstack/template-engine@0.4.4
  - @checkstack/gitops-frontend@0.5.7
  - @checkstack/script-packages-frontend@0.3.10
  - @checkstack/secrets-frontend@0.2.6
  - @checkstack/catalog-common@2.3.6

## 0.5.0

### Minor Changes

- ebef442: feat(ai): let the assistant resolve dynamic integration-action field values

  Integration action fields like Jira `create_issue`'s `projectKey`, `issueTypeId`,
  and `priorityId` are not free-form - their valid values come from the connected
  system (the editor renders them as cascading dropdowns via `x-options-resolver`).
  The AI assistant had no way to fetch those values, so it guessed, and propose-time
  validation never checked them - a fabricated `projectKey` only failed at runtime.

  - **New user-callable `integration.resolveConnectionOptions` RPC** (the non-admin
    counterpart of `getConnectionOptions`, mirroring `listConnectionSummaries`), so
    automation authors and the assistant can resolve a field's options without
    `integration.manage`. Returns option labels/values only.
  - **New `automation.resolveActionOptions` AI tool**: resolves a field's valid
    values live from the connection, the same source the editor dropdown uses. It
    is provider-agnostic (reads the field's resolver and `x-depends-on` from the
    action's own schema) and dependency-aware - for a cascade like `issueTypeId`
    (depends on `projectKey`), the model resolves the parent first and passes it in
    `dependencies`.
  - **Propose-time options validation**: `automation.propose` now checks every
    literal dynamic-option value against the live options for its connection
    (sourcing each field's dependency values from the same config so cascades
    resolve), flagging values the connection does not offer with guidance to call
    `automation.resolveActionOptions`. Templated values and fields with
    templated/absent dependencies are skipped; a resolver lookup failure is skipped
    rather than blocking, so transient provider flakiness never gates a proposal.

  - **Automation editor works for non-admins**: the editor's option-resolver
    bridge now calls the user-callable `listConnectionSummaries` /
    `resolveConnectionOptions` instead of the admin-gated `listConnections` /
    `getConnectionOptions`, so an automation author without `integration.manage`
    gets working connection pickers and cascading dropdowns instead of empty/
    forbidden ones.

  The resolver lookup and the dependency handling are factored into reusable
  helpers that work for any provider's `x-options-resolver` fields.

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-common@0.9.0
  - @checkstack/automation-common@0.5.0
  - @checkstack/auth-common@0.9.0
  - @checkstack/catalog-common@2.3.5
  - @checkstack/script-packages-frontend@0.3.9
  - @checkstack/gitops-frontend@0.5.6

## 0.4.8

### Patch Changes

- Updated dependencies [c4bebbb]
  - @checkstack/integration-common@0.8.0
  - @checkstack/script-packages-frontend@0.3.8

## 0.4.7

### Patch Changes

- @checkstack/script-packages-frontend@0.3.7

## 0.4.6

### Patch Changes

- @checkstack/script-packages-frontend@0.3.6

## 0.4.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-common@0.8.3
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/automation-common@0.4.3
  - @checkstack/integration-common@0.7.3
  - @checkstack/gitops-frontend@0.5.5
  - @checkstack/script-packages-frontend@0.3.5
  - @checkstack/secrets-frontend@0.2.5
  - @checkstack/template-engine@0.4.3
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
  - @checkstack/gitops-frontend@0.5.4
  - @checkstack/script-packages-frontend@0.3.4
  - @checkstack/secrets-frontend@0.2.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/common@0.14.1
  - @checkstack/integration-common@0.7.2
  - @checkstack/template-engine@0.4.2

## 0.4.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/gitops-frontend@0.5.3
  - @checkstack/script-packages-frontend@0.3.3
  - @checkstack/secrets-frontend@0.2.3
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/signal-frontend@0.2.2
  - @checkstack/template-engine@0.4.2

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/gitops-frontend@0.5.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/script-packages-frontend@0.3.2
  - @checkstack/secrets-frontend@0.2.2
  - @checkstack/template-engine@0.4.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/auth-common@0.8.1
  - @checkstack/automation-common@0.4.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/gitops-frontend@0.5.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/script-packages-frontend@0.3.1
  - @checkstack/secrets-frontend@0.2.1
  - @checkstack/template-engine@0.4.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.4.0

### Minor Changes

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/auth-common@0.8.0
  - @checkstack/automation-common@0.4.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/template-engine@0.4.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/gitops-frontend@0.5.0
  - @checkstack/script-packages-frontend@0.3.0
  - @checkstack/secrets-frontend@0.2.0
  - @checkstack/integration-common@0.7.0
  - @checkstack/signal-frontend@0.2.0

## 0.3.0

### Minor Changes

- b995afb: Redesign the automation visual editor to a Home-Assistant-style collapsed-card UX.

  Every item in all three sections (actions, triggers, conditions) now renders as a compact summary row by default - icon, title, and a one-line summary derived from its config. Clicking the row opens the item's full configuration in a right-side sheet that edits the same live definition (no draft/commit step), so closing the sheet keeps the changes. The saved `definition` is unchanged - only the editor presentation - so the visual and YAML views still round-trip losslessly.

  - `@checkstack/ui` `ActionCard` gains three optional, backward-compatible props: `onOpenSheet` (turns the card into a non-expanding summary row that opens a host-supplied sheet on header click), `summary` (the compact one-line hint shown under the title), and `actions` (a typed `ActionCardMenuItem[]` rendered as a three-dot overflow menu). The new `ActionCardMenuItem` type is exported. Existing inline-expand usages are unaffected when the new props are omitted.
  - Per-card commands move into the overflow menu: Disable/Enable, a new Duplicate, and Delete. The drag grip stays on the action card header; actions keep dnd-kit reordering and the parallel id array. Triggers and conditions remain non-reorderable.
  - Duplicate clones an item with fresh, unique ids (via the existing id helpers) and inserts it directly after the original, keeping the editor's parallel id array in sync.
  - Composite actions (choose / parallel / repeat / sequence) keep nesting: a child card inside a parent's sheet opens its OWN sheet, stacking via Radix Dialog's portal + overlay.
  - Cards with validation errors auto-open their sheet and show an error badge on the collapsed row, so problems are never hidden behind a collapsed row plus a closed sheet.

- b995afb: Show auto-generated trigger ids in the automation editor without clicking the field.

  Previously, loading a stored definition (a seeded default, a GitOps-managed automation, or hand-written YAML) whose triggers carried no `id` left the Id field blank until the operator focused and blurred it. The editor now materializes the derived id eagerly on load - the same way the starter automation and "Add step" path already do - so the id is shown (and referenceable as `trigger.id`) immediately. The runtime already derived these ids, so saved definitions are unchanged.

  The auto-incident migration also now writes explicit trigger ids (matching `deriveTriggerId(event)`) into the seeded sustained and flapping automations, so newly seeded defaults carry the same id the editor shows.

- 270ef29: Add progressive disclosure and a live system picker to the automation visual editor.

  The saved `definition` is unchanged - only the editor layout - so the visual and YAML views still round-trip losslessly.

  - Triggers: the event picker and trigger config stay prominent; the optional `id`, gating `filter`, and `for:` dwell move into a per-trigger "Advanced" disclosure that auto-opens when a filter or dwell is set.
  - Actions: per-action metadata (`id`, `description`, `continue_on_error`) moves into an "Advanced" disclosure inside the action card so the action's own configuration leads. Enable/disable stays on the card header.
  - Conditions: the kind selector is grouped so the structured kinds (`numeric_state` / `time` / `state`) lead, the logical combinators follow, and the raw-expression escape hatch is de-emphasised under "Advanced" - all kinds stay reachable.
  - The `state` condition's `entity` is now a live system picker backed by the catalog `getSystems` RPC, with a manual-entry fallback so an id not in the catalog (or a `{{ template }}`) still round-trips losslessly.

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

- 270ef29: Add the `wait_until` action primitive (Wave 2 Phase 17) - suspend a running automation until a condition becomes true, with an optional timeout (HA's `wait_template`).

  - New `wait_until: { condition, timeout_seconds?, continue_on_timeout? }` primitive. `continue_on_timeout` defaults to true (HA semantics). Added to the schema, the action union, and `detectActionKind`. (The wait is fully reactive - see the reactive-dispatch-pipeline changeset; there is no `poll_seconds`.)
  - `condition` accepts any condition shape - a template string or the Phase 16 structured `numeric_state` / `time` / `state` variants.
  - Reactive resume: if the condition is already true it continues inline; otherwise it persists a `kind: "until"` wait lock (carrying the condition + timeout policy in a new `wait_config` jsonb column). The reactive-dispatch-pipeline changeset replaces the original poll-based re-check with a wake-index + a single timeout timer, so the wait is woken by a relevant entity change rather than ticked on an interval. Resumes take the per-run advisory lock so a wake and a sweep can't double-resume.
  - Survives restart: the wait lock is the source of truth, and the stalled sweeper applies the timeout policy as a backstop if the wake/timer signal is lost.
  - Works nested inside `choose` / `parallel` / `repeat` via the existing resume-remainder mechanism.
  - Editor: a `wait_until` action card (frontend) mirroring `wait_for_trigger` - a `ConditionEditor` plus timeout and continue-on-timeout inputs. The structured numeric/time/state ConditionEditor branches land with the rest of the sensing-layer editor work; the card uses the expression-based editor for now.

- 270ef29: Add the sensing-layer editor UX (Wave 2 Phase 19) - the visual widgets for the duration-aware and structured-condition building blocks from Phases 15-18.

  - New `@checkstack/ui` components (each with a Storybook story):
    - `DurationInput` - number + unit (`seconds` / `minutes` / `hours`) picker emitting the single-unit `Duration` object the backend accepts, so it round-trips losslessly through YAML.
    - `TimeOfDayInput` - HH:MM (24h) input emitting the `"HH:mm"` string the `time` condition's `after` / `before` accept. Both are plain inputs (no animations), so no `usePerformance` gating is needed.
  - `DynamicForm`'s `FormField` gains an additive `x-duration` / `format: "duration"` branch that renders `DurationInput` for schema-driven duration configs. (Additive alongside the existing dispatch; reconciles cleanly with the parallel branch's `FormField` edits.)
  - The `ConditionEditor` kind selector gains `numeric_state` / `time` / `state` structured branches: an operator dropdown (above / below / between) + threshold for numeric, `TimeOfDayInput` + weekday toggles + timezone for time, and a status dropdown + optional `DurationInput` dwell for state. The raw-expression escape hatch is kept. Pure `kindOf` / `defaultForKind` helpers are split into a UI-free `condition-kind` module so they unit-test under bun (the UI barrel drags Monaco).
  - The trigger card gains a `for:` dwell toggle + `DurationInput` (Phase 15's schema was already round-tripping in YAML).

  Visual and YAML views stay lossless; structured conditions authored in either are editable in the other.

- 270ef29: Add the GitOps `Automation` entity kind (Wave 2 Phase 21).

  - `automation-backend` registers an `Automation` kind with the GitOps entity-kind registry (`specSchema: AutomationDefinitionSchema`). Reconcile upserts by name (identity tracked via the returned entity id + provenance); reconciled rows are tagged `managed_by = "gitops"`. Delete is guarded to GitOps-managed rows. An automation's full definition - triggers (with `for:` dwells), structured conditions, the action catalog, mode, `concurrency_scope`, `uses_state`, `state_window_minutes` - can now be declared in Git.
  - `automation-frontend`: the editor reads the GitOps provenance lock (`useProvenanceLock({ kind: "Automation", entityId })`) and, when locked, disables Save / Run-now / Delete and the form fields and shows a `GitOpsLockBanner`.
  - Documented the `Automation` YAML format under the GitOps kinds reference, plus new automation platform overview + plugin-author ("extending") developer-guide pages.

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

- b995afb: Add type-picker modals for the automation editor's Triggers and Conditions sections, matching the Actions "Add step" picker.

  Instead of immediately creating a default element, both sections now open a searchable, grouped picker dialog so the operator chooses the type up front. The "Add" button moves out of each card's header to a bottom button styled exactly like the Actions "+ Add step" button.

  - Triggers: a new "Add trigger" picker over the registry's trigger events (grouped by category, searchable). On pick the trigger is created with a unique default id (deduped against siblings) and appended.
  - Conditions: a new "Add condition" picker over the condition kinds (grouped Structured / Logical / Advanced, searchable). On pick a schema-seeded default for that kind is appended.
  - The shared `PickerRow`, add button and search input are extracted into a reusable `picker-dialog` module; `AddActionDialog` now consumes them.
  - Condition kinds gain a `CONDITION_KIND_META` registry (label, description, icon, group) as the single source of metadata for the picker.
  - Since the type is now chosen up front, the redundant in-sheet selectors are removed: the trigger config sheet drops its editable "Event" dropdown (keeping a read-only owner/description context line), and the top-level condition sheet drops its kind selector (swap kind = delete + re-add). Nested combinator clauses and the action `condition`-guard body keep their inline kind selector.
  - New automations now start empty (no pre-filled trigger or action); the empty-state hints guide the operator to add a trigger and steps via the pickers.

  The saved `definition` is unchanged - only how items are added - so the visual and YAML views still round-trip losslessly. Triggers and conditions remain non-reorderable.

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

- b995afb: Fix `context.*` IntelliSense disappearing in the automation inline-script editor.

  The action editor concatenates the scope-derived `declare const context`
  global with the `secretEnv` `process.env` augmentation into a single Monaco
  extra-lib. `generateSecretEnvTypes` emitted module-form output
  (`declare global { … } export {};`), and the top-level `export {};` turned the
  whole concatenated `.d.ts` into a module - which silently demoted
  `declare const context` from a global ambient to a module-local binding, so
  `context.trigger.payload` (and everything under `context`) stopped
  autocompleting. Because the empty case also emitted `export {};`, every
  automation script action was affected regardless of declared secrets. Health
  check script editors were unaffected (they never merge the secretEnv lib).

  `generateSecretEnvTypes` now emits a global-script-compatible ambient
  augmentation (`declare namespace NodeJS { interface ProcessEnv { … } }`) and an
  empty string when there is nothing to declare, so the merged extra-lib stays a
  global script and `context` remains globally visible. A regression test guards
  that the merged `context + secretEnv` output contains no top-level
  `export`/`import`.

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

- 270ef29: Wire up the script-packages RPC router, admin UI, and editor IntelliSense.

  - `script-packages-backend`: the oRPC router implementing the full
    contract (allowlist CRUD, registry config with encrypted write-only auth
    token, `installNow` via the elected installer, size cap, storage backend
    selection, install state, `getManifest` / `downloadBlob` for reconcilers,
    and `listPackageTypes`), the `installNow` controller (election, size-cap
    enforcement, `script-packages.changed` emit, blocked during migration),
    the `.d.ts` rollup, the singleton config stores, and the full plugin
    wiring (broadcast-hook reconcile + startup backstop).
  - `script-packages-common`: admin route for the settings page.
  - `script-packages-frontend`: the Settings -> Script Packages admin page
    (allowlist, install state + size, registry/storage summary, satellite
    sync) and the `useScriptPackageTypes()` hook.
  - `automation-frontend` / `healthcheck-frontend`: merge installed-package
    `.d.ts` into the script-editor `typeDefinitions` so `import` from an
    allowlisted package autocompletes in every script field.

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

- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
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
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/automation-common@0.3.0
  - @checkstack/template-engine@0.3.0
  - @checkstack/script-packages-frontend@0.2.0
  - @checkstack/secrets-frontend@0.1.0
  - @checkstack/gitops-frontend@0.4.7

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

- 41c77f4: feat(automation): Phase 12 — frontend plugin (Visual + YAML)

  Ships the complete operator-facing surface for the automation platform:

  **Pages**

  - `AutomationListPage` — paginated table of every automation. Inline
    enable / disable toggle, status filter, "Runs" deep-link per row,
    trash-button delete with a confirmation modal. Rows themselves
    navigate to the edit page on click; toggle / delete cells
    `stopPropagation` to avoid the navigation.
  - `AutomationEditPage` — **Visual ↔ YAML** tab switcher; both tabs
    read/write the same canonical `definition` state, switching tabs
    first commits the active tab's edits (parsing YAML on YAML→Visual)
    so neither side ever wins by accident. Top-level metadata form
    (name, description, status toggle, mode, max_runs) sits in a side
    column. Save flow: commit active tab → `validateDefinition` RPC →
    `createAutomation` / `updateAutomation`. Parse + validation errors
    render as a destructive Alert. The "Run now" action fires
    `manualRun` with the first declared trigger and navigates to the
    resulting run detail.

    **Visual tab** ships the full editor. `AutomationDefinitionEditor`
    composes three sections — triggers, pre-run conditions, actions —
    using the Phase 11 UI primitives (`ActionCard`,
    `TemplateValueInput`, `VariablePicker`) plus a new `editor/`
    module:

    - `TriggersEditor` — per-trigger card with combobox event picker
      (`ItemPicker`), optional `id` and `filter`, and a `DynamicForm`
      for trigger config when the selected trigger declares a
      `configSchema`.
    - `ConditionsEditor` + recursive `ConditionEditor` — top-level
      pre-run gating and the same recursive editor reused inside
      `choose: when` clauses. Each level picks `expression` /
      `and` / `or` / `not`; `and` / `or` host child conditions with
      add/remove buttons; expression mode uses `TemplateValueInput`
      with inline `VariablePicker`.
    - `ActionListEditor` — drag-to-reorder via `@dnd-kit/core` +
      `@dnd-kit/sortable`. Maintains a parallel stable-id array so
      in-place edits don't churn React keys but reorders do. Add-step
      popover offers all 10 action kinds with their icons.
    - `ActionEditor` — dispatch component that picks the right
      per-kind body and wraps it in a shared `ActionCard` (icon,
      title, category badge, enable toggle, delete, drag handle).
      Header exposes a kind-swap `<Select>` that preserves
      operator-set metadata (id, description, enabled,
      continue_on_error).
    - Per-kind bodies covering every primitive — Provider (with
      `DynamicForm` over the action's `configJsonSchema`), Variables
      (KeyValueEditor with JSON-or-template parsing), Stop, Delay
      (seconds vs template toggle), WaitForTrigger (event picker +
      filter + timeout + context_key), ConditionGuard (reuses
      `ConditionEditor`), Choose (recursive when-branches + optional
      else), Parallel, Sequence, Repeat (count / for_each / while /
      until + nested sequence + max_iterations safety net).
    - **Scope-aware autocomplete.** A
      `useVariableScope({ definition, path })` hook drives template
      properties for every field — each action card knows its
      `ActionPath`, so the `{{` autocomplete + `VariablePicker` only
      ever offers paths actually in scope at that position,
      including condition-narrowed `trigger.payload.*` inside `when:`
      branches. Reuses Phase 11's `resolveVariableScope`.

    **YAML tab** — Monaco `yaml` editor round-tripping the full schema
    via `yaml.parse` / `yaml.stringify`.

  - `RunsPage` — run history for a single automation. Status filter
    buttons across the canonical `RunStatus` enum
    (`pending|running|waiting|success|failed|cancelled|skipped`), rows
    link to the run detail.
  - `RunDetailPage` — single run drill-down. Shows the run header (status
    - duration), a destructive Alert with `errorMessage` when the run
      failed, a per-step timeline with status icon + attempts + inline
      error message + collapsible result payload, the trigger payload as
      read-only JSON in Monaco, and an artifacts panel listing every
      produced artifact keyed by `artifactType`. Cancel-run button when the
      run is `running` or `waiting`.
  - `TemplatePlaygroundPage` — left/right editors for template body and
    sample JSON context, mode switcher between `template` and
    `condition`, "Render" button that calls `renderTemplate` RPC and
    shows either the rendered string (template mode) or the boolean
    result (condition mode). Parse errors come back with line/column
    info shown alongside the error message — Monaco inline markers come
    in a later polish pass.

  **Plugin entry + slot extensions**

  - `createFrontendPlugin({...})` wires every route, all access-gated
    through `automationAccess.read` and `automationAccess.manage`:
    - `/automation/` → list (read)
    - `/automation/new` → blank edit page (manage)
    - `/automation/:automationId` → edit (read, save gated on manage)
    - `/automation/:automationId/runs` → run history (read)
    - `/automation/:automationId/runs/:runId` → run drill-down (read)
    - `/automation/playground` → playground (read)
  - `AutomationMenuItems` slot extension on `UserMenuItemsSlot` adds an
    "Automations" entry to the user menu for any user with
    `automation.read`. Mirrors `incident-frontend`'s pattern of hiding
    the menu link from unauthorised users even though the route itself
    is also access-gated.
  - No `foreignSignals` declared: every signal the automation domain
    emits (`AUTOMATION_DEFINITION_CHANGED`, `AUTOMATION_RUN_*`) is owned
    by this plugin, so the auto-invalidator wires it for free.

  **Reused components, no duplication**

  Every page is built from `@checkstack/ui` primitives: `PageLayout`,
  `Card`, `Table`, `Badge`, `Toggle`, `Button`, `Select`,
  `LoadingSpinner`, `QueryErrorState`, `EmptyState`,
  `ConfirmationModal`, `Alert`, `CodeEditor`, `Tabs`, `DynamicForm`,
  `KeyValueEditor`, `Popover`, `ActionCard`, `TemplateValueInput`,
  `VariablePicker`. The visual editor's only new components are the
  ones the existing UI library deliberately doesn't ship (combobox
  `ItemPicker`, plus the automation-domain editors themselves) —
  everything else is composition.

  **New deps**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
  (drag-to-reorder), already in the monorepo via `catalog-frontend`'s
  core/utilities usage; we add `sortable` because the action list needs
  the higher-level sortable abstraction.

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

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
- Updated dependencies [c39ee69]
  - @checkstack/automation-common@0.2.0
  - @checkstack/frontend-api@0.6.0
  - @checkstack/ui@1.11.0
  - @checkstack/template-engine@0.2.0
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/signal-frontend@0.1.5
