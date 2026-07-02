---
title: "Teams and Resource-Level Access Control"
description: "Group users into teams, grant resource-level access, and combine team-based RLAC with role-based access control."
---

## Overview

Checkstack provides a comprehensive **Teams** system for organizing users and controlling access to resources. Teams enable:

- **Group Management**: Organize users into logical groups (e.g., "Platform Team", "API Developers")
- **Resource-Level Access Control (RLAC)**: Grant teams specific access on individual resources
- **Granular Access Rules**: Support for read, manage, and exclusive access modes

This system complements the existing role-based access control (RBAC) by adding resource-level granularity.

## Architecture

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Team** | A named group of users with optional description |
| **Team Member** | A user belonging to a team |
| **Team Manager** | A user who can manage team membership and settings |
| **Resource Grant** | An access entry linking a team to a specific resource |

### Database Schema

Team membership lives in `team` / `userTeam` / `applicationTeam` / `teamManager`.
The entire **resource-access layer is a single relation-tuple store** - 
`relation_tuple` - that replaced the older `resource_team_access` (read/manage),
`resource_access_settings` (teamOnly), and `resource_create_grant` tables.

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────────────────────┐
│    team      │     │   userTeam   │     │        relation_tuple        │
├──────────────┤     ├──────────────┤     ├──────────────────────────────┤
│ id (PK)      │────▶│ teamId (FK)  │     │ object_type   (PK)           │
│ name         │     │ userId (FK)  │     │ object_id     (PK)  ("*"=type)│
│ description  │     └──────────────┘     │ relation      (PK)           │
└──────────────┘     ┌──────────────┐     │ subject_type  (PK)  team|public│
                     │ teamManager  │     │ subject_id    (PK)  teamId|"*" │
┌──────────────────┐ ├──────────────┤     └──────────────────────────────┘
│ applicationTeam  │ │ teamId (FK)  │
├──────────────────┤ │ userId (FK)  │   relation ∈ viewer | editor | owner | creator
│ applicationId    │ └──────────────┘   (owner ⊃ editor ⊃ viewer)
│ teamId (FK)      │
└──────────────────┘
```

One row means **"`<subject>` has `<relation>` on `<object>`"**:

- A **team** subject with `viewer` (read), `editor` (read+manage), or `owner`
  on a concrete object `{objectType}:{objectId}`.
- A **team** with `creator` on the type-level object `{objectType}:*` - the
  authority to create resources of that type.
- The special **`public:*`** subject with a `private` relation is the **privacy
  marker**: its *presence* closes the global RBAC path for that object (the old
  `teamOnly = true`, team grants only); its *absence* (the default) keeps the
  object globally readable. Privacy is an explicit marker rather than "absence
  of a public marker" so that a private object with zero team grants still
  denies everyone, preserving the old fail-closed invariant.

> [!NOTE]
> `relation_tuple` is the single source of truth for resource access. `is_owner`
> became the `owner` relation (one owner per object, partial-unique); read/manage
> became `viewer`/`editor`; teamOnly became the presence/absence of the private
> marker; create-capability became `creator` tuples. `subject_id` is polymorphic,
> so the table has no FK - team deletion clears the team's tuples explicitly.

### User Identity Enrichment

When a user authenticates, their team memberships are automatically loaded and included in their identity:

```typescript
interface RealUser {
  type: "user";
  id: string;
  accessRules: string[];
  roles: string[];
  teamIds: string[];  // All teams the user belongs to
}

interface ApplicationUser {
  type: "application";
  id: string;
  name: string;
  accessRules: string[];
  teamIds: string[];  // Teams the application is assigned to
}
```

This enrichment happens in:
- `auth-backend/src/utils/user.ts` → `enrichUser()` for real users
- `auth-backend/src/index.ts` → Application authentication for API keys

## API Reference

### Team Management Endpoints

All team endpoints require the `auth.teams.manage` access rule unless noted.

#### `getTeams`
Lists all teams with member count and manager status for the current user.

```typescript
// Returns
{
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  isManager: boolean;  // Current user is a manager of this team
}[]
```

#### `getTeam`
Gets detailed information about a specific team including members.

```typescript
// Input
{ teamId: string }

// Returns
{
  id: string;
  name: string;
  description: string | null;
  members: { id: string; name: string; email: string }[];
  managers: { id: string; name: string; email: string }[];
} | undefined
```

#### `createTeam`
Creates a new team. The creating user is automatically added as a manager.

```typescript
// Input
{
  name: string;
  description?: string;
}

