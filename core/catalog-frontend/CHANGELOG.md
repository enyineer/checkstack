# @checkstack/catalog-frontend

## 0.8.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

## 0.7.0

### Minor Changes

- bb1fea0: Redesign system detail page with hero banner, two-column layout, plugin metric tiles, and health check slide-over drawer.

  ### New Components

  - **MetricTile** (`@checkstack/ui`): Compact stat tile with icon, label, value, variant coloring
  - **Sheet** (`@checkstack/ui`): Slide-over drawer built on Radix Dialog primitives

  ### New Extension Slot

  - **SystemOverviewMetricsSlot** (`@checkstack/catalog-common`): Plugin-contributed at-a-glance metric tiles in the system detail hero banner

  ### Layout Changes

  - System detail page now uses a hero banner with breadcrumb, status badges, and metric tile strip
  - Two-column layout: monitoring content (left) and system context (right)
  - Health checks rendered as compact card rows instead of heavy accordions
  - Clicking a health check opens a slide-over drawer with summary tiles, timeline charts, and recent runs
  - Right column uses lightweight borderless sections with dividers instead of heavy Card wrappers

  ### Plugin Extensions

  - Health check, SLO, Incident, and Maintenance plugins each contribute a metric tile to the hero banner

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0
  - @checkstack/auth-frontend@0.5.26
  - @checkstack/gitops-frontend@0.3.1

## 0.6.2

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-frontend@0.3.0

## 0.6.1

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-frontend@0.2.1

## 0.6.0

### Minor Changes

- 6c40b5b: Generalized provenance system and GitOps frontend plugin

  **Breaking**: `EntityKindDefinition.reconcile()` now returns `{ entityId: string }` instead of `void`. Plugins must return the plugin-specific entity ID (e.g., catalog system UUID) so the engine can store it in provenance.

  - Added `entityId` column to the provenance table (non-nullable)
  - Reconciler engine passes `existingEntityId` to plugins for updates
  - `getProvenance` now supports lookup by `entityId` in addition to `entityName`
  - Added provider CRUD endpoints: `createProvider`, `updateProvider`, `deleteProvider`
  - Created `gitops-frontend` plugin with provider management, secret management, and sync status dashboard
  - Removed `gitops_entity_name` metadata markers from catalog entities
  - Removed `findSystemByGitOpsName`, `deleteSystemByGitOpsName` (and Group equivalents) from EntityService
  - Added provenance-based UI locking in catalog-frontend: edit/delete/drag disabled for GitOps-managed systems and groups

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [4b0934d]
  - @checkstack/gitops-frontend@0.2.0
  - @checkstack/ui@1.3.6
  - @checkstack/auth-frontend@0.5.25

## 0.5.14

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24

## 0.5.13

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23

## 0.5.12

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22

## 0.5.11

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/auth-frontend@0.5.21

## 0.5.10

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20

## 0.5.9

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/auth-frontend@0.5.19

## 0.5.8

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

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/frontend-api@0.3.9
  - @checkstack/catalog-common@1.3.1
  - @checkstack/auth-common@0.6.1
  - @checkstack/notification-common@0.2.8

## 0.5.7

### Patch Changes

- 3f36a64: Add System Dependencies plugin

  Introduces the system dependencies feature with three new core plugins and
  extends the catalog with a new SystemEditorSlot extension point.

  **New plugins:**

  - **dependency-common**: Shared Zod schemas, RPC contract with resource-level access control, signal definitions, and routes
  - **dependency-backend**: Drizzle schema, DependencyService with cycle detection, WarningEvaluationService with transitive impact matrix, RPC router with signal broadcasting, and per-user canvas node position persistence
  - **dependency-frontend**: DependencyBadge (dashboard), DependencyAlert (system details), DependencyEditor (system editor dialog), and interactive DependencyMapPage (React Flow canvas)

  **Catalog extensions:**

  - **catalog-common**: New `SystemEditorSlot` for plugin-injected sections in the system editor dialog
  - **catalog-frontend**: `SystemEditor` renders the slot after TeamAccessEditor for existing systems

  **Key capabilities:**

  - Directional dependency edges between systems (source depends on target)
  - Three impact types: informational, degraded, critical
  - Transitive multi-hop warning propagation with toggle switch
  - Cycle detection at creation time with graphical chain visualization
  - Health check-level dependency rules
  - Interactive dependency map with drag-to-connect, edge click editor, and auto-saving node positions
  - Inline editing of dependencies in both the system editor and the map canvas
  - Team-based resource-level access control on all mutation endpoints
  - Realtime signal-driven UI updates

