# @checkstack/common

## 0.23.0

### Minor Changes

- 6c8b36b: Catalog **Groups** and **Environments** are now team-manageable. Their reads
  stay public (they are shared browse facets everyone can see), but creating,
  renaming, and deleting them is team-scoped exactly like Systems: a create
  writes an owning-team grant, and edit/delete require a per-instance manage
  grant. A team that can create Systems can also create Groups and Environments
  (and attach them to systems it manages) with no extra grant.

  New reusable platform seam `instanceAccess.create.alsoAcceptCreatorOf: string[]`:
  a create procedure can declare sibling types whose `creator` (create-capability)
  grant also authorizes the create - strictly the type-level creator grant, so it
  stays orthogonal to `create.parent` (which is instance-manage). It is backed by a
  new strict-creator auth primitive `hasCreateCapability({ objectType })` consumed
  by BOTH the create middleware and the frontend `canCreate` verdict (extended with
  an optional `alsoAcceptCreatorOf`), so the button gate and the backend can never
  drift. The boot conformance check now also verifies every `alsoAcceptCreatorOf`
  type is a real team-scoped type, and `catalog.group` / `catalog.environment` gain
  resource-name resolvers so their team grants render by name.

  BREAKING: `catalog.deleteGroup` input reshaped from a bare `string` to
  `{ id: string }` (mirrors the earlier `deleteSystem` reshape) so the per-group
  manage check can resolve the target id. `catalog.reorderGroups` stays a
  global-admin operation (it rewrites the single global sort order for all groups).
  Existing ownerless (global) groups and environments remain editable only by
  global catalog admins until re-owned; no data migration is required (team grants
  live in the auth relation store).

## 0.22.0

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

- f93ee7a: Fix a 403 that blocked team-scoped health-check managers from opening the
  health-check editor.

  The editor's utility endpoints (`healthcheck.getStrategies`,
  `healthcheck.getCollectors`, `healthcheck.testCollectorScript`, and the
  script-package SDK/type endpoints) were gated with `instanceAccess: { global:
true }` or a separate global `script-packages.read` rule. A `global: true` gate
  is enforced ONLY against a caller's global access rules - team grants never
  satisfy it - so a user who could manage a health check through a team grant, but
  did not hold the global `healthcheck.configuration.read` rule, got a 403 on the
  metadata endpoints the editor needs and could not open it.

  New `typeScoped` instanceAccess mode. A no-instance utility/catalog endpoint can
  now be gated by ANY team grant of its resource type (or the global rule): a
  `viewer`/`editor`/`owner` grant on any instance, or a `creator`
  (create-capability) grant so a team member who may CREATE the type can open its
  authoring UI before owning an instance. `healthcheck.getStrategies` /
  `getCollectors` use it at read level; `testCollectorScript` at manage level.
  Backed by an `includeCreator` option threaded through `hasAnyTypeGrant`
  (store -> auth S2S contract -> `AuthService`), so the create-capability path is
  counted only where intended (the list/record post-filter keeps its old
  semantics). The boot validator recognises `typeScoped` as one of the mutually
  exclusive modes.

  Script-package authoring endpoints relaxed to authenticated. `getInstallState`
  and the two raw type routes (`/api/script-packages/sdk-types/:version` and
  `/api/script-packages/types/:hash/:spec`) now require only authentication, not
  the global `script-packages.read` grant. They serve IntelliSense metadata
  (installed package inventory, `.d.ts` closures, the `@checkstack/sdk` bundle) -
  no secrets - which any script author, including a team-scoped health-check
  manager, needs. The install/registry MANAGE endpoints stay restricted.

  Why the team-permission guards did not catch this: `check:manage-capabilities`
  only covers management routes/nav, not the procedures a page calls; the boot
  conformance validator treats `global: true` as a deliberate, valid "not
  team-scoped" marker and cannot tell it is actually a dependency of a
  team-scopable editor flow. The RLAC rule now documents `typeScoped` as the
  correct mode and warns against `global: true` for endpoints a team manager
  needs.