// Returns
{ id: string; name: string }
```

#### `updateTeam`
Updates team name or description.

```typescript
// Input
{
  id: string;
  name?: string;
  description?: string;
}
```

#### `deleteTeam`
Deletes a team and all associated grants (via database cascade).

```typescript
// Input
{ id: string }
```

### Team Membership Endpoints

> [!NOTE]
> **Authorization.** The membership and manager mutations (`addUserToTeam`,
> `removeUserFromTeam`, `addTeamManager`, `removeTeamManager`) and `updateTeam`
> are gated at the contract level on `auth.teams.read`, and the handler then
> calls `assertTeamManagementAccess`, which allows the request if the caller
> holds the global `auth.teams.manage` rule **or** is a manager of that specific
> team. This is what lets a **team manager** run their own team without global
> admin. `createTeam` and `deleteTeam` require the global `auth.teams.manage`
> rule (admin-only). Granting a team access to a resource (`writeRelation`,
> `setObjectPublic`) and create-capability (`setCreateGrant`) also require
> `auth.teams.manage`. When you add a new
> team-management endpoint, gate it on `auth.teams.read` and call
> `assertTeamManagementAccess` if per-team managers should be able to use it;
> gate it on `auth.teams.manage` for admin-only operations.

#### `addUserToTeam`
Adds a user to a team.

```typescript
// Input
{ teamId: string; userId: string }
```

#### `removeUserFromTeam`
Removes a user from a team.

```typescript
// Input
{ teamId: string; userId: string }
```

#### `addTeamManager`
Grants manager privileges to a team member.

```typescript
// Input
{ teamId: string; userId: string }
```

#### `removeTeamManager`
Revokes manager privileges from a team member.

```typescript
// Input
{ teamId: string; userId: string }
```

### Relation-tuple access API

The resource-access layer is the **generic relation-tuple API**. It replaced the
older per-concept procedures (`getResourceTeamAccess`, `setResourceTeamAccess`,
`removeResourceTeamAccess`, `getResourceAccessSettings`,
`setResourceAccessSettings`, `listTeamResourceGrants`, `grantResourceCreate` /
`revokeResourceCreate`, and the old `checkResourceAccess` /
`getAccessibleResourceIds` checks). Every procedure addresses an object as
`{objectType}:{objectId}`, where `objectType` is the qualified
`{pluginId}.{resource}` and `objectId` is the resource's own id (or `"*"` for a
type-level `creator` grant). These signatures are transcribed from
[`core/auth-common/src/rpc-contract.ts`](https://github.com/enyineer/checkstack/blob/main/core/auth-common/src/rpc-contract.ts);
that contract is the source of truth.

#### Admin UI procedures (`userType: "authenticated"`)

These power the "Who can change this" editor and the Teams page. Read at
`auth.teams.read`; writes at `auth.teams.manage`.

##### `listObjectRelations`
Team relations on an object plus its public flag (replaces
`getResourceTeamAccess` + `getResourceAccessSettings`).

```typescript
// Input
{ objectType: string; objectId: string }

// Returns
{
  teams: { teamId: string; teamName: string; relation: "viewer" | "editor" | "owner" }[];
  isPublic: boolean;
}
```

##### `writeRelation`
Set a team's access relation on an object, replacing any it already holds there
(replaces `setResourceTeamAccess`).

```typescript
// Input
{
  objectType: string;
  objectId: string;
  teamId: string;
  relation: "viewer" | "editor";  // read vs read+manage
}
```

##### `removeRelation`
Remove all of a team's access relations on an object (replaces
`removeResourceTeamAccess`).

```typescript
// Input
{ objectType: string; objectId: string; teamId: string }
```

##### `setObjectPublic`
Toggle the privacy marker (replaces `setResourceAccessSettings`). `isPublic:
true` opens the global RBAC path; `false` closes it (team grants only).

```typescript
// Input
{ objectType: string; objectId: string; isPublic: boolean }
```

##### `listSubjectRelations`
All concrete-object grants held by a team, for the per-team grant list on the
Teams page (replaces `listTeamResourceGrants`). `objectId` is opaque; resolve
display names via `resolveResourceNames`.

```typescript
// Input
{ teamId: string }

