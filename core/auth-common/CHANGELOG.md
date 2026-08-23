# @checkstack/auth-common

## 0.17.1

### Patch Changes

- c972254: Upgrade Better Auth to 1.7.1, adopt the OAuth Provider MCP plugin, and enforce
  shared PostgreSQL rate limits atomically. Preserve legacy OAuth tables during
  the schema migration so existing clients can be re-registered safely.

## 0.17.0

### Minor Changes

- 1deaac5: Add the `objectRef` instanceAccess mode and move the relation-write authz onto it

  The relation-tuple writes (`writeRelation` / `removeRelation` / `setObjectPublic`)
  administer team access on ANY resource type, so their authorization could not be
  expressed by the existing `instanceAccess` modes (which all assume a fixed
  resource type) and was enforced by hand in the auth handlers with `access: []` -
  leaving the contract unable to declare the rule and the API docs showing no
  restriction.

  A new `objectRef` mode reads the object's TYPE and id from the request body
  (`typeParam` / `idParam`) and authorizes via the same engine native scoping uses:
  the endpoint's own access rule (`auth.teams.manage`) is the global admin
  OR-override, otherwise the caller must be able to manage the referenced object
  (its own `<type>.manage` rule on a non-private object, or a team editor/owner
  grant on it). `autoAuthMiddleware` enforces it, the boot validator recognises it
  (input paths cross-checked), and the auth handlers drop their hand-rolled checks.
  Behaviour is unchanged; the authorization is now contract-declared and enforced
  by the middleware rather than the handler.

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

## 0.16.0

### Minor Changes

- be74b01: Let teams that manage a resource administer its team access (delegation)

  Editing a resource's team access on the "Who can change this" editor (add/remove
  teams, toggle Manage, toggle Private) was gated on the GLOBAL `auth.teams.manage`
  rule on both the frontend and backend, so only a platform admin could do it -
  even a member of a team that already manages the resource saw the editor
  read-only.

  `writeRelation`, `removeRelation` and `setObjectPublic` now authorize per-object:
  the caller may edit a resource's team access when they can MANAGE that specific
  resource - a global `auth.teams.manage` admin, a holder of the resource's own
  `<type>.manage` rule (e.g. `catalog.system.manage`), or a member of a team that
  holds an editor/owner grant on it. A team that only reads the resource (viewer
  grant), or has no grant and no global rule, is read-only and CANNOT elevate its
  own or another team's access. The check reuses the existing ReBAC engine
  (`tupleStore.check({ action: "manage" })`), so team-only (private) resources are
  respected: a global resource-manager who is not on a granted team cannot reach a
  private resource - only a `teams.manage` admin or a granted team can. The first
  grant on an otherwise-unscoped resource still requires one of the global rules.

  A new `canManageObjectAccess` query runs the SAME authorization, and the
  `TeamAccessEditor` gates its write controls on it instead of the global rule, so
  the UI shows exactly the controls a write would accept (no frontend/backend
  drift). The backend re-checks on every write, so it remains the security
  boundary.

  BREAKING CHANGE: granting/revoking a team's access to a resource is no longer
  admin-only - it is delegated to whoever can manage that resource. If you relied
  on only `auth.teams.manage` holders being able to change resource team-access,
  note that members of a team that manages the resource can now do so too (a
  read-only team still cannot).

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

## 0.15.0

### Minor Changes