- Updated dependencies [3f36a64]
  - @checkstack/catalog-common@1.3.0

## 0.5.6

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17

## 0.5.5

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16

## 0.5.4

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15

## 0.5.3

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-common@0.6.0
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-common@1.2.11

## 0.5.2

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-common@0.5.7
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-common@1.2.10
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/notification-common@0.2.7
  - @checkstack/ui@1.1.3

## 0.5.1

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-common@1.2.9
  - @checkstack/ui@1.1.2

## 0.5.0

### Minor Changes

- 0ebbe56: Replace dropdown-based system-to-group assignment with drag-and-drop.

  - Systems panel now shows a grip handle on each row for drag-and-drop onto groups
  - Group panel cards highlight as valid drop zones when a system is dragged over them
  - Dragging a system onto a group it already belongs to is blocked with a visual indicator
  - Added a `+` popover button on each system row as a mobile-friendly alternative (no drag required on small screens)
  - Touch sensor activated with 250ms delay to avoid conflicts with scrolling
  - Removed the "Add System to Group" card with dropdowns
  - Systems not assigned to any group display an `unassigned` badge

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/auth-common@0.5.6
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/catalog-common@1.2.8
  - @checkstack/frontend-api@0.3.6
  - @checkstack/notification-common@0.2.6

## 0.4.2

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10

## 0.4.1

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/auth-common@0.5.5
  - @checkstack/catalog-common@1.2.7
  - @checkstack/frontend-api@0.3.5
  - @checkstack/notification-common@0.2.5

## 0.4.0

### Minor Changes

- e5079e1: Add contacts management to system editor

  - **catalog-frontend**: New `ContactsEditor` component allows adding/removing platform users and external mailboxes as system contacts directly from the system editor dialog
  - **catalog-common**: Added `instanceAccess` override to contacts RPC endpoints for correct single-resource RLAC checking
  - **ui**: Fixed Tabs component to use `type="button"` to prevent form submission when used inside forms

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/ui@0.5.3
  - @checkstack/auth-frontend@0.5.8

## 0.3.11

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-common@1.2.5
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/notification-common@0.2.4
  - @checkstack/ui@0.5.2

## 0.3.10

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1
  - @checkstack/auth-frontend@0.5.6

## 0.3.9

### Patch Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

- Updated dependencies [223081d]
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5

## 0.3.8

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/frontend-api@0.3.3
  - @checkstack/notification-common@0.2.3

## 0.3.7

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3

## 0.3.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/frontend-api@0.3.2
  - @checkstack/notification-common@0.2.2
  - @checkstack/ui@0.3.1

## 0.3.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/catalog-common@1.2.2
  - @checkstack/frontend-api@0.3.1
  - @checkstack/notification-common@0.2.1

## 0.3.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4

## 0.3.3

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1

## 0.3.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/ui@0.2.2

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
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/ui@0.2.1

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
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/ui@0.2.0

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

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/notification-common@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/frontend-api@0.0.3
  - @checkstack/notification-common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- b0124ef: Fix light mode contrast for semantic color tokens

  Updated the theme system to use a two-tier pattern for semantic colors:

  - Base tokens (`text-destructive`, `text-success`, etc.) are used for text on light backgrounds (`bg-{color}/10`)
  - Foreground tokens (`text-destructive-foreground`, etc.) are now white/contrasting and used for text on solid backgrounds

  This fixes poor contrast issues with components like the "Incident" badge which had dark red text on a bright red background in light mode.

  Components updated: Alert, InfoBanner, HealthBadge, Badge, PermissionDenied, SystemDetailPage

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/notification-common@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1

## 0.0.4

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/catalog-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