// Returns
{
  grants: { objectType: string; objectId: string; relation: "viewer" | "editor" | "owner" }[];
}
```

##### `setCreateGrant` / `listTeamCreateGrants`
Grant or revoke a team's `creator` capability for a resource type, and list the
types a team may create (replace `grantResourceCreate` / `revokeResourceCreate`
/ `listResourceCreateGrants`).

```typescript
// setCreateGrant input
{ objectType: string; teamId: string; allowed: boolean }

// listTeamCreateGrants
{ teamId: string } -> { resourceTypes: string[] }
```

##### `canCreate` / `listMyAccessibleResources`
Frontend-facing capability queries for the CURRENT caller, so the UI can show
exactly the create and per-resource actions the backend would authorise. Both
resolve ONLY the team-derived (ReBAC) grants (`hasGlobalAccess: false`); the
frontend ORs the global RBAC rule on top via `useAccess`. They are the
authenticated mirrors of the S2S `authorizeCreate` / `listAccessibleObjectIds`.

```typescript
// canCreate: may the caller create this type via a team grant?
// True when a team of theirs holds a `creator` grant on `objectType`, OR
// (when parentType is given) manages at least one object of `parentType`.
{ objectType: string; parentType?: string } -> { allowed: boolean }

// listMyAccessibleResources: which of these ids may the caller act on?
{ objectType: string; resourceIds: string[]; action: "read" | "manage" }
  -> { accessibleIds: string[] }
```

Prefer the frontend hooks (`useCanCreate` / `useResourceAccess`, see
[Frontend access gating](/checkstack/developer-guide/frontend/access-gating/))
over calling these procedures directly.

#### S2S procedures (`userType: "service"`)

Called by `autoAuthMiddleware` (and create handlers) to enforce access. They
take the caller's role-based verdict as `hasGlobalAccess` / `hasGlobalManage`
and resolve it against the object's tuples.

##### `check`
Decide access to a single object.

```typescript
// Input
{
  userId: string;
  userType: "user" | "application";
  objectType: string;
  objectId: string;
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}

// Returns
{ hasAccess: boolean }
```

##### `listAccessibleObjectIds`
Filter candidate ids of a type to those the caller may access (one query, not an
N-way fanout).

```typescript
// Input
{
  userId: string;
  userType: "user" | "application";
  objectType: string;
  objectIds: string[];
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}

// Returns
string[]  // the accessible subset of objectIds
```

##### `hasAnyTypeGrant`
Does the caller hold ANY grant of the required level on a concrete object of
this type? Lets a list/record post-filter return a meaningful `403` to a
categorically-unauthorized caller instead of a silently-empty `200`.

```typescript
// Input
{
  userId: string;
  userType: "user" | "application";
  objectType: string;
  action: "read" | "manage";
}

// Returns
{ hasGrant: boolean }
```

##### `authorizeCreate`
Decide whether a caller may create an object of `objectType`, and which team
owns it. Resolves the create matrix (global manage, a team `creator` grant, or
an already-authorized parent create) and returns the owning team plus the new
object's default privacy. Yields `400 OWNER_TEAM_REQUIRED` when a member has
more than one eligible team, or `403` when unauthorized.

```typescript
// Input
{
  userId: string;
  userType: "user" | "application";
  objectType: string;
  requestedTeamId?: string;
  hasGlobalManage: boolean;
  alreadyAuthorized?: boolean;  // skip the per-type creator check (parent-authorized)
}

// Returns
{ ownerTeamId: string | null; isPrivate: boolean }
```

##### `setOwner`
Record ownership of a freshly-created object: the team gets `owner`, and
(unless `isPrivate`) the object stays globally readable.

```typescript
// Input
{ objectType: string; objectId: string; teamId: string; isPrivate?: boolean }
```

##### `deleteObjectRelations`
Drop every tuple for a deleted object. Call this from your delete handler so
grants do not outlive the resource.

```typescript
// Input
{ objectType: string; objectId: string }
```

## Resource-Level Access Control

### How It Works

The RLAC system uses metadata on RPC procedures to declare access requirements:

```typescript
// In contract definition (e.g., catalog-common/src/rpc-contract.ts)
import { createResourceAccess, createResourceAccessList } from "@checkstack/common";

// Resource types are auto-prefixed with pluginId by the middleware
// Just use the resource name, not the fully qualified type
const systemAccess = createResourceAccess("system", "systemId");
const systemListAccess = createResourceAccessList("system", "systems");