- 6c8b36b: Catalog manage tabs: per-row owner badge, de-bloated membership chips, and a
  reusable batched ownership lookup.

  - New batched auth primitive `listObjectRelationsBulk({ objectType, objectIds })`
    resolves the owning team(s) and privacy for MANY resources of one type in a
    single query (mirrors the per-object `listObjectRelations`). Backed by a new
    `RelationTupleStore.listObjectRelationsBulk`. This is the table-friendly
    counterpart any plugin can use to render an owner indicator per row without an
    N+1.
  - New `@checkstack/auth-frontend` helpers built on it: `useResourcesManagedBy`
    (batched hook, gated on `auth.teams.read`) and the compact `ResourceOwnerBadge`
    presentational pill. The catalog Groups and Environments manage tabs now show a
    per-row "owned by <team>" badge and a one-line note that these are shared,
    globally-visible objects only the owning team can rename/delete.
  - Membership chips on the Systems / Groups / Environments manage tabs collapse to
    a single count pill ("N systems") whose popover holds the members plus a
    name-sorted, searchable add list, instead of wrapping a full chip wall that
    made rows tall. Attaching/detaching a system to a group/environment is offered
    and enabled only for systems the caller can manage (matching the backend, which
    authorizes membership per `catalog.system` manage).
  - Groups and Environments manage rows gain the same per-row "Scope to team"
    quick action Systems already had, so an owner can grant a team Manage/Read on a
    group or environment straight from the table. The action is a reusable
    `ScopeToTeamAction` (any team-scoped resource type) exported from
    `@checkstack/auth-frontend`; `ScopeSystemToTeamAction` is now a thin adapter
    over it. It self-gates on `auth.teams.manage` and defers mounting its dialog
    until first use.
  - The Groups and Environments manage tabs gain row selection and a bulk-action
    bar, matching Systems: select the rows you manage, then bulk **Scope to team**
    (grant a team on many at once), bulk **Add system** (attach one system to every
    selected group/environment), or bulk **Delete**. Rows you cannot manage render
    a disabled checkbox and are excluded from "select all". The bulk scope button
    is a reusable `BulkScopeToTeamAction` exported from `@checkstack/auth-frontend`
    (the multi-select counterpart of `ScopeToTeamAction`); the systems bulk filler
    is now a thin adapter over it. Attaching a system to many environments is a
    single desired-set write, so the writes cannot race.
  - Consistency polish across the three manage tabs: all row **Edit** actions now
    use the same pencil icon (Systems previously used a different one); **Groups**
    now edit through the same dialog editor as Systems and Environments (with a
    per-row Edit action) instead of an inline name field that had no matching Edit
    button; and the Systems **Health** column keeps its state badges on one row
    (side by side) instead of wrapping a second badge onto its own line.
  - `@checkstack/ui` `DataTable` gains a per-column `truncate` option: the column
    absorbs the table's spare width and ellipsizes overflowing free-text (a long
    name/description) instead of letting one long value force the whole table to
    scroll horizontally. Cell content is vertically centered by default.

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

### Patch Changes

- Updated dependencies [6c8b36b]
  - @checkstack/common@0.23.0

## 0.14.0

### Minor Changes

