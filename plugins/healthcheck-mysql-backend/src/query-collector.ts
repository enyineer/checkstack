import {
  Versioned,
  z,
  configString,
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
  // Templatable: supports `{{ environment.query }}` so one config covers N
  // environments. `.min(1)` still guards the STORED value (a `{{ }}` template is
  // non-empty); the CONCRETE rendered query is re-checked POST-RENDER in
  // `execute` because an empty render must not run as a successful query.
  query: configString({ "x-templatable": true })
    .min(1)
    .default("SELECT 1")
    .describe(
      "SQL query to execute. Supports templating, e.g. {{ environment.query }}",
    ),
});

export type QueryConfig = z.infer<typeof queryConfigSchema>;

/**
 * Post-render validator for the rendered `query`. An empty render (e.g. an
 * env-less run resolving `{{ environment.query }}` to "") is a config error
 * that prevents the probe - transport-failure semantics - not a healthy empty
 * query.
 */
const renderedQuerySchema = z.string().trim().min(1);

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const queryResultSchema = healthResultSchema({
  rowCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Row Count",
    // Row count of an arbitrary user-supplied query legitimately varies a lot
    // run to run with no stable baseline and no good/bad direction. Baselining
    // it produces alert fatigue, so it is off by default and remains chartable.
    "x-anomaly-enabled": false,
    "x-chart-priority": 30,
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Err wider so small jitter on fast queries does not alert.
    "x-anomaly-sensitivity": 2.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
    "x-chart-true-label": "successful",
    "x-chart-false-label": "failing",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-good-direction": "up",
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
    "x-anomaly-sensitivity": 2.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-confirmation-window": 3,
    // Ignore sub-5% wobble in the success rate so brief blips do not alert.
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

    // Post-render guard: `query` is a templatable string, so the concrete value
    // is re-validated here after the executor rendered `{{ environment.* }}`.
    // An empty render is a config error - fail as a transport failure rather
    // than running (and "succeeding" at) an empty query.
    const query = renderedQuerySchema.safeParse(config.query);
    if (!query.success) {
      return {
        result: {
          rowCount: 0,
          executionTimeMs: Date.now() - startTime,
          success: false,
        },
        error: `Rendered query is empty: ${JSON.stringify(config.query)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      };
    }

    const response = await client.exec({ query: query.data });
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