export const catalogContract = {
  // Single resource with access check
  getSystem: _base
    .meta({
      userType: "user",
      access: [access.read.id],
      resourceAccess: [systemAccess],  // Array of resource access configs
    })
    .input(z.object({ systemId: z.string() }))
    .output(SystemSchema.optional()),

  // List with automatic filtering
  getSystems: _base
    .meta({
      userType: "user",
      access: [access.read.id],
      resourceAccess: [systemListAccess],
    })
    .output(z.object({ systems: z.array(SystemSchema) })),
};
```

### Access Check Modes

| Mode | Property | Description | Implementation |
|------|----------|-------------|----------------|
| `single` | `idParam` | Pre-handler check for individual resource | Validates access before handler runs, throws 403 if denied |
| `list` | `listKey` | Post-handler filter for collections | Filters response array to only accessible resources |
| `record` | `recordKey` | Post-handler filter for bulk records | Filters Record<resourceId, data> to only accessible keys |
| `create` | `create` | Pre-handler authorize + post-handler ownership write | Lets a team member with a create-capability grant create a resource owned by their team; writes the owning-team grant for the created id |
| `parent` | `parentScope` | Scope by access to a PARENT resource type (cross-plugin, single-hop) | Pre-check (idParam) or record-filter (recordKey) against the parent type's grants - "see X for system S iff you can see S" |
| `bulkManage` | `bulkManage` | Pre-handler partition of an id ARRAY for a bulk WRITE (mass delete / mass resolve) | Splits `input[idsParam]` into the caller's authorized subset and the denied remainder, exposed on `context.bulkAccess`; the handler mutates only authorized ids |
| `global` | `global` | Explicit opt-out of team scoping | Enforced purely at the global-rule level; no per-resource check |

> **Note:** `instanceAccess` for a procedure is a single config object naming EXACTLY ONE mode. Set the field that matches how the endpoint identifies its resource(s).

> [!IMPORTANT]
> **Access rules carry NO instance config; scoping is per-procedure.** `access()`
> / `accessPair()` define only the rule (id, level, defaults). Every procedure
> declares its own `instanceAccess`. The boot validator **rejects** any procedure
> gated on a team-scopable resource type that declares no `instanceAccess` - you
> must pick a scoping mode or assert `instanceAccess: { global: true }`. This
> turns the old "forgot to scope it" fail-open into a boot error.

#### Parent scoping (`parentScope`) - "for-system" reads

When an endpoint reads or acts on data *belonging to* another resource (an
incident/maintenance/SLO/health-status "for a system"), scope it by access to
that PARENT rather than by grants on its own type. The endpoint's own `access`
rule remains the feature-level global gate; `parentScope` adds the per-resource
decision against the parent (consulting the parent's global rule AND the caller's
team grants on the parent).

```ts
// Single parent id in the input → pre-check (403 if the caller can't see it):
getIncidentsForSystem: proc({
  userType: "public",
  access: [incidentAccess.incident.read],
  instanceAccess: {
    parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" },
  },
}).input(z.object({ systemId: z.string() })) /* ... */,

// Output keyed by parent id → post-filter the record's keys:
getBulkIncidentsForSystems: proc({
  userType: "public",
  access: [incidentAccess.incident.read],
  instanceAccess: {
    parentScope: { resourceType: "catalog.system", action: "read", recordKey: "incidents" },
  },
}) /* output: { incidents: Record<systemId, Incident[]> } */,
```

`action` defaults to `"read"`; use `"manage"` for mutations that require managing
the parent (e.g. associating a health check to a system). Set EXACTLY ONE of
`idParam` (pre-check) or `recordKey` (post-filter). This is a single-hop, fixed
delegation - there is no recursive resource hierarchy (yet).

#### Bulk WRITE authorization (`bulkManage`) - mass delete / mass resolve

A bulk WRITE that acts on an ARRAY of ids (mass delete, mass resolve/complete)
cannot use the other modes: `idParam` is a single pre-check that THROWS on the
first unauthorized id (no partial success); `listKey` / `recordKey` are
post-filters that run AFTER the handler already mutated everything (fail-open for
a write); `global: true` would exclude team-scoped users. `bulkManage` is the
correct mode: BEFORE the handler runs, the middleware resolves `input[idsParam]`,
splits it into the caller's manageable subset (global rule OR per-id team grant)
and the denied remainder, and exposes both on `context.bulkAccess[idsParam]` as
`{ authorizedIds, deniedIds }`. It fails CLOSED - an S2S error yields an empty
authorized subset - and a team-scoped caller is never rejected up front; they
simply receive only their granted ids.

```ts
// contract
bulkDeleteIncidents: proc({
  operationType: "mutation",
  userType: "authenticated",
  access: [incidentAccess.incident.manage],
  instanceAccess: { bulkManage: { idsParam: "ids" } },
})
  .route({ method: "POST" })
  .input(z.object({ ids: z.array(z.string()).min(1) }))
  .output(z.object({ results: z.array(BulkIncidentActionResultSchema) })),

