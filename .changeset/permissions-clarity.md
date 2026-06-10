---
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/common": minor
"@checkstack/ai-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/dependency-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/slo-backend": minor
"@checkstack/slo-common": minor
"@checkstack/slo-frontend": minor
---

Platform-wide team-scoped access control on a unified relation-tuple store.

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
- `TeamOwnershipPicker` explains *why* there's nothing to pick (not a member of
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
