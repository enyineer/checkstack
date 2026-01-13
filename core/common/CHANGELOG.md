# @checkstack/common

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