// handler: act ONLY on authorizedIds, report deniedIds as forbidden
bulkDeleteIncidents: os.bulkDeleteIncidents.handler(async ({ input, context }) => {
  const { authorizedIds, deniedIds } = context.bulkAccess?.ids ?? {
    authorizedIds: [],
    deniedIds: input.ids, // no partition => fail closed
  };
  const results = [];
  for (const id of authorizedIds) results.push({ id, status: await deleteOne(id) });
  for (const id of deniedIds) results.push({ id, status: "forbidden" });
  return { results };
}),
```

The handler MUST wrap each id in try/catch so one failure never aborts the batch,
and MUST run the per-id post-mutation sequence (cache invalidate, signal,
notification) for every success so dashboards and the status page stay
consistent. Return a per-id result so the frontend can report partial success
(e.g. "3 deleted, 1 skipped").

#### Keying: the id must match the grant's `resourceId`

A grant row is `(resourceType, resourceId, teamId, ...)` where `resourceType` is the qualified
`{pluginId}.{resource}` and `resourceId` is the value the frontend `TeamAccessEditor` writes (the
resource's own id). Your `idParam` (single), each list item's `.id` (list), and each record key
(record) MUST resolve to that same id, or scoping silently never matches. A common mistake (fixed
across the core plugins) is keying a mutation on `systemId` when grants are stored per-object-id:
give such mutations a per-proc `instanceAccess: { idParam: "id" }` override.

#### Bulk Record Endpoints (recordKey)

For endpoints that return data keyed by resource IDs (e.g., `getBulkSystemHealthStatus`), use `recordKey` to filter the output record:

```typescript
// Access rule with recordKey
const bulkStatusAccess = access("healthcheck.status", "read", "View status", {
  recordKey: "statuses",  // Key in response containing Record<systemId, data>
  isPublic: true,
});

// Contract definition
getBulkSystemHealthStatus: _base
  .meta({
    userType: "public",
    access: [bulkStatusAccess],
  })
  .input(z.object({ systemIds: z.array(z.string()) }))
  .output(z.object({
    statuses: z.record(z.string(), HealthStatusSchema),
  })),
```

The middleware automatically filters the `statuses` record, removing keys the user doesn't have access to.

#### Create endpoints and team ownership (create mode)

Creation is special: there is no existing resource id to check, and a team member who lacks the global
`manage` rule should still be able to create a resource **owned by their team**. Declare create mode on
the create procedure:

```typescript
createConfiguration: proc({
  operationType: "mutation",
  userType: "authenticated",
  access: [healthCheckAccess.configuration.manage],
  // teamIdParam: optional input field naming the requested owning team (default "teamId")
  // idField: response field carrying the created resource id (default "id")
  instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
})
  .input(CreateHealthCheckConfigurationSchema.extend({ teamId: z.string().optional() }))
  .output(HealthCheckConfigurationSchema),
