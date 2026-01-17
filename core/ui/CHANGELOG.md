# @checkstack/ui

## 0.2.3

### Patch Changes

- f6464a2: Fix theme toggle showing incorrect state when system theme is used

  - Added `resolvedTheme` property to `ThemeProvider` that returns the actual computed theme ("light" or "dark"), resolving "system" to the user's OS preference
  - Updated `NavbarThemeToggle` and `ThemeToggleMenuItem` to use `resolvedTheme` instead of `theme` for determining toggle state
  - Changed default theme from "light" to "system" so non-logged-in users respect their OS color scheme preference

## 0.2.2

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0

## 0.2.1

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
  - @checkstack/frontend-api@0.2.0
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
  - @checkstack/frontend-api@0.1.0

## 0.1.0

### Minor Changes

- 8e43507: # Button component defaults to type="button"

  The `Button` component now defaults to `type="button"` instead of the HTML default `type="submit"`. This prevents accidental form submissions when buttons are placed inside forms but aren't intended to submit.

  ## Changes

  - Default `type` prop is now `"button"` instead of the HTML implicit `"submit"`
  - Form submission buttons must now explicitly set `type="submit"`

  ## Migration

  No migration needed if your submit buttons already have `type="submit"` explicitly set (recommended practice). If you have buttons that should submit forms but don't have an explicit type, add `type="submit"`:

  ```diff
  - <Button onClick={handleSubmit}>Submit</Button>
  + <Button type="submit">Submit</Button>
  ```

### Patch Changes

- 97c5a6b: Fixed DOM clobbering issue in DynamicForm by prefixing field IDs with 'field-'. Previously, schema fields with names matching native DOM properties (like 'nodeName', 'tagName', 'innerHTML') could shadow those properties, causing floating-ui and React to crash during DOM traversal.
- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4

## 0.0.4

### Patch Changes

- f5b1f49: Extended DynamicForm type definitions with additional JSON Schema metadata properties.
- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/frontend-api@0.0.3

## 0.0.3

### Patch Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2

## 0.1.2

### Patch Changes

- 52231ef: # Auth Settings Page Refactoring

  ## Auth Frontend

  Refactored the `AuthSettingsPage` into modular, self-contained tab components:

  - **New Components**: Created `UsersTab`, `RolesTab`, `StrategiesTab`, and `ApplicationsTab` components
  - **Dynamic Tab Visibility**: Tabs are now conditionally shown based on user permissions
  - **Auto-Select Logic**: Automatically selects the first available tab if the current tab becomes inaccessible
  - **Self-Contained State**: Each tab component manages its own state, handlers, and dialogs, reducing prop drilling

  ## UI Package

  - **Responsive Tabs**: Tabs now use column layout on small screens and row layout on medium+ screens

- b0124ef: Fix light mode contrast for semantic color tokens

  Updated the theme system to use a two-tier pattern for semantic colors:

  - Base tokens (`text-destructive`, `text-success`, etc.) are used for text on light backgrounds (`bg-{color}/10`)
  - Foreground tokens (`text-destructive-foreground`, etc.) are now white/contrasting and used for text on solid backgrounds

  This fixes poor contrast issues with components like the "Incident" badge which had dark red text on a bright red background in light mode.

  Components updated: Alert, InfoBanner, HealthBadge, Badge, PermissionDenied, SystemDetailPage

- 54cc787: ### Fix Access Denied Flash on Page Load

  Fixed the "Access Denied" screen briefly flashing when loading permission-protected pages.

  **Root cause:** The `usePermissions` hook was setting `loading: false` when the session was still pending, causing a brief moment where permissions appeared to be denied.

  **Changes:**

  - `usePermissions` hook now waits for session to finish loading (`isPending`) before determining permission state
  - `PageLayout` component now treats `loading=undefined` with `allowed=false` as a loading state
  - `AuthSettingsPage` now explicitly waits for permission hooks to finish loading before checking access

  **Result:** Pages show a loading spinner until permissions are fully resolved, eliminating the flash.

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3

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

- eff5b4e: Add standalone maintenance scheduling plugin

  - New `@checkstack/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
  - New `@checkstack/maintenance-backend` package with Drizzle schema, service, and oRPC router
  - New `@checkstack/maintenance-frontend` package with admin page and system detail panel
  - Shared `DateTimePicker` component added to `@checkstack/ui`
  - Database migrations for maintenances, maintenance_systems, and maintenance_updates tables
  - @checkstack/frontend-api@0.0.2