- bd41130: perf(auth): cache the authenticated read path on the shared distributed cache

  `readEnrichedUser` ran three joins on EVERY authenticated request - user -> roles,
  role -> access rules, and (for guests) the anonymous role's rules - which were
  among the highest-call-count queries in production even though the underlying
  mappings change only on rare admin edits. These are now served read-through from
  the **platform `CacheManager`** (the same shared cache every plugin uses):

  - `user -> role ids` and `role -> access-rule ids` (`auth-backend/src/auth-cache.ts`)
  - anonymous role -> effective rules (read in `core/backend`'s
    `getAnonymousAccessRules`, under auth-backend's cache scope)

  Cross-pod correctness comes from the SHARED backend, not from an application
  broadcast: with a distributed provider (Redis) an invalidation is a `delete`
  every pod sees immediately, so a user load-balanced to any pod always gets an
  up-to-date authorization decision. On the default in-memory backend the caches
  are per-pod and therefore single-instance-only (the Infrastructure Cache UI now
  warns about this). The 60s TTL is only a natural-refresh safety net. User role
  membership itself is still resolved live per request; only the rarely-changing
  derived mappings are cached.

  The reads happen CACHE-FIRST, OUTSIDE any database transaction: `enrichUser` no
  longer wraps its lookups in `withScopedTransaction`, so on a cache hit it issues
  NO query for roles/rules and never holds a pooled DB connection across the cache
  round-trip - only the always-uncached team read touches the DB.

  The invalidation is enforced by design, not by convention: all writes to the
  `role` / `role_access_rule` / `user_role` tables go through a single
  `RoleMembershipStore` that now takes the shared cache as a required constructor
  argument and welds each write to its `delete`, so the two cannot drift. The
  `checkstack/no-direct-role-membership-writes` lint rule (error) still forbids raw
  `insert`/`update`/`delete` on those tables anywhere else in `auth-backend`.

  Invalidation completeness (from an adversarial review):

  - `RoleMembershipStore.removeAccessRuleMappings` (plugin-deregister cleanup) now
    also evicts the anonymous-access-rules entry, since a removed rule may have
    been granted to the anonymous role.
  - `access-rule-sync`'s boot `fullSync` now evicts the affected shared entries
    when a default-rule change actually mutates a non-admin role's grants - a later
    pod's boot / a redeploy runs it against a cache the cluster already warmed, so
    the old "runs against a cold cache" assumption no longer holds under the shared
    cache. An idempotent no-change sync evicts nothing.
  - The batched `role -> access-rule ids` read now runs through
    `CachedScope.wrapManyBatched`, so it carries the same epoch guard as the
    single-key path: a role-rules revoke racing an in-flight load can no longer be
    clobbered by the loader's stale write.

  BREAKING CHANGE: the internal cache-invalidation hooks
  `authHooks.roleAccessRulesInvalidated`, `authHooks.userRolesInvalidated`, and
  `coreHooks.anonymousAccessRulesInvalidated` are removed, along with their
  per-pod broadcast subscribers. They existed only to keep the old per-pod caches
  coherent; the shared cache makes them redundant. These were internal signals,
  never a plugin-facing extension contract. `@checkstack/auth-common` now exports
  `AUTH_CACHE_PLUGIN_ID` and `ANONYMOUS_ACCESS_RULES_CACHE_KEY` so `core/backend`
  and `auth-backend` agree on the shared scope + key for the anonymous entry.

## 0.13.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0

## 0.12.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0

## 0.12.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0

## 0.12.0

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

## 0.11.2

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 0.11.1

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

  - @checkstack/common@0.17.0

## 0.11.0

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

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

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
  - @checkstack/common@0.16.0

## 0.9.1

### Patch Changes

- 4134ed9: Fix a performance regression in `getBindableApplications`: it resolved every
  application's effective access rules with 3-4 queries per application on every
  call, which the AI propose / service-account flow hits on each chat turn,
  showing up as broad slowness on the shared database. Rule resolution is now
  batched into a fixed number of queries regardless of how many applications
  exist, and an admin (`*`) caller that does not need the rules (the editor's
  "Run as" picker) skips resolution entirely. The query gains an optional
  `includeAccessRules` input (default off); `accessRules` is returned only when
  requested.

## 0.9.0

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

## 0.8.3

### Patch Changes

- 0626782: Guard the role editor against granting inert (and misleading) permissions to the
  anonymous role.

  RPC procedures carry two independent axes: `userType` (the hard authentication
  gate) and `access` rules (authorization). An admin can grant the anonymous role
  any access rule, but if the procedures needing that rule are `userType:
"authenticated"`/`"user"`, the grant does nothing - the auth middleware rejects
  unauthenticated callers BEFORE access rules are checked (so there is no security
  hole; the grant is simply inert). After anonymous users started seeing
  permission-gated UI, such a grant would surface as visible-but-broken controls.

  - The backend now computes, from contract metadata, the access rules an anonymous
    caller can actually use (a rule is "usable" iff at least one `public` procedure
    requires it) via `pluginManager.getAnonymousUsableAccessRuleIds()`, exposed to
    plugins through the plugin environment.
  - `auth.getAccessRules` annotates each rule with `anonymousUsable`.
  - `auth.updateRole` REFUSES to ADD a non-usable rule to the anonymous role
    (existing grants are untouched, so no configuration can be wedged). This is a
    guardrail, not an enforcement change - RPC authorization is unchanged.
  - The role editor disables non-usable rules (with an explanation) when editing
    the anonymous role.

  Verified live: `getAccessRules` reports 11 anonymous-usable vs 58 not; granting
  `incident.incident.manage` to the anonymous role returns HTTP 400 with a clear
  message.

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

## 0.8.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 0.8.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

## 0.8.0

### Minor Changes

- 9dcc848: Add the AI platform: a transport-agnostic tool spine, an OAuth Authorization Server + read-only MCP server, a propose/apply flow with audit log, a streaming in-app chat agent, per-conversation permission modes, per-integration spend caps, and user-scoped tool authorization.

  Two new packages, `@checkstack/ai-common` (the `AiTool` contract, `read`/`mutate`/`destructive` effect classification, the `ai.*` access rules, the OpenAI-compatible connection shape, and the wire contracts) and `@checkstack/ai-backend` (the tool registry, extension points, principal-to-tool resolver, shared zod-to-JSON-Schema serializer, and all transports). The OpenAI-compatible integration provider registers through the existing integration provider extension point, so its API key is stored in the Secrets Vault and configured in the generic Connections UI.

  What ships:

  - Tool spine and extension points: `aiToolExtensionPoint.registerTool` (hand-authored composite tools) and `aiToolProjectionExtensionPoint.expose` (opt-in projections of existing oRPC procedures). Authorization mirrors `autoAuthMiddleware` exactly - a tool is surfaced only when every `requiredAccessRules` entry is satisfied, so a scope-narrowed principal can only ever see fewer tools.
  - OAuth + MCP: Checkstack can act as its own OAuth 2.1 Authorization Server (authorization code + PKCE, consent screen, Dynamic Client Registration) and expose a read-only MCP server over Streamable HTTP at `/api/ai/mcp`. Off by default, enabled by the admin `ai.mcp-oauth` setting. A Bearer OAuth-token branch is added to the auth strategy; token scopes are intersected live with the bound user's access rules on every call. A shared-Postgres rate limiter throttles the DCR endpoint per client IP. `getMcpOAuthSettings` / `setMcpOAuthSettings` contracts added to `@checkstack/auth-common`. A minimal OAuth consent page (`/auth/oauth-consent`) renders the requesting client and scopes.
  - Propose/apply + audit: a transport-agnostic two-step service - `propose` re-checks authz, runs the tool's `dryRun` without mutating, and returns a single-use proposal token (the `proposed` audit row IS the token store, 10-minute TTL, atomic single-use); `apply` re-parses the server-stored payload, re-checks authz, and atomically commits. The `ai_tool_calls` audit table records every call across both transports with a SHA-256 args hash (never raw arguments) and stamps who proposed and who applied. An `ai.toolCalled` event carries metadata only.
  - In-app chat: a server-side, provider-agnostic Vercel AI SDK agent loop (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio, ...). The model provider is built on the backend from the integration credentials, so the API key never leaves the backend. The loop offers only resolver-allowed tools, auto-runs read tools (re-entering the live router as the logged-in user) and routes mutating / destructive tools through propose/apply. Durable conversation persistence (`ai_conversations`, `ai_messages`, owner-scoped RPCs) plus a streaming chat UI with a confirm-card component and per-integration model picker.
  - Per-conversation permission mode (Claude-Code-style approve/auto), a durable `permission_mode` column on `ai_conversations` (default `approve`). `read` always auto-runs in both modes; `mutate` inherits the mode (auto-applies server-side in `auto`, confirm-carded in `approve`); `destructive` ALWAYS requires the human `applyTool` in both modes. Security invariant (structural + tested): the mode is consulted only on the `mutate` branch, so no `(effect, mode)` pair routes a destructive tool to auto-apply.
  - Per-integration LLM spend cap (optional `spendCap` = `tokenBudget` + `windowMinutes`, default OFF). Spend is tracked in a shared-Postgres `ai_spend` ledger; enforcement is a rolling-window SUM run before each turn (HTTP 429 over budget). Per-principal tool rate-limit budgets are a rolling COUNT over `ai_tool_calls`, enforced on both transports. An absent / empty / incomplete `spendCap` is treated as "no cap" rather than rejected.
  - Full tool-call replay: `ai_messages.model_messages` (jsonb) persists the canonical AI-SDK `ResponseMessage[]` per turn and replays them verbatim on the next turn; legacy rows fall back to text-only replay.
  - Enforced no-secret-leak scrubbing: `appendMessage` runs `scrubContent` on every write, redacting credential-shaped keys and high-confidence credential values; a canary regression test asserts injected secrets are stripped. A hardening test suite asserts no secret appears in any AI-surface DTO and that handler-side authz holds when the model misbehaves.
  - Provider correctness: the chat provider uses `@ai-sdk/openai-compatible`'s `chatModel` (plain `/chat/completions`), so OpenAI-compatible gateways (OpenRouter, DeepSeek, Ollama, vLLM) no longer reject turns with `invalid_prompt`; `@ai-sdk/openai` is removed.

  BREAKING CHANGES:

  - The `AiTool` contract (`@checkstack/ai-common`) gained a `TRpc` type parameter, and both `dryRun` and `execute` now receive a USER-SCOPED `rpcClient` arg bound to the originating user. Every plugin procedure a tool calls re-enters the live router AS THAT USER, so handler-side authorization (access rules AND per-resource/team scope) is enforced exactly as a direct UI/RPC call - closing a prior privilege-escalation where tools captured a trusted service client at construction. A hand-authored tool MUST resolve its plugin client from this per-call arg and MUST NOT capture a trusted service client at factory scope. Tool factories that previously took `{ rpcClient }` should drop that parameter.
  - `AiToolProjectionExtensionPoint.expose` no longer takes a second `pluginMetadata` argument; the owning metadata lives on `input.sourcePluginMetadata`. Callers must drop the second argument.

  State and scale: conversations, messages, the audit log, proposal tokens, the rate-limit counter, and the spend ledger all live in shared Postgres, so every pod answers identically and the agent loop is resumable on any pod. The only pod-local state is the live MCP connection registry (bookkeeping, never a source of truth). Cross-pod conversation readback, the spend cap, and the tool budget are verified by env-gated two-pod integration tests.

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

## 0.7.2

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0

## 0.7.1

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0

## 0.7.0

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

## 0.6.6

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0

## 0.6.5

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
  - @checkstack/common@0.8.0

## 0.6.4

### Patch Changes

- 32d52c6: Fix and improve password reset flow + email branding:

  - **Fix**: password reset emails were failing with "Malformed password reset URL: missing token parameter". Better-auth puts the reset token in the URL path (`/reset-password/{token}`), not as a `?token=` query param, so the previous URL-parsing logic always failed. Now uses the `token` argument better-auth passes to `sendResetPassword` directly.
  - **UX**: the reset password page now validates the token on load via a new anonymous `validateResetToken` endpoint, so users see "Invalid Link" / "Link Expired" before typing a password rather than after submitting. Tokens are 24-char nanoid-style values (~143 bits of entropy), so exposing validity does not enable enumeration.
  - **Fix**: transactional notifications were hardcoded to `importance: "critical"`, causing password reset emails to display a misleading "CRITICAL" badge. The `sendTransactional` contract now accepts an optional `importance` field that defaults to `"info"`.
  - **Branding**: redesigned the email layout (`wrapInEmailLayout`) with a Checkstack-style engineering aesthetic — dark header with grid pattern, monospace importance badge, hardened CTA button (Outlook VML fallback + explicit text color), and force-light color scheme to prevent client auto-inversion from breaking text legibility.

## 0.6.3

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0

## 0.6.2

### Patch Changes

- 889dd8c: Fix session loss for LDAP and SAML authentication strategies

  The auth bridge was joining multiple `Set-Cookie` headers into a single comma-separated string, which corrupted cookie attributes. This caused the `session_token` cookie to inherit the 5-minute `maxAge` from the `session_data` cache cookie instead of the intended 7-day expiry. After the cookie expired from the browser, `get-session` returned `null` and all API calls failed with 401.

  Changed the `createSession` RPC contract to return `setCookies: string[]` (array) instead of `setCookie: string`, and updated LDAP/SAML consumers to use `Headers.append("Set-Cookie", ...)` to set each cookie as a separate header.

## 0.6.1

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5

## 0.6.0

### Minor Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.

### Patch Changes

- c0c0ed2: Refactor manual session creation to use a secure, bridged oRPC endpoint. This ensures that custom authentication strategies (LDAP, SAML) leverage Better-Auth's native session establishment utilities, including cryptographic signing and reliable cookie attribute management.

## 0.5.7

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4

## 0.5.6

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
- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3

## 0.5.5

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2

## 0.5.4

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1

## 0.5.3

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0

## 0.5.2

### Patch Changes

- 8a87cd4: Updated access rules to use new `accessPair` interface

  Migrated to the new `accessPair` interface with per-level options objects for cleaner access rule definitions.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0

## 0.5.1

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0

## 0.5.0

### Minor Changes

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas

## 0.4.0

### Minor Changes

- df6ac7b: Added onboarding flow and user profile

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
  - @checkstack/common@0.3.0

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

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2

## 0.2.1

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0

## 0.2.0

### Minor Changes

- e26c08e: Add password change functionality for credential-authenticated users

  - Add `changePassword` route to auth-common
  - Create `ChangePasswordPage.tsx` component with password validation, current password verification, and session revocation option
  - Add "Change Password" menu item in User Menu
  - Reuses patterns from existing password reset flow for consistency

## 0.1.0

### Minor Changes

- 32f2535: Refactor application role assignment

  - Removed role selection from the application creation dialog
  - New applications now automatically receive the "Applications" role
  - Roles are now manageable inline in the Applications table (similar to user role management)
  - Added informational alert in create dialog explaining default role behavior

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

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

- Updated dependencies [ffc28f6]
  - @checkstack/common@0.1.0
