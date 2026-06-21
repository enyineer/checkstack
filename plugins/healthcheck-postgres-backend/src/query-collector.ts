import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { PostgresTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const queryConfigSchema = z.object({
  query: z.string().min(1).default("SELECT 1").describe("SQL query to execute"),
});

export type QueryConfig = z.infer<typeof queryConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const queryResultSchema = healthResultSchema({
  rowCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Row Count",
    // Row counts of arbitrary user-supplied SQL have no stable, universal
    // baseline (a JOIN, a COUNT(*), a paginated SELECT all behave wildly
    // differently) and no inherent good/bad direction. Baselining this would
    // fire on routine data growth, so it is off by default. Still chartable
    // and opt-in per check.
    "x-anomaly-enabled": false,
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
});

export type QueryResult = z.infer<typeof queryResultSchema>;

// Aggregated result fields definition
const queryAggregatedFields = {
  avgExecutionTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency saturation signal. Err wider and require sustained drift plus a
    // practical floor so a fast query is not flagged on sub-perceptible jitter.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    // Availability percent. Require a few consecutive degraded buckets and a
    // meaningful absolute drop so a single transient failure does not alert.
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
};

// Type inferred from field definitions
export type QueryAggregatedResult = InferAggregatedResult<
  typeof queryAggregatedFields
>;

// ============================================================================
// QUERY COLLECTOR
// ============================================================================

/**
 * Built-in PostgreSQL query collector.
 * Executes SQL queries and checks results.
 */
export class QueryCollector implements CollectorStrategy<
  PostgresTransportClient,
  QueryConfig,
  QueryResult,
  QueryAggregatedResult
> {
  id = "query";
  displayName = "SQL Query";
  description = "Execute a SQL query and check the result";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: queryConfigSchema });
  result = new Versioned({ version: 1, schema: queryResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: queryAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: QueryConfig;
    client: PostgresTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<QueryResult>> {
    const startTime = Date.now();

    const response = await client.exec({ query: config.query });
    const executionTimeMs = Date.now() - startTime;

    return {
      result: {
        rowCount: response.rowCount,
        executionTimeMs,
        success: !response.error,
      },
      error: response.error,
    };
  }

  mergeResult(
    existing: QueryAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<QueryResult>,
  ): QueryAggregatedResult {
    const metadata = run.metadata;

    return {
      avgExecutionTimeMs: mergeAverage(
        existing?.avgExecutionTimeMs,
        metadata?.executionTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, metadata?.success),
    };
  }
}
