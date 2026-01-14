# @checkstack/release

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
