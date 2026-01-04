---
---
# Health Check Custom Charts

## Overview

The health check platform supports **strategy-specific visualizations** through an extension slot system. This allows health check strategies to provide specialized charts for their unique data (e.g., HTTP status code distribution, database connection pool stats).

## Architecture

### Dual Visualization Pattern

The platform provides two types of charts:

1. **Generic Charts** (Platform-provided)
   - `HealthCheckLatencyChart`: Tracks execution speed trends
   - `HealthCheckStatusTimeline`: Visualizes success/failure over time
   - Work with all health checks, regardless of strategy

2. **Strategy-Specific Diagrams** (Custom)
   - Injected via `HealthCheckDiagramSlot`
   - Filtered to only show for relevant strategies
   - Have access to full `result`/`aggregatedResult` data

### Data Modes

Custom charts must handle two data modes based on the selected time range:

| Mode | Context Type | Data | When Used |
|------|--------------|------|-----------|
| **Raw** | `RawDiagramContext` | Individual run results | Short ranges (≤ `rawRetentionDays`) |
| **Aggregated** | `AggregatedDiagramContext` | Bucketed summaries | Long ranges (> `rawRetentionDays`) |

## Creating Custom Charts

### Step 1: Define Your Types

In your strategy's **common package**, define the result types:

```typescript
// @checkmate/healthcheck-http-common/src/types.ts
import { z } from "zod";

// Per-run result schema
export const HttpResultSchema = z.object({
  statusCode: z.number(),
  responseTimeMs: z.number(),
  contentLength: z.number().optional(),
});
export type HttpResult = z.infer<typeof HttpResultSchema>;

// Aggregated result schema
export const HttpAggregatedResultSchema = z.object({
  statusCodeDistribution: z.record(z.string(), z.number()),
  avgResponseTimeMs: z.number(),
  errorRate: z.number(),
});
export type HttpAggregatedResult = z.infer<typeof HttpAggregatedResultSchema>;
```

### Step 2: Create the Diagram Extension Factory

In your strategy's **common package**, create a typed helper:

```typescript
// @checkmate/healthcheck-http-common/src/slots.ts
import { createDiagramExtensionFactory } from "@checkmate/healthcheck-frontend";
import { httpCheckMetadata } from "./plugin-metadata";
import type { HttpResult, HttpAggregatedResult } from "./types";

/**
 * Pre-typed helper for creating HTTP check diagram extensions.
 * Consumers get automatic type inference for their components.
 */
export const createHttpDiagramExtension = createDiagramExtensionFactory<
  HttpResult,
  HttpAggregatedResult
>(httpCheckMetadata);
```

### Step 3: Implement Chart Components

In your strategy's **frontend package**, create the chart components:

```typescript
// @checkmate/healthcheck-http-frontend/src/charts/HttpStatusChart.tsx
import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import type { RawDiagramContext } from "@checkmate/healthcheck-frontend";
import type { HttpResult } from "@checkmate/healthcheck-http-common";

/**
 * Raw mode component - renders per-run data.
 */
export const HttpStatusRawChart: React.FC<RawDiagramContext<HttpResult>> = ({
  runs,
}) => {
  // Aggregate status codes from individual runs
  const statusCounts: Record<string, number> = {};
  for (const run of runs) {
    const code = String(run.result?.statusCode ?? "unknown");
    statusCounts[code] = (statusCounts[code] ?? 0) + 1;
  }

  const data = Object.entries(statusCounts).map(([code, count]) => ({
    code,
    count,
  }));

  return (
    <div className="p-4">
      <h4 className="text-sm font-medium mb-2">Status Code Distribution</h4>
      <BarChart width={400} height={200} data={data}>
        <XAxis dataKey="code" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="count" fill="#3b82f6" />
      </BarChart>
    </div>
  );
};
```

```typescript
// @checkmate/healthcheck-http-frontend/src/charts/HttpStatusAggregatedChart.tsx
import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import type { AggregatedDiagramContext } from "@checkmate/healthcheck-frontend";
import type { HttpAggregatedResult } from "@checkmate/healthcheck-http-common";

/**
 * Aggregated mode component - renders bucketed data.
 */
export const HttpStatusAggregatedChart: React.FC<
  AggregatedDiagramContext<HttpAggregatedResult>
> = ({ buckets }) => {
  // Combine status distributions across all buckets
  const totalDistribution: Record<string, number> = {};
  for (const bucket of buckets) {
    const dist = bucket.aggregatedResult?.statusCodeDistribution ?? {};
    for (const [code, count] of Object.entries(dist)) {
      totalDistribution[code] = (totalDistribution[code] ?? 0) + count;
    }
  }

  const data = Object.entries(totalDistribution).map(([code, count]) => ({
    code,
    count,
  }));

  return (
    <div className="p-4">
      <h4 className="text-sm font-medium mb-2">Status Code Distribution (Aggregated)</h4>
      <BarChart width={400} height={200} data={data}>
        <XAxis dataKey="code" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="count" fill="#8b5cf6" />
      </BarChart>
    </div>
  );
};
```

### Step 4: Register the Extension

In your strategy's **frontend plugin**, register the extension:

```typescript
// @checkmate/healthcheck-http-frontend/src/index.tsx
import { createFrontendPlugin } from "@checkmate/frontend-api";
import { createHttpDiagramExtension } from "@checkmate/healthcheck-http-common";
import { HttpStatusRawChart } from "./charts/HttpStatusChart";
import { HttpStatusAggregatedChart } from "./charts/HttpStatusAggregatedChart";

// Create the extension using the typed helper
const httpStatusDiagram = createHttpDiagramExtension({
  id: "http-check.status-distribution",
  rawComponent: HttpStatusRawChart,           // Required
  aggregatedComponent: HttpStatusAggregatedChart, // Optional
});

export default createFrontendPlugin({
  name: "healthcheck-http-frontend",
  extensions: [httpStatusDiagram],
});
```

