import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultBoolean,
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

const queryResultSchema = z.object({
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

const queryAggregatedSchema = z.object({
  avgExecutionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
});

export type QueryAggregatedResult = z.infer<typeof queryAggregatedSchema>;

// ============================================================================
// QUERY COLLECTOR
// ============================================================================

/**
 * Built-in MySQL query collector.
 * Executes SQL queries and checks results.
 */
export class QueryCollector
  implements
    CollectorStrategy<
      MysqlTransportClient,
      QueryConfig,
      QueryResult,
      QueryAggregatedResult
    >
{
  id = "query";
  displayName = "SQL Query";
  description = "Execute a SQL query and check the result";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: queryConfigSchema });
  result = new Versioned({ version: 1, schema: queryResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: queryAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<QueryResult>[]
  ): QueryAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.executionTimeMs)
      .filter((v): v is number => typeof v === "number");

    const successes = runs
      .map((r) => r.metadata?.success)
      .filter((v): v is boolean => typeof v === "boolean");

    const successCount = successes.filter(Boolean).length;

    return {
      avgExecutionTimeMs:
        times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
      successRate:
        successes.length > 0
          ? Math.round((successCount / successes.length) * 100)
          : 0,
    };
  }
}
