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
The entire **resource-access layer is a single relation-tuple store** —
`relation_tuple` — that replaced the older `resource_team_access` (read/manage),
`resource_access_settings` (teamOnly), and `resource_create_grant` tables.

```
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
- A **team** with `creator` on the type-level object `{objectType}:*` — the
  authority to create resources of that type.
- The special **`public:*`** subject with a `viewer` tuple is the **privacy
  marker**: present = "the global RBAC path is open for this object" (the old
  `teamOnly = false`); absent (when team grants exist) = private.

> [!NOTE]
> `relation_tuple` is the single source of truth for resource access. `is_owner`
> became the `owner` relation (one owner per object, partial-unique); read/manage
> became `viewer`/`editor`; teamOnly became the presence/absence of the public
> marker; create-capability became `creator` tuples. `subject_id` is polymorphic,
> so the table has no FK — team deletion clears the team's tuples explicitly.

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
{ id: string }

// Returns
{
  id: string;
  name: string;
  description: string | null;
  members: { userId: string; isManager: boolean }[];
  createdAt: Date;
  updatedAt: Date;
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
> rule (admin-only). Granting a team access to a resource
> (`setResourceTeamAccess`, `setResourceAccessSettings`) and create-capability
> (`grantResourceCreate`) also require `auth.teams.manage`. When you add a new
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

### Resource Access Endpoints

> [!IMPORTANT]
> These endpoints were replaced by the **generic relation-tuple API**. The
> per-concept procedures below map to: `getResourceTeamAccess` +
> `getResourceAccessSettings` → **`listObjectRelations`** (`{ teams: [{teamId,
> teamName, relation}], isPublic }`); `setResourceTeamAccess` → **`writeRelation`**
> (`{ objectType, objectId, teamId, relation: "viewer"|"editor" }`);
> `removeResourceTeamAccess` → **`removeRelation`**; `setResourceAccessSettings` →
> **`setObjectPublic`** (`{ isPublic }`); `listTeamResourceGrants` →
> **`listSubjectRelations`**; `grantResourceCreate`/`revokeResourceCreate` →
> **`setCreateGrant`** (`{ allowed }`). The S2S checks became `check` /
> `listAccessibleObjectIds` / `hasAnyTypeGrant` / `authorizeCreate` (returns
> `isPrivate`) / `setOwner` / `deleteObjectRelations`. See
> `core/auth-common/src/rpc-contract.ts` for the canonical signatures. The
> historical per-concept shapes below are kept for context.

#### `getResourceTeamAccess`
Lists teams with access to a specific resource.

```typescript
// Input
{ resourceType: string; resourceId: string }

// Returns
{
  teamId: string;
  teamName: string;
  canRead: boolean;
  canManage: boolean;
}[]
```

#### `setResourceTeamAccess`
Grants or updates team access to a resource (upsert).

```typescript
// Input
{
  resourceType: string;
  resourceId: string;
  teamId: string;
  canRead?: boolean;    // Default: true
  canManage?: boolean;  // Default: false
}
```

#### `removeResourceTeamAccess`
Revokes team access from a resource.

```typescript
// Input
{ resourceType: string; resourceId: string; teamId: string }
```

### Resource Settings Endpoints

#### `getResourceAccessSettings`
Gets resource-level access settings (e.g., teamOnly mode).

```typescript
// Input
{ resourceType: string; resourceId: string }

// Returns
{ teamOnly: boolean }
```

#### `setResourceAccessSettings`
Updates resource-level access settings.

```typescript
// Input
{
  resourceType: string;
  resourceId: string;
  teamOnly: boolean;  // If true, global access don't apply
}
```

### S2S (Service-to-Service) Endpoints

These endpoints are called by the `autoAuthMiddleware` for access control checks.

#### `checkResourceAccess`
Checks if a user has access to a specific resource.

```typescript
// Input
{
  resourceType: string;
  resourceId: string;
  userId: string;
  teamIds: string[];
  checkManage?: boolean;
}

// Returns
{ hasAccess: boolean }
```

#### `getAccessibleResourceIds`
Filters a list of resource IDs to those the user can access.

```typescript
// Input
{
  resourceType: string;
  resourceIds: string[];
  userId: string;
  teamIds: string[];
}

// Returns
{ accessibleIds: string[] }
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
| `parent` | `parentScope` | Scope by access to a PARENT resource type (cross-plugin, single-hop) | Pre-check (idParam) or record-filter (recordKey) against the parent type's grants — "see X for system S iff you can see S" |
| `global` | `global` | Explicit opt-out of team scoping | Enforced purely at the global-rule level; no per-resource check |

> **Note:** `instanceAccess` for a procedure is a single config object naming EXACTLY ONE mode. Set the field that matches how the endpoint identifies its resource(s).

