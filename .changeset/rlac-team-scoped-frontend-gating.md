---
"@checkstack/common": minor
"@checkstack/frontend-api": minor
"@checkstack/auth-common": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/slo-common": minor
"@checkstack/slo-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
"@checkstack/status-page-common": minor
"@checkstack/status-page-frontend": minor
"@checkstack/dependency-common": minor
"@checkstack/dependency-frontend": minor
---

Make the frontend fully RLAC-aware so team-scoped users see and can use exactly
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
