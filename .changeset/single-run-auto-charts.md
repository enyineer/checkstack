---
"@checkstack/healthcheck-frontend": minor
---

## Single Run Auto-Charts

Added `SingleRunChartGrid` component to display auto-generated charts for individual health check runs when viewing run history details.

### Features

- Renders charts based on the strategy's `resultSchema` metadata (same as aggregated charts)
- Supports all chart types: gauge, counter, boolean, text, status
- Groups fields by collector instance with assertion status display
- Updated `useStrategySchemas` hook to also return `resultSchema` for single-run visualization

### Changes

- Simplified `ExpandedResultView` to show only basic run metadata (status, latency, connection)
- Collector results and detailed data now displayed via `SingleRunChartGrid`
