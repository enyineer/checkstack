# @checkstack/healthcheck-common

## 0.2.0

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

- 97c5a6b: Add UUID-based collector identification for better multiple collector support

  **Breaking Change**: Existing health check configurations with collectors need to be recreated.

  - Each collector instance now has a unique UUID assigned on creation
  - Collector results are stored under the UUID key with `_collectorId` and `_assertionFailed` metadata
  - Auto-charts correctly display separate charts for each collector instance
  - Charts are now grouped by collector instance with clear headings
  - Assertion status card shows pass/fail for each collector
  - Renamed "Success" to "HTTP Success" to clarify it's about HTTP request success
  - Fixed deletion of collectors not persisting to database
  - Fixed duplicate React key warnings in auto-chart grid

### Patch Changes

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0
  - @checkstack/signal-common@0.0.4

## 0.1.0

### Minor Changes

- f5b1f49: Extended health check system with per-collector assertion support.

  - Added `collectors` column to `healthCheckConfigurations` schema for storing collector configs
  - Updated queue-executor to run configured collectors and evaluate per-collector assertions
  - Added `CollectorAssertionSchema` to healthcheck-common for assertion validation
  - Results now stored with `metadata.collectors` containing per-collector result data

- f5b1f49: Added JSONPath assertions for response body validation and fully qualified strategy IDs.

  **JSONPath Assertions:**

  - Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
  - Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
  - Added `jsonPath` field to `CollectorAssertionSchema` for persistence
  - HTTP Request collector body field now supports JSONPath assertions

  **Fully Qualified Strategy IDs:**

  - HealthCheckRegistry now uses scoped factories like CollectorRegistry
  - Strategies are stored with `pluginId.strategyId` format
  - Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
  - Router returns qualified IDs so frontend can correctly fetch collectors

  **UI Improvements:**

  - Save button disabled when collector configs have invalid required fields
  - Fixed nested button warning in CollectorList accordion

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/signal-common@0.0.3

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
  - @checkstack/signal-common@0.0.2

## 0.1.1

### Patch Changes

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0
  - @checkstack/signal-common@0.1.1

## 0.1.0

### Minor Changes

- 4dd644d: Enable external application (API key) access to management endpoints

  Changed `userType: "user"` to `userType: "authenticated"` for 52 endpoints across 5 packages, allowing external applications (service accounts with API keys) to call these endpoints programmatically while maintaining RBAC permission checks:

  - **incident-common**: createIncident, updateIncident, addUpdate, resolveIncident, deleteIncident
  - **maintenance-common**: createMaintenance, updateMaintenance, addUpdate, closeMaintenance, deleteMaintenance
  - **catalog-common**: System CRUD, Group CRUD, addSystemToGroup, removeSystemFromGroup
  - **healthcheck-common**: Configuration management, system associations, retention config, detailed history
  - **integration-common**: Subscription management, connection management, event discovery, delivery logs

  This enables automation use cases such as:

  - Creating incidents from external monitoring systems (Prometheus, Grafana)
  - Scheduling maintenances from CI/CD pipelines
  - Managing catalog systems from infrastructure-as-code tools
  - Configuring health checks from deployment scripts

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkstack/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkstack/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkstack/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkstack/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkstack/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- 0babb9c: Add public health status access and detailed history for admins

  **Permission changes:**

  - Added `healthcheck.status.read` permission with `isPublicDefault: true` for anonymous access
  - `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` now public
  - `getHistory` no longer returns `result` field (security)

  **New features:**

  - Added `getDetailedHistory` endpoint with `healthcheck.manage` permission
  - New `/healthcheck/history` page showing paginated run history with expandable result JSON

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [b55fae6]
  - @checkstack/common@0.1.0
  - @checkstack/signal-common@0.1.0