## The `createDiagramExtensionFactory` API

```typescript
function createDiagramExtensionFactory<TResult, TAggregatedResult>(
  strategyMetadata: PluginMetadata
): (options: {
  id: string;
  rawComponent: React.ComponentType<RawDiagramContext<TResult>>;
  aggregatedComponent?: React.ComponentType<AggregatedDiagramContext<TAggregatedResult>>;
}) => SlotExtension;
```

### Parameters

- **`strategyMetadata`**: Your strategy's plugin metadata. Used for filtering.
- **`id`**: Unique extension ID (e.g., `"http-check.status-chart"`)
- **`rawComponent`**: Component for rendering individual run data (required)
- **`aggregatedComponent`**: Component for rendering aggregated bucket data (optional)

### Automatic Fallback

If `aggregatedComponent` is not provided, the platform shows a fallback message:

> "Strategy does not support aggregated visualization. Select a shorter time range for detailed per-run data."

## Context Types

### `RawDiagramContext<TResult>`

```typescript
interface RawDiagramContext<TResult> {
  type: "raw";
  systemId: string;
  configurationId: string;
  strategyId: string;
  runs: TypedHealthCheckRun<TResult>[];
}

interface TypedHealthCheckRun<TResult> {
  id: string;
  configurationId: string;
  systemId: string;
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: Date;
  latencyMs?: number;
  result: TResult;  // Typed!
}
```

### `AggregatedDiagramContext<TAggregatedResult>`

```typescript
interface AggregatedDiagramContext<TAggregatedResult> {
  type: "aggregated";
  systemId: string;
  configurationId: string;
  strategyId: string;
  buckets: TypedAggregatedBucket<TAggregatedResult>[];
}

interface TypedAggregatedBucket<TAggregatedResult> {
  bucketStart: Date;
  bucketSize: "hourly" | "daily";
  runCount: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  successRate: number;
  avgLatencyMs?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  p95LatencyMs?: number;
  aggregatedResult?: TAggregatedResult;  // Typed!
}
```

## Using the `useHealthCheckData` Hook

For advanced use cases, you can access the raw hook directly:

```typescript
import { useHealthCheckData } from "@checkmate/healthcheck-frontend";

function MyCustomVisualization({ systemId, configurationId, strategyId, dateRange }) {
  const { 
    context,        // Ready-to-use slot context
    loading,        // Loading state
    isAggregated,   // Whether aggregated mode is active
    retentionConfig, // Current retention settings
    hasPermission,  // User has healthCheckDetailsRead
    permissionLoading,
  } = useHealthCheckData({
    systemId,
    configurationId,
    strategyId,
    dateRange,
    limit: 100,     // For raw mode pagination
    offset: 0,
  });

  if (loading) return <LoadingSpinner />;
  if (!hasPermission) return <NoPermissionBanner />;
  if (!context) return null;

  // Render based on context.type
  if (context.type === "raw") {
    return <MyRawChart runs={context.runs} />;
  } else {
    return <MyAggregatedChart buckets={context.buckets} />;
  }
}
```

## Using the `HealthCheckDiagram` Component

For the simplest integration, use the wrapper component:

```typescript
import { HealthCheckDiagram } from "@checkmate/healthcheck-frontend";

function MyPage({ systemId, configurationId, strategyId, dateRange }) {
  return (
    <HealthCheckDiagram
      systemId={systemId}
      configurationId={configurationId}
      strategyId={strategyId}
      dateRange={dateRange}
    />
  );
}
```

This component:
- Handles loading states
- Shows permission banners
- Displays `AggregatedDataBanner` when in aggregated mode
- Renders the `HealthCheckDiagramSlot` with proper context

## Recommended Charting Libraries

| Library | Best For | Notes |
|---------|----------|-------|
| **Recharts** | Most use cases | Component-based, good DX, SVG rendering |
| **Nivo** | Highly responsive charts | Built-in theming, Canvas support |
| **react-chartjs-2** | Performance-critical | Canvas-based, Chart.js wrapper |

## Best Practices

### 1. Handle Missing Data

```typescript
// ✅ Good - graceful handling
const data = bucket.aggregatedResult?.statusCodeDistribution ?? {};

// ❌ Bad - may crash
const data = bucket.aggregatedResult.statusCodeDistribution;
```

### 2. Keep Charts Performant

```typescript
// ✅ Good - memoize computed data
const chartData = useMemo(() => {
  return processRuns(runs);
}, [runs]);

// ❌ Bad - recalculates on every render
const chartData = processRuns(runs);
```

### 3. Use Consistent Styling

Follow the platform's design system for colors and spacing:

```tsx
// Use theme-aware colors
<Bar dataKey="count" fill="var(--color-primary)" />

// Use consistent padding
<div className="p-4">
  <ChartComponent />
</div>
```

### 4. Provide Meaningful Tooltips

```tsx
<Tooltip
  formatter={(value: number) => [`${value} requests`, "Count"]}
  labelFormatter={(label) => `Status: ${label}`}
/>
```

## Next Steps

- [Health Check Data Management](../backend/healthcheck-data-management.md) - Backend aggregation details
- [Extension Points](./extension-points.md) - General slot system
- [Theming](./theming.md) - Design tokens and colors