> [!IMPORTANT]
> **Access rules carry NO instance config; scoping is per-procedure.** `access()`
> / `accessPair()` define only the rule (id, level, defaults). Every procedure
> declares its own `instanceAccess`. The boot validator **rejects** any procedure
> gated on a team-scopable resource type that declares no `instanceAccess` — you
> must pick a scoping mode or assert `instanceAccess: { global: true }`. This
> turns the old "forgot to scope it" fail-open into a boot error.

#### Parent scoping (`parentScope`) — "for-system" reads

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
delegation — there is no recursive resource hierarchy (yet).

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

1. **Authorizes** the create via `auth.authorizeResourceCreate`:
   - a caller with global `manage` may create globally (no owner) or, by passing `teamId`, on behalf
     of any team;
   - a caller **without** global manage may create only if one of their teams holds a **create-capability
     grant** for this resource type (see below). The owning team is resolved automatically when there is
     exactly one eligible team, or must be chosen via `teamId` (otherwise a `400 OWNER_TEAM_REQUIRED`
     with `eligibleTeamIds` is returned); no eligible team yields `403`.
2. **Writes ownership** after the handler succeeds: the resolved team gets the `owner` relation for the
   created id via `auth.setOwner`, plus (unless private) the `public` viewer marker. The new resource is
   **team-managed but globally readable by default** — the owning team can change it, while anyone with
   the global read rule (e.g. anonymous on a public status page) can still see it. Privacy is an explicit
   opt-in (remove the public marker via `setObjectPublic`) set later via the "Who can change this" editor.

The create handler needs no ownership code — just accept (and ignore) the optional `teamId` so it is
not persisted to the resource row. The owner write re-throws on failure, so a create never silently
yields an unowned resource.

##### Create-capability grants

Membership alone does **not** grant the authority to create — that is deliberate, so teams used purely
for grouping never gain create rights. An admin grants a team create-capability for a resource type via
`auth.grantResourceCreate({ resourceType, teamId })` (and `revokeResourceCreate` /
`listResourceCreateGrants`), or from the **Resource creation** section of the team management dialog.
Absent a grant, creation stays admin/global-only. The platform enumerates the create-capable resource
types via `auth.getResourceKinds` (derived from the contracts).

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
| `public` viewer marker | "global RBAC path open" | its absence (with team grants) = private |

### Access Resolution Logic

`check`/`listAccessibleObjectIds` resolve access over the relation tuples of an
object (the decision is the pure `evaluateAccess` in
`auth-backend/src/relation-tuple-store.ts`):

1. Gather the object's tuples. Take the **team grants** (subject = team, relation
   ∈ viewer/editor/owner).
2. **No team grants** → default-open: return the caller's global RBAC verdict
   (`hasGlobalAccess`). (Most objects have no tuples and behave as before.)
3. **Public marker present** (not private) **and** `hasGlobalAccess` → allow (the
   global path is open).
4. Otherwise **team grants only**: allow iff the caller is in a team holding a
   relation that satisfies the action (read → viewer|editor|owner; manage →
   editor|owner).

```typescript
// Pseudocode (see evaluateAccess for the real, tested implementation)
function check(userTeamIds, tuples, action, hasGlobalAccess) {
  const teamGrants = tuples.filter(t => t.subjectType === "team" &&
    ["viewer", "editor", "owner"].includes(t.relation));
  if (teamGrants.length === 0) return hasGlobalAccess; // default-open

  const publicOpen = tuples.some(t => t.subjectType === "public" && t.relation === "viewer");
  if (publicOpen && hasGlobalAccess) return true;

  const need = action === "manage" ? ["editor", "owner"] : ["viewer", "editor", "owner"];
  return teamGrants.some(t => userTeamIds.includes(t.subjectId) && need.includes(t.relation));
}
```

> [!WARNING]
> **`teamOnly` is enforced per `(resourceType, resourceId)`, on its OWN
> endpoints only.** `teamOnly` privacy applies wherever the middleware checks a
> resource against *its own* grants — i.e. an `instanceAccess` keyed to that
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
> endpoint identifies" — there is no global join from a child back to every
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
service) — no reverse dependency on your plugin.

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
> every pod loads all plugins and builds an identical registry — a lookup is
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

**Stored values** in the database are always fully qualified:
- `catalog.system`
- `healthcheck.configuration`
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

// Mock the auth service for access checks
const mockAuth = {
  checkResourceTeamAccess: mock(() => Promise.resolve({ hasAccess: true })),
  getAccessibleResourceIds: mock(() => 
    Promise.resolve({ accessibleIds: ["item-1", "item-2"] })
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
