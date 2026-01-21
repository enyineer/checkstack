---
"@checkstack/healthcheck-frontend": minor
---

Unified chart data to always use aggregated history with fixed target points.

**Breaking Changes:**
- Removed `RawDiagramContext` type - chart context no longer has a `type` discriminator
- Removed `TypedHealthCheckRun` type export - charts only use aggregated buckets now
- Removed `createStrategyDiagramExtension` deprecated function
- Removed `isAggregated` and `retentionConfig` from `useHealthCheckData` return value

**Migration:**
- Strategy diagram extensions should use `createDiagramExtensionFactory` instead of `createStrategyDiagramExtension`
- Extensions no longer need separate `rawComponent` and `aggregatedComponent` - use a single `component` prop
- `HealthCheckDiagramSlotContext` now always contains `buckets` array (no `type` field)

**Benefits:**
- Simplified frontend logic - no more mode switching based on retention config
- Consistent chart visualization regardless of selected time range
- Backend's cross-tier aggregation engine automatically selects optimal data source
