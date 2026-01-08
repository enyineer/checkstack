# @checkmate-monitor/backend

## 0.1.1

### Patch Changes

- f0bdec2: Fixed CI test failures by implementing proper module mocking infrastructure:
  - Added test-preload.ts with comprehensive mocks for db, logger, and core-services
  - Added skipDiscovery option to loadPlugins() for test isolation
  - Configured bunfig.toml preload for workspace-wide test setup

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

- 71275dd: fix: Anonymous and non-admin user authorization

  - Fixed permission metadata preservation in `plugin-manager.ts` - changed from outdated `isDefault` field to `isAuthenticatedDefault` and `isPublicDefault`
  - Added `pluginId` to `RpcContext` to enable proper permission ID matching
  - Updated `autoAuthMiddleware` to prefix contract permission IDs with the pluginId from context, ensuring that contract permissions (e.g., `catalog.read`) correctly match database permissions (e.g., `catalog-backend.catalog.read`)
  - Route now uses `/api/:pluginId/*` pattern with Hono path parameters for clean pluginId extraction

- b55fae6: Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

  ## New Packages

  - **@checkmate-monitor/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
  - **@checkmate-monitor/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
  - **@checkmate-monitor/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

  ## Changes

  - **@checkmate-monitor/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
  - **@checkmate-monitor/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

  ## Usage

  Backend plugins can emit signals:

  ```typescript
  import { coreServices } from "@checkmate-monitor/backend-api";
  import { NOTIFICATION_RECEIVED } from "@checkmate-monitor/notification-common";

  const signalService = context.signalService;
  await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
  ```

  Frontend components subscribe to signals:

  ```tsx
  import { useSignal } from "@checkmate-monitor/signal-frontend";
  import { NOTIFICATION_RECEIVED } from "@checkmate-monitor/notification-common";

  useSignal(NOTIFICATION_RECEIVED, (payload) => {
    // Handle realtime notification
  });
  ```

### Patch Changes

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkmate-monitor/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkmate-monitor/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkmate-monitor/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkmate-monitor/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkmate-monitor/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- 81f3f85: ## Breaking: Unified Versioned<T> Architecture

  Refactored the versioning system to use a unified `Versioned<T>` class instead of separate `VersionedSchema`, `VersionedData`, and `VersionedConfig` types.

  ### Breaking Changes

  - **`VersionedSchema<T>`** is replaced by `Versioned<T>` class
  - **`VersionedData<T>`** is replaced by `VersionedRecord<T>` interface
  - **`VersionedConfig<T>`** is replaced by `VersionedPluginRecord<T>` interface
  - **`ConfigMigration<F, T>`** is replaced by `Migration<F, T>` interface
  - **`MigrationChain<T>`** is removed (use `Migration<unknown, unknown>[]`)
  - **`migrateVersionedData()`** is removed (use `versioned.parse()`)
  - **`ConfigMigrationRunner`** is removed (migrations are internal to Versioned)

  ### Migration Guide

  Before:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: {
      version: 1,
      schema: mySchema,
      migrations: [],
    },
  };
  const data = await migrateVersionedData(stored, 1, migrations);
  ```

  After:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: new Versioned({
      version: 1,
      schema: mySchema,
      migrations: [],
    }),
  };
  const data = await strategy.config.parse(stored);
  ```

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/backend-api@1.0.0
  - @checkmate-monitor/auth-common@0.1.0
  - @checkmate-monitor/queue-api@1.0.0
  - @checkmate-monitor/signal-common@0.1.0
  - @checkmate-monitor/signal-backend@0.1.0
  - @checkmate-monitor/api-docs-common@0.0.2
