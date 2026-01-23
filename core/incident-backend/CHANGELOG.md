# @checkstack/incident-backend

## 0.4.3

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/catalog-backend@0.2.13
  - @checkstack/command-backend@0.1.11
  - @checkstack/integration-backend@0.1.11

## 0.4.2

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/catalog-backend@0.2.12
  - @checkstack/command-backend@0.1.10
  - @checkstack/integration-backend@0.1.10

## 0.4.1

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-common@0.5.5
  - @checkstack/catalog-backend@0.2.11
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/incident-common@0.4.3
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5
  - @checkstack/signal-common@0.1.6

## 0.4.0

### Minor Changes

- c208a5b: ### @checkstack/incident-backend

  Added notifications for incident status changes via the "Add Update" functionality:

  - Notifications are now sent when an incident is reopened (status changed from resolved)
  - Notifications are now sent when an incident status changes to any new value
  - Notifications are now sent when an incident is resolved via addUpdate
  - Extracted `notifyAffectedSystems` into a reusable module with proper importance logic:
    - Resolved incidents always use "info" importance (good news)
    - Reopened/created/updated incidents derive importance from severity

  ### @checkstack/maintenance-backend

  Fixed missing notification in `closeMaintenance` handler - the "Close" button now sends a "completed" notification to subscribers.

### Patch Changes

- 9551fd7: Fix creator display in incident and maintenance status updates

  - Show the creator's profile name instead of UUID in status updates
  - For maintenances, now properly displays the creator name (was missing)
  - For incidents, replaces UUID with human-readable profile name
  - System-generated updates (automatic maintenance transitions) show no creator

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/incident-common@0.4.2
  - @checkstack/catalog-backend@0.2.10

## 0.3.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-backend@0.2.9
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/incident-common@0.4.1
  - @checkstack/integration-backend@0.1.8
  - @checkstack/integration-common@0.2.4
  - @checkstack/signal-common@0.1.5

## 0.3.0

### Minor Changes

- cce5453: Add notification suppression for incidents

  - Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
  - When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
  - Mirrors the existing maintenance notification suppression pattern
  - Added toggle UI in the IncidentEditor dialog
  - Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries

### Patch Changes

- Updated dependencies [cce5453]
  - @checkstack/incident-common@0.4.0

## 0.2.8

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-backend@0.2.8
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/incident-common@0.3.4
  - @checkstack/integration-backend@0.1.7
  - @checkstack/integration-common@0.2.3
  - @checkstack/signal-common@0.1.4

## 0.2.7

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/catalog-backend@0.2.7
  - @checkstack/integration-backend@0.1.6
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.2.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/incident-common@0.3.3
  - @checkstack/catalog-backend@0.2.6
  - @checkstack/command-backend@0.1.5
  - @checkstack/integration-backend@0.1.5
  - @checkstack/integration-common@0.2.2
  - @checkstack/signal-common@0.1.3

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/catalog-backend@0.2.5
  - @checkstack/command-backend@0.1.4
  - @checkstack/integration-backend@0.1.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/incident-common@0.3.2
  - @checkstack/integration-common@0.2.1
  - @checkstack/signal-common@0.1.2

## 0.2.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/catalog-backend@0.2.4
  - @checkstack/command-backend@0.1.3
  - @checkstack/integration-backend@0.1.3

## 0.2.3

### Patch Changes

- @checkstack/catalog-common@1.2.1
- @checkstack/incident-common@0.3.1
- @checkstack/catalog-backend@0.2.3

## 0.2.2

### Patch Changes

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

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/incident-common@0.3.0
  - @checkstack/integration-common@0.2.0
  - @checkstack/integration-backend@0.1.2
  - @checkstack/catalog-backend@0.2.2
  - @checkstack/command-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/integration-backend@0.1.1
- @checkstack/catalog-backend@0.2.1
- @checkstack/command-backend@0.1.1

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
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/catalog-backend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/incident-common@0.2.0
  - @checkstack/integration-backend@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0

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

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/integration-backend@0.0.4
  - @checkstack/integration-common@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/catalog-backend@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/integration-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/integration-common@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.0.4

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/incident-common@0.1.2
  - @checkstack/integration-common@0.1.1
  - @checkstack/signal-common@0.1.1

## 0.0.3

### Patch Changes

- @checkstack/catalog-common@0.1.1
- @checkstack/incident-common@0.1.1
- @checkstack/catalog-backend@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/integration-backend@0.0.2