```

The middleware then, for each create call:

1. **Authorizes** the create via `auth.authorizeCreate`:
   - a caller with global `manage` may create globally (no owner) or, by passing `teamId`, on behalf
     of any team;
   - a caller **without** global manage may create only if one of their teams holds a **create-capability
     grant** for this resource type (see below). The owning team is resolved automatically when there is
     exactly one eligible team, or must be chosen via `requestedTeamId` (otherwise a `400
     OWNER_TEAM_REQUIRED` is returned); no eligible team yields `403`. The call returns
     `{ ownerTeamId, isPrivate }`.
2. **Writes ownership** after the handler succeeds: the resolved team gets the `owner` relation for the
   created id via `auth.setOwner`, and (unless `isPrivate`) the object stays globally readable. The new
   resource is **team-managed but globally readable by default** - the owning team can change it, while
   anyone with the global read rule (e.g. anonymous on a public status page) can still see it. Privacy is
   an explicit opt-in (write the private marker via `setObjectPublic({ isPublic: false })`) set later via
   the "Who can change this" editor.

The create handler needs no ownership code - just accept (and ignore) the optional `teamId` so it is
not persisted to the resource row. The owner write re-throws on failure, so a create never silently
yields an unowned resource.

##### Create-capability grants

Membership alone does **not** grant the authority to create - that is deliberate, so teams used purely
for grouping never gain create rights. An admin grants a team create-capability for a resource type via
`auth.setCreateGrant({ objectType, teamId, allowed: true })` (and lists a team's grants with
`listTeamCreateGrants`), or from the **Resource creation** section of the team management dialog.
Absent a grant, creation stays admin/global-only. The platform enumerates the create-capable resource
types via `auth.getResourceKinds` (derived from the contracts). Only **parent-less** creates are
enumerated: a create with a `parent` gate (below) is authorized via manage on the parent, so offering a
per-type toggle for it would be redundant and is deliberately excluded.

##### Parent-gated creation (e.g. "for a system")

A resource that belongs to a parent (an incident or maintenance is "for" one or more systems) can be
gated on **manage access to that parent** instead of a per-type create-capability grant. Declare a
`parent` on the create config:

```typescript
createIncident: proc({
  operationType: "mutation",
  userType: "authenticated",
  access: [incidentAccess.incident.manage],
  instanceAccess: {
    create: {
      teamIdParam: "teamId",
      idField: "id",
      // Anyone who can MANAGE the referenced system(s) may create one for them.
      parent: { resourceType: "catalog.system", idParam: "systemIds" },
    },
  },
})
  .input(CreateIncidentInputSchema) // includes systemIds + optional teamId
  .output(IncidentWithSystemsSchema),
