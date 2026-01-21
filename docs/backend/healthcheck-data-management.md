---
---
# Health Check Data Management

## Overview

The health check platform handles high-volume execution data through a tiered storage model with automated aggregation. This ensures both deep diagnostic capabilities for recent data and long-term trending for historical analysis.

## Tiered Storage Architecture

Data flows through three distinct tiers, each optimized for different use cases:

| Tier | Storage Table | Default Retention | Contents | Use Case |
|------|---------------|-------------------|----------|----------|
| **Raw** | `health_check_runs` | 7 days | Full run data including strategy-specific `result` JSONB | Recent diagnostics, per-run analysis |
| **Hourly** | `health_check_aggregates` | 30 days | Bucketed summaries with `aggregatedResult` | Medium-term trending, detailed charts |
| **Daily** | `health_check_aggregates` | 365 days | Daily summaries (core metrics only) | Long-term trending, capacity planning |

## Aggregation Process

### Automatic Metrics

The platform automatically calculates these metrics for each bucket:

- **Run Counts**: `runCount`, `healthyCount`, `degradedCount`, `unhealthyCount`
- **Success Rate**: Calculated as `healthyCount / runCount`
- **Latency Statistics**: `avgLatencyMs`, `minLatencyMs`, `maxLatencyMs`, `p95LatencyMs`

### Strategy-Specific Aggregation

Health check strategies can contribute custom aggregated data via the required `aggregateResult` hook:

```typescript
interface HealthCheckStrategy<TConfig, TResult, TAggregatedResult> {
  // ... other fields

  /**
   * REQUIRED: Schema for aggregated result data.
   * Defines the shape stored in health_check_aggregates.aggregatedResult
   */
  aggregatedResult: VersionedSchema<TAggregatedResult>;

  /**
   * REQUIRED: Summarizes raw runs into an aggregated bucket.
   * Called during retention processing and on-the-fly aggregation.
   */
  aggregateResult(
    runs: Array<{ status: string; latencyMs?: number; result?: TResult }>
  ): TAggregatedResult;
}
```

**Example: HTTP Check Strategy**

```typescript
const httpCheckStrategy: HealthCheckStrategy<HttpConfig, HttpResult, HttpAggregatedResult> = {
  id: "http-check",
  displayName: "HTTP Health Check",
  
  aggregatedResult: {
    version: 1,
    schema: z.object({
      statusCodeDistribution: z.record(z.string(), z.number()),
      avgResponseTimeMs: z.number(),
      errorRate: z.number(),
    }),
  },

  aggregateResult(runs) {
    const statusCodes: Record<string, number> = {};
    let totalTime = 0;
    let errorCount = 0;

    for (const run of runs) {
      const code = String(run.result?.statusCode ?? 0);
      statusCodes[code] = (statusCodes[code] ?? 0) + 1;
      totalTime += run.latencyMs ?? 0;
      if (run.status !== "healthy") errorCount++;
    }

    return {
      statusCodeDistribution: statusCodes,
      avgResponseTimeMs: runs.length > 0 ? totalTime / runs.length : 0,
      errorRate: runs.length > 0 ? errorCount / runs.length : 0,
    };
  },

  // ... execute and other methods
};
```

## Retention Job

A daily background job manages the data lifecycle:

### Stage 1: Raw → Hourly

1. Identifies raw runs older than `rawRetentionDays`
2. Groups runs into 1-hour windows
3. Calculates aggregate metrics for each hour
4. Calls `strategy.aggregateResult(runs)` for strategy-specific data
5. Upserts into `health_check_aggregates` with `bucketSize: 'hourly'`
6. Deletes processed raw runs

### Stage 2: Hourly → Daily

1. Identifies hourly aggregates older than `hourlyRetentionDays`
2. Groups hourly buckets by day
3. Calculates weighted-average latency: `SUM(avg * runCount) / SUM(runCount)`
4. Keeps global min/max latency across all hourly buckets
5. Inserts daily aggregate (note: P95 and `aggregatedResult` are dropped)
6. Deletes processed hourly aggregates

### Stage 3: Expired Cleanup

Deletes daily aggregates older than `dailyRetentionDays`.

## Configurable Retention

Retention can be customized per system-assignment via the `RetentionConfig` schema:

```typescript
const RetentionConfigSchema = z.object({
  /** Days to keep raw run data (1-30, default: 7) */
  rawRetentionDays: z.number().int().min(1).max(30).default(7),
  /** Days to keep hourly aggregates (7-90, default: 30) */
  hourlyRetentionDays: z.number().int().min(7).max(90).default(30),
  /** Days to keep daily aggregates (30-1095, default: 365) */
  dailyRetentionDays: z.number().int().min(30).max(1095).default(365),
});
```

> [!IMPORTANT]
> The platform enforces a strict hierarchy: `rawRetentionDays < hourlyRetentionDays < dailyRetentionDays`. Violations result in a `BAD_REQUEST` error.

### RPC Endpoints

| Endpoint | Description |
|----------|-------------|
| `getRetentionConfig` | Get current retention settings for an assignment |
| `updateRetentionConfig` | Update retention settings (pass `null` to reset to defaults) |

## On-the-Fly Aggregation

For unified chart rendering, the system uses cross-tier aggregation to query from raw, hourly, and daily storage, merging with priority:

1. **Target Points**: Frontend requests a fixed number of data points (e.g., 500)
2. **Dynamic Bucket Calculation**: `(endDate - startDate) / targetPoints` determines bucket interval
3. **Tier Selection**: Automatically queries the appropriate tier(s) based on interval
4. **Priority Merge**: Raw data takes priority over hourly, which takes priority over daily
5. **Re-aggregation**: Merged data is re-aggregated to match target bucket interval

```typescript
// Service method signature
async getAggregatedHistory(
  props: {
    systemId: string;
    configurationId: string;
    startDate: Date;
    endDate: Date;
    targetPoints?: number; // Default: 500
  },
  options: { includeAggregatedResult: boolean }
)
```

## Access Model

Aggregated data access follows the same tiered access model as raw data:

| Endpoint | Access | Returns |
|----------|------------|---------|
| `getAggregatedHistory` | `healthCheckStatusRead` | Core metrics only (`AggregatedBucketBase`) |
| `getDetailedAggregatedHistory` | `healthCheckDetailsRead` | Core metrics + `aggregatedResult` |

## Best Practices

### 1. Always Implement `aggregateResult`

Every strategy **must** provide an `aggregateResult` implementation. Without it, long-term historical views will lack strategy-specific insights.

### 2. Keep Aggregated Results Compact

The `aggregatedResult` is stored as JSONB. Design it to capture essential trends without replicating all raw data:

```typescript
// ✅ Good - summary statistics
{
  statusCodeDistribution: { "200": 95, "500": 5 },
  errorRate: 0.05,
}

// ❌ Bad - too detailed for aggregation
{
  allStatusCodes: [200, 200, 500, 200, ...],
  allErrors: [{ timestamp: ..., message: ... }, ...],
}
```

### 3. Handle Missing Data Gracefully

During daily rollup, `aggregatedResult` is dropped. Strategy diagrams should handle `undefined` aggregated results for very old data.

## Next Steps

- [Custom Chart Components](../frontend/healthcheck-charts.md) - Build strategy-specific visualizations
- [Extension Points](../frontend/extension-points.md) - General extension system
- [Queue System](./queue-system.md) - Background job infrastructure
