# Teams and Resource-Level Access Control

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

The teams system uses five tables in the `auth-backend` schema:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│    team      │     │   userTeam   │     │  resourceTeamAccess  │
├──────────────┤     ├──────────────┤     ├──────────────────────┤
│ id (PK)      │────▶│ teamId (FK)  │     │ resourceType (PK)    │
│ name         │     │ userId (FK)  │     │ resourceId (PK)      │
│ description  │     └──────────────┘     │ teamId (PK, FK)      │
│ createdAt    │                          │ canRead              │
│ updatedAt    │     ┌──────────────┐     │ canManage            │
└──────────────┘     │ teamManager  │     └──────────────────────┘
                     ├──────────────┤
                     │ teamId (FK)  │     ┌─────────────────────────┐
                     │ userId (FK)  │     │ resourceAccessSettings  │
                     └──────────────┘     ├─────────────────────────┤
                                          │ resourceType (PK)       │
┌──────────────────┐                      │ resourceId (PK)         │
│ applicationTeam  │                      │ teamOnly                │
├──────────────────┤                      └─────────────────────────┘
│ applicationId    │
│ teamId (FK)      │
└──────────────────┘
```

**Note:** The `teamOnly` setting is stored at the resource level in `resourceAccessSettings`, not per-grant. This allows enabling "Team Only" mode for a resource without associating it with any specific team grant.

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

| Mode | Description | Implementation |
|------|-------------|----------------|
| `single` | Pre-handler check for individual resource | Validates access before handler runs, throws 403 if denied |
| `list` | Post-handler filter for collections | Filters response array to only accessible resources |

> **Note:** `resourceAccess` is an **array**, so you can specify multiple resource access configs if an endpoint needs to check access to multiple resource types.

### Access Levels

| Access | Description |
|------------|-------------|
| `canRead` | User can view the resource |
| `canManage` | User can modify the resource |
| `teamOnly` | Only team members can access (disables global access) |

### Access Resolution Logic

When checking access to a resource:

1. **Check for grants**: Look for `resourceTeamAccess` entries matching `(resourceType, resourceId)`
2. **If no grants exist**: Resource is unrestricted, allow access if user has the required access rule
3. **If grants exist**:
   - Check if user is in any team with access
   - If `teamOnly` is set on any grant, only team-based access is allowed
   - If `checkManage` is true, verify the grant includes `canManage`

```typescript
// Pseudocode for access resolution
function checkAccess(user, resourceType, resourceId, checkManage) {
  const grants = getGrants(resourceType, resourceId);
  
  if (grants.length === 0) {
    // No restrictions - allow anyone with access
    return true;
  }
  
  // Check team-based grants
  const userTeamGrants = grants.filter(g => user.teamIds.includes(g.teamId));
  
  for (const grant of userTeamGrants) {
    if (checkManage && !grant.canManage) continue;
    if (!checkManage && !grant.canRead) continue;
    return true;  // Access granted
  }
  
  return false;  // No matching grant found
}
```

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

When a team is deleted, all `resourceTeamAccess` grants are automatically deleted via database cascade (`ON DELETE CASCADE`).

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