```

When `parent` is set, the middleware authorizes the create if the caller can manage **all** referenced
parent ids (`idParam` may resolve to a single id or an array), independent of any create-capability
grant. This implements "only those who manage system X may create incidents/maintenances for X", while
the result stays globally readable.

Because a parent-gated create needs no per-type grant, its type does **not** appear in the **Resource
creation** toggles (`getResourceKinds` marks it non-create-capable). Grant creation for these types by
giving the team **manage** access to the parent (e.g. the system), not a create toggle. A type that has
BOTH a parent-gated and a parent-less create procedure is still enumerated (the parent-less path needs
the grant).

### Meaningful authorization errors (not silent empties)

List and record endpoints post-filter their output. The middleware distinguishes a caller who is
**categorically unauthorized** (no global access rule AND no team grant of the required level for the
resource type) from one who is **legitimately scoped to an empty set**:

- categorically unauthorized authenticated caller → **`403 FORBIDDEN`** with a structured body
  `{ reason: "resource_scope_denied", resourceType, requiredAccess, missingGlobalRule, hint }`;
- legitimately scoped caller → **`200`** with the accessible subset (possibly empty);
- anonymous callers on `userType: "public"` endpoints are **never** `403`'d (status pages keep
  rendering an empty list).

This means an API key or service account whose scope lacks the resource's read rule receives an
actionable `403` naming the missing rule, instead of a silently-empty `200`.

### Relations

| Relation | Grants | Notes |
|----------|--------|-------|
| `viewer` | read | |
| `editor` | read + manage | implies `viewer` |
| `owner` | read + manage | implies `editor`; at most one owning team per object |
| `creator` | create resources of a type | lives on the type-level object `{type}:*` |
| `private` marker (`public:*`) | closes the global RBAC path | its presence = private; its absence (the default) = globally readable |

### Access Resolution Logic

`check`/`listAccessibleObjectIds` resolve access over the relation tuples of an
object (the decision is the pure `evaluateAccess` in
`auth-backend/src/relation-tuple-store.ts`):

1. Gather the object's tuples. Take the **team grants** (subject = team, relation
   ∈ viewer/editor/owner) and whether the **private marker** is present.
2. **Private marker present** → the global path is closed: allow iff the caller
   is in a team holding a relation that satisfies the action (no team grants
   denies everyone, the fail-closed invariant).
3. **Not private, no team grants** → default-open: return the caller's global
   RBAC verdict (`hasGlobalAccess`). (Most objects have no tuples and behave as
   before.)
4. **Not private, team grants present, `hasGlobalAccess`** → allow (the global
   path is open).
5. Otherwise **team grants only**: allow iff the caller is in a team holding a
   relation that satisfies the action (read → viewer|editor|owner; manage →
   editor|owner).

```typescript
// Pseudocode (see evaluateAccess for the real, tested implementation)
function check(userTeamIds, tuples, action, hasGlobalAccess) {
  const teamGrants = tuples.filter(t => t.subjectType === "team" &&
    ["viewer", "editor", "owner"].includes(t.relation));
  const isPrivate = tuples.some(t => t.subjectType === "public" && t.relation === "private");
  const need = action === "manage" ? ["editor", "owner"] : ["viewer", "editor", "owner"];
  const hasTeamGrant = () =>
    teamGrants.some(t => userTeamIds.includes(t.subjectId) && need.includes(t.relation));

  if (isPrivate) return hasTeamGrant();          // global path closed: team grants only
  if (teamGrants.length === 0) return hasGlobalAccess; // default-open
  if (hasGlobalAccess) return true;              // global path open
  return hasTeamGrant();
}
```

> [!WARNING]
> **`teamOnly` is enforced per `(resourceType, resourceId)`, on its OWN
> endpoints only.** `teamOnly` privacy applies wherever the middleware checks a
> resource against *its own* grants - i.e. an `instanceAccess` keyed to that
> resource type (`idParam`/`listKey`/`recordKey` resolving to the resource's own
> id). It does **not** propagate to endpoints that gate a resource through a
> *different* parent type.
>
> Concretely: a system's sub-resources (health-check history, contacts, links)
> are read-gated on `catalog.system` (`idParam: "systemId"`), so they inherit
> the *system's* `teamOnly`, not their own. Marking the sub-resource's own type
> `teamOnly` has no effect on those parent-scoped reads. To make a sub-resource
> private, either (a) mark its **parent system** `teamOnly` (the parent-scoped
> read then locks down), or (b) give the sub-resource an `instanceAccess` keyed
> to its own type so the middleware consults its own `teamOnly`. This is a
> deliberate consequence of "read access flows through whichever resource the
> endpoint identifies" - there is no global join from a child back to every
> ancestor's privacy flag.

## Integration Guide

### Enabling RLAC for a Plugin

#### Step 1: Add Resource Access Metadata to Contracts

```typescript
// plugins/myplugin-common/src/rpc-contract.ts
import { createResourceAccess, createResourceAccessList } from "@checkstack/common";

// Use simple resource names - the middleware auto-prefixes with "myplugin."
const itemAccess = createResourceAccess("item", "id");
const itemListAccess = createResourceAccessList("item", "items");

export const myPluginContract = {
  getItem: _base
    .meta({
      userType: "user",
      access: [access.itemRead.id],
      resourceAccess: [itemAccess],  // Must be an array
    })
    .input(z.object({ id: z.string() }))
    .output(ItemSchema),

  listItems: _base
    .meta({
      userType: "user",
      access: [access.itemRead.id],
      resourceAccess: [itemListAccess],
    })
    .output(z.object({ items: z.array(ItemSchema) })),
};
```

#### Step 2: Update List Endpoint Response Format

List endpoints must return an object with the array under a named key:

```typescript
// ❌ Before (array directly)
return items;

// ✅ After (object with named key)
return { items };
```

This is required for the middleware to identify and filter the correct array.

#### Step 3: Add TeamAccessEditor to Frontend

```typescript
// In your editor component
import { TeamAccessEditor } from "@checkstack/auth-frontend";

export const ItemEditor = ({ item }) => {
  return (
    <Dialog>
      {/* ... form fields ... */}
      
      {/* Only show for existing items */}
      {/* Note: Frontend uses fully qualified type since there's no middleware context */}
      {item?.id && (
        <TeamAccessEditor
          resourceType="myplugin.item"
          resourceId={item.id}
          compact
          expanded
        />
      )}
    </Dialog>
  );
};
```

### Frontend Dependencies

Add `@checkstack/auth-frontend` to your frontend package:

```json
{
  "dependencies": {
    "@checkstack/auth-frontend": "workspace:*"
  }
}
```

#### Step 4: Register a resource resolver (for the Teams page)

Team grants are stored as opaque `(resourceType, resourceId)` rows. So the Teams
admin page can show a team's grants **by name** and offer a search picker to add
one, register a `ResourceResolver` for each of your team-scopable types at init.
The auth backend reads it via the shared `ResourceResolverRegistry` (a core
service) - no reverse dependency on your plugin.

```ts
import { coreServices } from "@checkstack/backend-api";
import { inArray, ilike } from "drizzle-orm";

