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
import type { MysqlTransportClient } from "./transport-client";

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
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
});

export type QueryResult = z.infer<typeof queryResultSchema>;

// Aggregated result fields definition
const queryAggregatedFields = {
  avgExecutionTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
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
 * Built-in MySQL query collector.
 * Executes SQL queries and checks results.
 */
export class QueryCollector implements CollectorStrategy<
  MysqlTransportClient,
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
    client: MysqlTransportClient;
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
