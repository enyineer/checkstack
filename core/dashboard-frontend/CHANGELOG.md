# @checkstack/dashboard-frontend

## 0.3.10

### Patch Changes

- Updated dependencies [11d2679]
- Updated dependencies [cce5453]
- Updated dependencies [223081d]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/incident-common@0.4.0
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/catalog-frontend@0.3.9
  - @checkstack/queue-frontend@0.2.8
  - @checkstack/command-frontend@0.2.8

## 0.3.9

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/catalog-frontend@0.3.8
  - @checkstack/command-common@0.2.3
  - @checkstack/command-frontend@0.2.7
  - @checkstack/frontend-api@0.3.3
  - @checkstack/incident-common@0.3.4
  - @checkstack/maintenance-common@0.4.2
  - @checkstack/notification-common@0.2.3
  - @checkstack/queue-frontend@0.2.7
  - @checkstack/signal-frontend@0.0.10

## 0.3.8

### Patch Changes

- 1f1f6c2: Fixed layout issue where multiple system status badges would push the system name out of view on dashboard cards
- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3
  - @checkstack/catalog-frontend@0.3.7
  - @checkstack/command-frontend@0.2.6
  - @checkstack/queue-frontend@0.2.6

## 0.3.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/incident-common@0.3.3
  - @checkstack/maintenance-common@0.4.1
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/catalog-frontend@0.3.6
  - @checkstack/command-common@0.2.2
  - @checkstack/command-frontend@0.2.5
  - @checkstack/frontend-api@0.3.2
  - @checkstack/notification-common@0.2.2
  - @checkstack/queue-frontend@0.2.5
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.3.6

### Patch Changes

- Updated dependencies [18fa8e3]
  - @checkstack/maintenance-common@0.4.0

## 0.3.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/catalog-frontend@0.3.5
  - @checkstack/command-frontend@0.2.4
  - @checkstack/queue-frontend@0.2.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/command-common@0.2.1
  - @checkstack/frontend-api@0.3.1
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/incident-common@0.3.2
  - @checkstack/maintenance-common@0.3.2
  - @checkstack/notification-common@0.2.1
  - @checkstack/signal-frontend@0.0.8

## 0.3.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/catalog-frontend@0.3.4
  - @checkstack/command-frontend@0.2.3
  - @checkstack/queue-frontend@0.2.3

## 0.3.3

### Patch Changes

- cad3073: Fixed notification group subscription for catalog groups:
  - Fixed group ID format using colon separator instead of dots and missing entity type prefix
  - Fixed subscription button state not updating after subscribe/unsubscribe by using refetch instead of invalidateQueries

## 0.3.2

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/catalog-frontend@0.3.3
  - @checkstack/command-frontend@0.2.2
  - @checkstack/queue-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/catalog-frontend@0.3.2

## 0.3.0

### Minor Changes

- 4eed42d: Fix "No QueryClient set" error in containerized builds

  **Problem**: The containerized application was throwing "No QueryClient set, use QueryClientProvider to set one" errors during plugin registration. This didn't happen in dev mode.

  **Root Cause**: The `@tanstack/react-query` package was being bundled separately in different workspace packages, causing multiple React Query contexts. The `QueryClientProvider` from the main app wasn't visible to plugin code due to this module duplication.

  **Changes**:

  - `@checkstack/frontend-api`: Export `useQueryClient` from the centralized React Query import, ensuring all packages use the same context
  - `@checkstack/dashboard-frontend`: Import `useQueryClient` from `@checkstack/frontend-api` instead of directly from `@tanstack/react-query`, and remove the direct dependency
  - `@checkstack/frontend`: Add `@tanstack/react-query` to Vite's `resolve.dedupe` as a safety net

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/catalog-frontend@0.3.1
  - @checkstack/command-frontend@0.2.1
  - @checkstack/incident-common@0.3.1
  - @checkstack/maintenance-common@0.3.1
  - @checkstack/queue-frontend@0.2.1
  - @checkstack/ui@0.2.2

## 0.2.0

### Minor Changes

- 180be38: # Queue Lag Warning

  Added a queue lag warning system that displays alerts when pending jobs exceed configurable thresholds.

  ## Features

  - **Backend Stats API**: New `getStats`, `getLagStatus`, and `updateLagThresholds` RPC endpoints
  - **Signal-based Updates**: `QUEUE_LAG_CHANGED` signal for real-time frontend updates
  - **Aggregated Stats**: `QueueManager.getAggregatedStats()` sums stats across all queues
  - **Configurable Thresholds**: Warning (default 100) and Critical (default 500) thresholds stored in config
  - **Dashboard Integration**: Queue lag alert displayed on main Dashboard (access-gated)
  - **Queue Settings Page**: Lag alert and Performance Tuning guidance card with concurrency tips

  ## UI Changes

  - Queue lag alert banner appears on Dashboard and Queue Settings when pending jobs exceed thresholds
  - New "Performance Tuning" card with concurrency settings guidance and bottleneck indicators

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

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-frontend@0.2.0
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/command-frontend@0.2.0
  - @checkstack/command-common@0.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/incident-common@0.3.0
  - @checkstack/maintenance-common@0.3.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.1.1

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/catalog-frontend@0.2.0
  - @checkstack/command-common@0.1.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/incident-common@0.2.0
  - @checkstack/maintenance-common@0.2.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

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

- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/ui@0.1.0
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/command-frontend@0.0.5
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/command-common@0.0.4
  - @checkstack/frontend-api@0.0.4
  - @checkstack/notification-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-frontend@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/command-common@0.0.3
  - @checkstack/command-frontend@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/maintenance-common@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/maintenance-common@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.0

### Minor Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/command-common@0.0.3
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/incident-common@0.1.2
  - @checkstack/maintenance-common@0.1.2
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1
  - @checkstack/catalog-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/catalog-common@0.1.1
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3
  - @checkstack/incident-common@0.1.1
  - @checkstack/maintenance-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/frontend-api@0.0.2
