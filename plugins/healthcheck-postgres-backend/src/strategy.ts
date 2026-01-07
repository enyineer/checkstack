import { Client, type ClientConfig } from "pg";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  timeThresholdField,
  numericField,
  booleanField,
  evaluateAssertions,
  secret,
} from "@checkmate-monitor/backend-api";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for PostgreSQL health checks using shared factories.
 */
const postgresAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("connectionTime"),
  timeThresholdField("queryTime"),
  numericField("rowCount", { min: 0 }),
  booleanField("querySuccess"),
]);

export type PostgresAssertion = z.infer<typeof postgresAssertionSchema>;

/**
 * Configuration schema for PostgreSQL health checks.
 */
export const postgresConfigSchema = z.object({
  host: z.string().describe("PostgreSQL server hostname"),
  port: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(5432)
    .describe("PostgreSQL port"),
  database: z.string().describe("Database name"),
  user: z.string().describe("Username for authentication"),
  password: secret({ description: "Password for authentication" }),
  ssl: z.boolean().default(false).describe("Use SSL/TLS connection"),
  timeout: z
    .number()
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
  query: z
    .string()
    .default("SELECT 1")
    .describe("Health check query to execute"),
  assertions: z
    .array(postgresAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;
export type PostgresConfigInput = z.input<typeof postgresConfigSchema>;

/**
 * Per-run result metadata.
 */
const postgresResultSchema = z.object({
  connected: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  queryTimeMs: z.number().optional().meta({
    "x-chart-type": "line",
    "x-chart-label": "Query Time",
    "x-chart-unit": "ms",
  }),
  rowCount: z.number().optional().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Row Count",
  }),
  serverVersion: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Server Version",
  }),
  querySuccess: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Query Success",
  }),
  failedAssertion: postgresAssertionSchema.optional(),
  error: z.string().optional().meta({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }),
});

export type PostgresResult = z.infer<typeof postgresResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const postgresAggregatedSchema = z.object({
  avgConnectionTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  avgQueryTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Query Time",
    "x-chart-unit": "ms",
  }),
  successRate: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

export type PostgresAggregatedResult = z.infer<typeof postgresAggregatedSchema>;

// ============================================================================
// DATABASE CLIENT INTERFACE (for testability)
// ============================================================================

export interface DbQueryResult {
  rowCount: number | null;
}

export interface DbClient {
  connect(config: ClientConfig): Promise<{
    query(sql: string): Promise<DbQueryResult>;
    end(): Promise<void>;
  }>;
}

// Default client using pg
const defaultDbClient: DbClient = {
  async connect(config) {
    const client = new Client(config);
    await client.connect();

    return {
      async query(sql: string): Promise<DbQueryResult> {
        const result = await client.query(sql);
        return { rowCount: result.rowCount };
      },
      async end() {
        await client.end();
      },
    };
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class PostgresHealthCheckStrategy
  implements
    HealthCheckStrategy<
      PostgresConfig,
      PostgresResult,
      PostgresAggregatedResult
    >
{
  id = "postgres";
  displayName = "PostgreSQL Health Check";
  description = "PostgreSQL database connectivity and query health check";

  private dbClient: DbClient;

  constructor(dbClient: DbClient = defaultDbClient) {
    this.dbClient = dbClient;
  }

  config: Versioned<PostgresConfig> = new Versioned({
    version: 1,
    schema: postgresConfigSchema,
  });

  result: Versioned<PostgresResult> = new Versioned({
    version: 1,
    schema: postgresResultSchema,
  });

  aggregatedResult: Versioned<PostgresAggregatedResult> = new Versioned({
    version: 1,
    schema: postgresAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<PostgresResult>[]
  ): PostgresAggregatedResult {
    let totalConnectionTime = 0;
    let totalQueryTime = 0;
    let successCount = 0;
    let errorCount = 0;
    let validRuns = 0;
    let queryRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.status === "healthy") {
        successCount++;
      }
      if (run.metadata) {
        totalConnectionTime += run.metadata.connectionTimeMs;
        if (run.metadata.queryTimeMs !== undefined) {
          totalQueryTime += run.metadata.queryTimeMs;
          queryRuns++;
        }
        validRuns++;
      }
    }

    return {
      avgConnectionTime: validRuns > 0 ? totalConnectionTime / validRuns : 0,
      avgQueryTime: queryRuns > 0 ? totalQueryTime / queryRuns : 0,
      successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      errorCount,
    };
  }

  async execute(
    config: PostgresConfigInput
  ): Promise<HealthCheckResult<PostgresResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      // Connect to database
      const connection = await this.dbClient.connect({
        host: validatedConfig.host,
        port: validatedConfig.port,
        database: validatedConfig.database,
        user: validatedConfig.user,
        password: validatedConfig.password,
        ssl: validatedConfig.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: validatedConfig.timeout,
      });

      const connectionTimeMs = Math.round(performance.now() - start);

      // Execute health check query
      const queryStart = performance.now();
      let querySuccess = false;
      let rowCount: number | undefined;
      let queryTimeMs: number | undefined;

      try {
        const result = await connection.query(validatedConfig.query);
        querySuccess = true;
        rowCount = result.rowCount ?? 0;
        queryTimeMs = Math.round(performance.now() - queryStart);
      } catch {
        querySuccess = false;
        queryTimeMs = Math.round(performance.now() - queryStart);
      }

      await connection.end();

      const result: Omit<PostgresResult, "failedAssertion" | "error"> = {
        connected: true,
        connectionTimeMs,
        queryTimeMs,
        rowCount,
        querySuccess,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        connectionTime: connectionTimeMs,
        queryTime: queryTimeMs ?? 0,
        rowCount: rowCount ?? 0,
        querySuccess,
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs + (queryTimeMs ?? 0),
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      if (!querySuccess) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs + (queryTimeMs ?? 0),
          message: "Health check query failed",
          metadata: result,
        };
      }

      return {
        status: "healthy",
        latencyMs: connectionTimeMs + (queryTimeMs ?? 0),
        message: `PostgreSQL - query returned ${rowCount} row(s) in ${queryTimeMs}ms`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "PostgreSQL connection failed",
        metadata: {
          connected: false,
          connectionTimeMs: Math.round(end - start),
          querySuccess: false,
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
