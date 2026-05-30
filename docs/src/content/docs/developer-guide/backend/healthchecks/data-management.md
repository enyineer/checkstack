---
title: "Health Check Data Management"
description: "Tiered storage model, retention defaults, and aggregation pipeline that power health check history and trends."
---

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
   * REQUIRED: Incrementally merge a new run into the aggregated result.
   * Called during real-time aggregation and retention processing.
   */
  mergeResult(
    existing: TAggregatedResult | undefined,
    run: { status: string; latencyMs?: number; metadata?: TResult }
  ): TAggregatedResult;
}
```

> [!NOTE]
> The incremental `mergeResult` pattern enables O(1) storage overhead by maintaining aggregation state
> directly, without accumulating raw runs in memory.

**Example: HTTP Check Strategy**

```typescript
const httpCheckStrategy: HealthCheckStrategy<HttpConfig, HttpResult, HttpAggregatedResult> = {
  id: "http-check",
  displayName: "HTTP Health Check",
  
  aggregatedResult: {
    version: 1,
    schema: z.object({
      // Display fields
      statusCodeDistribution: z.record(z.string(), z.number()),
      avgResponseTimeMs: z.number(),
      errorRate: z.number(),
      // Internal state for incremental aggregation
      _responseTime: averageStateSchema,
      _errorRate: rateStateSchema,
    }),
  },

  mergeResult(existing, run) {
    const metadata = run.metadata;
    const code = String(metadata?.statusCode ?? 0);
    
    // Merge status code distribution
    const statusCodes = { ...(existing?.statusCodeDistribution ?? {}) };
    statusCodes[code] = (statusCodes[code] ?? 0) + 1;
    
    // Merge averages and rates using utilities
    const responseTime = mergeAverage(existing?._responseTime, run.latencyMs);
    const errorRate = mergeRate(existing?._errorRate, run.status === "healthy");

    return {
      statusCodeDistribution: statusCodes,
      avgResponseTimeMs: responseTime.avg,
      errorRate: 100 - errorRate.rate, // Convert success rate to error rate
      _responseTime: responseTime,
      _errorRate: errorRate,
    };
  },

  // ... createClient and other methods
};
```

## Retention Job

A daily background job manages the data lifecycle:

### Stage 1: Raw → Hourly

1. Identifies raw runs older than `rawRetentionDays`
2. For each run, calls `strategy.mergeResult(existing, run)` to incrementally aggregate
3. Upserts into `health_check_aggregates` with `bucketSize: 'hourly'`
4. Deletes processed raw runs

> [!TIP]
> The mergeResult pattern enables real-time aggregation during execution,
> not just during retention processing.

### Stage 2: Hourly → Daily

1. Identifies hourly aggregates older than `hourlyRetentionDays`
2. Groups hourly buckets by day
3. Calculates weighted-average latency: `SUM(avg * runCount) / SUM(runCount)`
4. Keeps global min/max latency across all hourly buckets
5. Inserts daily aggregate (note: P95 and `aggregatedResult` are dropped)
6. Deletes processed hourly aggregates

### Stage 3: Expired Cleanup

Deletes daily aggregates older than `dailyRetentionDays`.

### Stage 4: State-transition prune

Deletes `health_check_state_transitions` rows older than the longest `rawRetentionDays` across a system's assignments, but always keeps the single most-recent row per system so the "in current status since" timestamp never blanks for an active streak.

## Aggregate state transitions

The `health_check_state_transitions` table records every aggregate health-status transition for a system (for example `healthy` -> `degraded` -> `unhealthy` -> `healthy`). One row is written wherever an aggregate transition is detected, at the same point the `systemHealthChanged` hook fires.

Unlike `health_check_unhealthy_transitions` (which is unhealthy-only, conditional on the auto-incident policy, and pruned with raw runs), this table is unconditional and covers all statuses. It is the source of truth for "how long has this system been in its current status?", which powers the automation sensing layer.

| Column | Meaning |
|--------|---------|
| `systemId` | The system whose aggregate status changed |
| `configurationId` | The check whose run drove the transition |
| `fromStatus` | Previous aggregate status (`null` on the first recorded transition) |
| `toStatus` | New aggregate status |
| `transitionedAt` | When the transition occurred |

## Health-state provider

The health-state provider exposes the live, computed health snapshot any plugin needs to answer "is this system unhealthy, and for how long?" without re-deriving the math. These are service-typed RPCs (backend-to-backend) on `HealthCheckApi`.

```typescript
getHealthState({ systemId, configurationId? }): Promise<{
  status: HealthCheckStatus;
  inStatusSince: Date | null;   // null when no transition recorded
  inStatusForMs: number;        // 0 when inStatusSince is null
  latencyMs?: number;           // newest run
  avgLatencyMs?: number;        // windowed (hourly aggregates)
  p95LatencyMs?: number;        // windowed
  successRate?: number;         // windowed, [0, 1]
  lastRunAt?: Date;
  inMaintenance: boolean;       // suppression-agnostic
  evaluatedAt: Date;
}>

// POST variant: resolves many systems against one shared timestamp,
// avoiding N+1 from dashboards and multi-system automation rules.
getBulkHealthState({ systemIds }): Promise<{
  states: Record<string, /* same shape as above */>;
}>
```

`status` reflects the single check when `configurationId` is supplied, otherwise the aggregate. `inStatusSince` / `inStatusForMs` come from the aggregate state-transition table; `inMaintenance` comes from the maintenance plugin's suppression-agnostic `hasActiveMaintenance` RPC.

> [!NOTE]
> The provider is fail-safe by design. A missing transition row yields `inStatusSince: null` (never throws), and a maintenance-plugin error fails open to `inMaintenance: false` so a downstream outage never wedges health-state reads.

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

### 1. Always Implement `mergeResult`

Every strategy **must** provide a `mergeResult` implementation. Without it, long-term historical views will lack strategy-specific insights.

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

- [Custom Chart Components](/checkstack/developer-guide/backend/frontend/healthcheck-charts/) - Build strategy-specific visualizations
- [Extension Points](/checkstack/developer-guide/backend/frontend/extension-points/) - General extension system
- [Queue System](/checkstack/developer-guide/backend/healthchecks/queue-system/) - Background job infrastructure