env.registerInit({
  schema,
  deps: {
    // ...your existing deps...
    resourceResolverRegistry: coreServices.resourceResolverRegistry,
  },
  init: async ({ database, resourceResolverRegistry /* ... */ }) => {
    const db = database as SafeDatabase<typeof schema>;
    resourceResolverRegistry.register("myplugin.item", {
      // Resolve grant ids -> display names (unknown ids may be omitted).
      resolveNames: async (ids) => {
        if (ids.length === 0) return new Map();
        const rows = await db
          .select({ id: schema.items.id, name: schema.items.name })
          .from(schema.items)
          .where(inArray(schema.items.id, ids));
        return new Map(rows.map((r) => [r.id, r.name]));
      },
      // Power the "grant a team access to a resource" picker.
      search: async (query, limit) =>
        db
          .select({ id: schema.items.id, name: schema.items.name })
          .from(schema.items)
          .where(ilike(schema.items.name, `%${query}%`))
          .limit(limit),
    });
  },
});
```

> [!NOTE]
> The registry is an in-process singleton; checkstack is a modular monolith, so
> every pod loads all plugins and builds an identical registry - a lookup is
> deterministic on every pod. Use the **exact** `resourceType` string that the
> frontend `TeamAccessEditor` writes (and that create-mode owner grants use), or
> grants won't resolve. Resolver errors degrade to "show the raw id", never a 5xx.

## Access Rules

The teams system defines these access rules:

| Access Rule ID | Description | Default |
|---------------|-------------|---------|
| `auth.teams.read` | View teams and membership | ✓ |
| `auth.teams.manage` | Create, update, delete teams and manage membership | |

## Best Practices

### Naming Resource Types

In **backend contracts**, use simple resource names without the plugin prefix - the middleware auto-qualifies them:

```typescript
// ✅ Backend: Use simple name (auto-prefixed to "catalog.system")
const systemAccess = createResourceAccess("system", "systemId");
```

In **frontend components**, use the fully qualified type since there's no middleware context:

```typescript
// ✅ Frontend: Use fully qualified type
<TeamAccessEditor resourceType="catalog.system" resourceId={id} />
```

**Stored values** in the database are always fully qualified. The qualified type
is derived from the access rule's `resource`
(`qualifyResourceType(pluginId, rule.resource)`), NOT from a separate resource
name, so it always matches the key the RPC middleware checks:
- `catalog.system`
- `healthcheck.healthcheck` (the health-check configuration rule is
  `accessPair("healthcheck", ...)`, so its grants key on `healthcheck.healthcheck`,
  exposed as `healthCheckResourceTypes.configuration`)
- `incident.incident`
- `maintenance.maintenance`

### Cascade Deletion

When a team is deleted, all of its `relation_tuple` rows are cleared explicitly in the delete handler (the tuple table has no FK because `subject_id` is polymorphic), removing both its resource grants and its create-capability tuples.

### Testing Access Control

When testing RLAC in your plugin:

```typescript
// Create test user with team membership
const user = {
  type: "user",
  id: "test-user",
  access: [access.itemRead],
  roles: ["users"],
  teamIds: ["team-1"],
};

// Mock the auth service for access checks (relation-tuple API)
const mockAuth = {
  check: mock(() => Promise.resolve({ hasAccess: true })),
  listAccessibleObjectIds: mock(() =>
    Promise.resolve(["item-1", "item-2"]),
  ),
};
```

## Troubleshooting

### "Access denied" for resources without grants

Check that:
1. User has the required access rule for the endpoint
2. No other team has `teamOnly` set on the resource

### List endpoints not filtering

Verify:
1. Response format is `{ keyName: [...] }`, not an array directly
2. `resultKey` in `createResourceAccessList` matches the response key
3. Items in the array have an `id` field

### Team not appearing in grants

Ensure:
1. Team exists in the database
2. User has `auth.teams.manage` access to assign access
3. Resource type in frontend uses fully qualified name (e.g., `catalog.system`, not just `system`)
