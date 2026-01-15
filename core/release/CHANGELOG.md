# @checkstack/release

## 0.6.0

### Minor Changes

- 9a27800: Changed recurring job scheduling from completion-based to wall-clock scheduling.

  **Breaking Change:** Recurring jobs now run on a fixed interval (like BullMQ) regardless of whether the previous job has completed. If a job takes longer than `intervalSeconds`, multiple jobs may run concurrently.

  **Improvements:**

  - Fixed job ID collision bug when rescheduling within the same millisecond
  - Configuration updates via `scheduleRecurring()` now properly cancel old intervals before starting new ones
  - Added `heartbeatIntervalMs` to config for resilient job recovery after system sleep

## 0.5.0

### Minor Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

## 0.4.0

### Minor Changes

- 97c5a6b: Fixed DOM clobbering issue in DynamicForm by prefixing field IDs with 'field-'. Previously, schema fields with names matching native DOM properties (like 'nodeName', 'tagName', 'innerHTML') could shadow those properties, causing floating-ui and React to crash during DOM traversal.

## 0.3.0

### Minor Changes

- f5b1f49: Updated frontend URL environment variable from `VITE_FRONTEND_URL` to `BASE_URL` for consistency.

## 0.2.0

### Minor Changes

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

## 0.1.0

### Minor Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
