---
"@checkstack/healthcheck-frontend": minor
---

Added support for nested collector result display in auto-charts and history table.

- Updated `schema-parser.ts` to traverse `collectors.*` nested schemas and extract chart fields with dot-notation paths
- Added `getFieldValue()` support for dot-notation paths like `collectors.request.responseTimeMs`
- Added `ExpandedResultView` component to `HealthCheckRunsTable.tsx` that displays:
  - Connection info (status, latency, connection time)
  - Per-collector results as structured cards with key-value pairs