## 0.21.0

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

## 0.20.0

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

## 0.19.0

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

## 0.18.0

### Minor Changes

- defb97b: feat(common): add the environments docs slug to APP_DOC_SLUGS

  Expose `APP_DOC_SLUGS.environments` so in-app deep links can point to the
  Environments concept page (used by the onboarding wizard's environments hint).
  Guarded by the existing docs-links contract test.

## 0.17.0

### Minor Changes

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

### Patch Changes

- 8cad340: fix(backend): quote and validate plugin schema identifiers in SQL

  Plugin schema identifiers are no longer interpolated raw into SQL. `pluginId` is
  now constrained to a safe charset (`pluginIdSchema` in `@checkstack/common`),
  `getPluginSchemaName` asserts that charset before producing a schema name, and
  the `SET LOCAL search_path` and `DROP SCHEMA` statements use `sql.identifier`
  (properly quoted and escaped) instead of string interpolation.

  This is defense in depth within an already-trusted boundary (installing a plugin
  is arbitrary code execution): no behavior changes for valid ids, but a
  malformed or hostile `pluginId` can no longer break out of a quoted identifier.

## 0.16.0

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

## 0.15.0

### Minor Changes

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

## 0.14.1

### Patch Changes

- 1fee9da: Republish the platform with correct internal cross-pins.

  The release pipeline's `version-packages` step ran `changeset version` (bumping every `package.json`) but never refreshed `bun.lock`, so the lockfile kept the pre-bump versions. Because `bun publish` resolves `workspace:*` from the lockfile, every published package pinned the _previous_ version of its `@checkstack/*` siblings (e.g. `@checkstack/backend-api@0.21.1` shipped depending on `@checkstack/cache-api@0.3.9` and `@checkstack/common@0.13.0` instead of `0.3.10` / `0.14.0`). That reintroduced the `backend-api -> cache-api -> backend-api` cycle for registry consumers and pinned `cache-api`/`queue-api` to a `common` version predating the `Logger`/`Migration` types they import.

  `version-packages` now runs `bun install --lockfile-only` after `changeset version`, so the lockfile matches the bumped versions before publish. This patch bump cascades through the dependency graph so every package republishes with its cross-pins resolved against the freshly-bumped versions.

## 0.14.0

### Minor Changes

- 13373ce: Break the publish-time dependency cycle between `@checkstack/backend-api` and `@checkstack/cache-api` / `@checkstack/queue-api`.

  `cache-api` and `queue-api` only ever used `Logger` and `Migration` from `backend-api` as `import type`, yet declared `@checkstack/backend-api` as a runtime dependency. In the monorepo this is harmless (everything resolves via `workspace:*`), but once published, `bun publish` freezes each `workspace:*` into a concrete pin of the _other_ package's then-current version. Because the dependency is mutual, a consumer installing these packages from the registry must resolve `backend-api -> cache-api -> backend-api -> ...` backward through release history until it reaches ancient versions that shipped raw `workspace:*` ranges and a long-removed `@checkstack/cache-api@0.1.0` pin - which fail to resolve. This surfaced as `bun install` errors (and a missing `checkstack-dev` binary) in freshly scaffolded standalone plugins.

  `Logger` and `Migration` now live in `@checkstack/common` (a dependency-free leaf package). `@checkstack/backend-api` re-exports both for backward compatibility, so existing `import type { Logger, Migration } from "@checkstack/backend-api"` call sites are unchanged. `cache-api` and `queue-api` now depend on `@checkstack/common` instead of `@checkstack/backend-api`, removing the cycle.

## 0.13.0

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

## 0.12.0

### Minor Changes

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

## 0.11.0

### Minor Changes

- f23f3c9: Add the canonical `PaginationInput` zod schema and `PaginatedResult`
  output factory in `@checkstack/common`. `PaginationInput` is an
  integer-clamped `{ limit: 1-100 (default 20), offset: >= 0 (default 0) }`
  shape that composes with `.extend({...})` for domain-specific filters
  (e.g. `unreadOnly` on notifications). `PaginatedResult(itemSchema)`
  returns the standard `{ items, total, limit, offset }` envelope. The
  existing `PaginationInputSchema` / `paginatedOutput` / `PaginatedResponse`
  exports are now marked `@deprecated` and will be removed once the
  follow-up sweep migrates every `*-common` consumer to the canonical
  contract.
- f23f3c9: Sweep every paginated `*-common` contract onto the canonical
  `PaginationInput` / `PaginatedResult` from `@checkstack/common` and
  remove the now-unused legacy exports.

  **BREAKING CHANGE** - `@checkstack/common` drops the deprecated
  `PaginationInputSchema`, `paginatedOutput`, and `PaginatedResponse`
  symbols. Callers must consume `PaginationInput` (input) and
  `PaginatedResult(itemSchema)` (output) instead. The canonical input is
  `{ limit (1-100, default 20), offset (>= 0, default 0) }`; the
  canonical output envelope is
  `{ items, total, limit, offset }`.

  **BREAKING CHANGE** - `@checkstack/notification-common` migrates
  `getNotifications` off the legacy `PaginationInputSchema`
  (`{ limit, offset, unreadOnly }` with output `{ notifications, total }`)
  onto `ListNotificationsInputSchema =
PaginationInput.extend({ unreadOnly })` and
  `PaginatedResult(NotificationSchema)`. The output key changes from
  `notifications` to `items`, and `limit` / `offset` are now echoed on
  the response. The `PaginationInput` type alias previously exported
  from `notification-common` is removed - use `ListNotificationsInput`
  or the canonical `PaginationInput` from `@checkstack/common`.

  **BREAKING CHANGE** - `@checkstack/integration-common` migrates
  `listSubscriptions` (inline `{ page, pageSize, ... }` -> output
  `{ subscriptions, total }`) and `getDeliveryLogs` (via
  `DeliveryLogQueryInputSchema` `{ subscriptionId?, eventType?, status?,
page, pageSize }` -> output `{ logs, total }`) onto the canonical
  `PaginationInput.extend({...})` input and
  `PaginatedResult(itemSchema)` output. External callers must switch
  from `{ page, pageSize }` to `{ limit, offset }` and read response
  items from `data.items` (no more `data.subscriptions` / `data.logs`).

  The matching `*-backend` handlers were updated to consume the new
  input shape (`offset` arithmetic in lieu of `(page - 1) * pageSize`)
  and to echo `limit` / `offset` on the response. The `*-frontend` call
  sites in `NotificationsPage`, `NotificationBell`, `IntegrationsPage`,
  and `DeliveryLogsPage` were updated to send the new input shape and
  read `data.items`.

## 0.10.0

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

## 0.9.0

### Minor Changes

- 42abfff: Add practical-significance floors to anomaly detection.

  Two new schema annotations — `x-anomaly-min-absolute-delta` and `x-anomaly-min-relative-delta` — let plugin authors and operators suppress alerts whose statistical deviation is large but practical impact is negligible. Both floors must clear in addition to the existing μ ± Nσ trigger; defaults are 0 (disabled) so existing behaviour is unchanged.

  This is the fix for cases like a 6 ms latency baseline whose σ ≈ 1 ms causes routine 20 ms blips to fire as anomalies despite Δ=14 ms being operationally irrelevant. With `min-absolute-delta: 50` and `min-relative-delta: 0.5`, those blips stay silent while a 6 ms → 200 ms spike still fires.

  Built-in plugins ship with sensible defaults applied to every per-run field: 50 ms + 50 % for ms-unit fields, 5 percentage points for `%`-unit fields, 1 + 25 % for counter fields, 1 GB + 5 % for disk fields, 50 MB + 10 % for memory fields, 1 day for TLS expiry, 0.5 + 25 % for load average, 1 + 5 % for Minecraft TPS. Operators can override per-system or per-field via the assignment UI.

## 0.8.0

### Minor Changes

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

## 0.7.0

### Minor Changes

- 8d1ef12: Phase 2 of anomaly detection: trend drift detection.

  The background baseline analyzer now computes a linear regression slope across each field's chronologically-ordered history and runs a `detectDrift` evaluator that catches gradual "creeping degradation" never reaching the 3σ spike threshold. Drifts share the same `anomalies` table as spike anomalies via a new `kind` column (`spike` | `drift`, default `spike`); the existing suspicious → anomaly → recovered lifecycle is reused, ticking at the analyzer's hourly cadence with a default 2-run confirmation window.

  User-facing additions: a Trend Drift toggle and threshold slider on both the template and assignment anomaly settings panels (with per-field overrides), drift rows in the System Anomaly widget, dashed regression-line overlays on the auto-generated line charts, and a new `ANOMALY_TREND_DETECTED` signal for live UI updates. Plugin authors can disable drift per chartable field via `x-anomaly-drift-enabled: false` or tighten/loosen it via `x-anomaly-drift-threshold`.

## 0.6.5

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

## 0.6.4

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.

## 0.6.3

### Patch Changes

- 0ebbe56: Security Vulnerability Remediation completed:
  - Refactored core authorization to Fail-Closed architecture with secure defaults.
  - Implemented `assertTeamManagementAccess` to resolve BOLA in Teams Management.
  - Protected internal S2S capabilities via explicit wildcard `serviceScope` definitions.
  - Disarmed OS Command Injection in DiskCollector via strict regex validation and bash escaping.
  - Re-architected inline script processing executing scripts in sandboxed Web Worker contexts.
  - Isolated subprocess environment scopes in PingStrategy limiting variable leakage.
  - Enforced strict token/API Key parsing with URLSearchParams checking.
  - Explicitly fail-fast on missing DATABASE_URL configuration across independent backend clusters.
  - Activated strict HTTP Security Headers (HSTS, CSP, X-Frame-Options) across the API automatically.

## 0.6.2

### Patch Changes

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

## 0.6.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

## 0.6.0

### Minor Changes

- db1f56f: Add ephemeral field stripping to reduce database storage for health checks

  - Added `x-ephemeral` metadata flag to `HealthResultMeta` for marking fields that should not be persisted
  - All health result factory functions (`healthResultString`, `healthResultNumber`, `healthResultBoolean`, `healthResultArray`, `healthResultJSONPath`) now accept `x-ephemeral`
  - Added `stripEphemeralFields()` utility to remove ephemeral fields before database storage
  - Integrated ephemeral field stripping into `queue-executor.ts` for all collector results
  - HTTP Request collector now explicitly marks `body` as ephemeral

  This significantly reduces database storage for health checks with large response bodies, while still allowing assertions to run against the full response at execution time.

## 0.5.0

### Minor Changes

- 8a87cd4: Refactored `accessPair` interface for cleaner access rule definitions

  The `accessPair` function now uses a more intuitive interface where each level (read/manage) has its own configuration object:

  ```typescript
  accessPair(
    "incident",
    {
      read: {
        description: "View incidents",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description: "Manage incidents",
      },
    },
    { idParam: "systemId" }
  );
  ```

  Also added `instanceAccess` field to `ProcedureMetadata` allowing bulk endpoints to share the same access rule as single endpoints with different filtering strategies.

## 0.4.0

### Minor Changes

- 83557c7: ## EditorType Definition

  - Added `EditorType` enum for multi-type editor support (json, yaml, xml, markdown, formdata, raw)

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

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

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

## 0.0.3

### Patch Changes

- f5b1f49: Added generic `TransportClient` interface for health check strategy transport abstraction.

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.

## 0.2.0

### Minor Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

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
