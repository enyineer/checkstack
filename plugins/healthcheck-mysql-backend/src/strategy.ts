import mysql from "mysql2/promise";
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
  configString,
  configNumber,
} from "@checkmate-monitor/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
} from "@checkmate-monitor/healthcheck-common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for MySQL health checks using shared factories.
 */
const mysqlAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("connectionTime"),
  timeThresholdField("queryTime"),
  numericField("rowCount", { min: 0 }),
  booleanField("querySuccess"),
]);

export type MysqlAssertion = z.infer<typeof mysqlAssertionSchema>;

/**
 * Configuration schema for MySQL health checks.
 */
export const mysqlConfigSchema = z.object({
  host: configString({}).describe("MySQL server hostname"),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(3306)
    .describe("MySQL port"),
  database: configString({}).describe("Database name"),
  user: configString({}).describe("Username for authentication"),
  password: configString({ "x-secret": true }).describe(
    "Password for authentication"
  ),
  timeout: configNumber({})
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
  query: configString({})
    .default("SELECT 1")
    .describe("Health check query to execute"),
  assertions: z
    .array(mysqlAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type MysqlConfig = z.infer<typeof mysqlConfigSchema>;
export type MysqlConfigInput = z.input<typeof mysqlConfigSchema>;

/**
 * Per-run result metadata.
 */
const mysqlResultSchema = z.object({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  queryTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Query Time",
    "x-chart-unit": "ms",
  }).optional(),
  rowCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Row Count",
  }).optional(),
  querySuccess: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Query Success",
  }),
  failedAssertion: mysqlAssertionSchema.optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

export type MysqlResult = z.infer<typeof mysqlResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const mysqlAggregatedSchema = z.object({
  avgConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  avgQueryTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Query Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

export type MysqlAggregatedResult = z.infer<typeof mysqlAggregatedSchema>;

// ============================================================================
// DATABASE CLIENT INTERFACE (for testability)
// ============================================================================

export interface DbQueryResult {
  rowCount: number;
}

export interface DbConnection {
  query(sql: string): Promise<DbQueryResult>;
  end(): Promise<void>;
}

export interface DbClient {
  connect(config: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    connectTimeout: number;
  }): Promise<DbConnection>;
}

// Default client using mysql2
const defaultDbClient: DbClient = {
  async connect(config) {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectTimeout: config.connectTimeout,
    });

    return {
      async query(sql: string): Promise<DbQueryResult> {
        const [rows] = await connection.query(sql);
        const rowCount = Array.isArray(rows) ? rows.length : 0;
        return { rowCount };
      },
      async end() {
        await connection.end();
      },
    };
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class MysqlHealthCheckStrategy
  implements
    HealthCheckStrategy<MysqlConfig, MysqlResult, MysqlAggregatedResult>
{
  id = "mysql";
  displayName = "MySQL Health Check";
  description = "MySQL database connectivity and query health check";

  private dbClient: DbClient;

  constructor(dbClient: DbClient = defaultDbClient) {
    this.dbClient = dbClient;
  }

  config: Versioned<MysqlConfig> = new Versioned({
    version: 1,
    schema: mysqlConfigSchema,
  });

  result: Versioned<MysqlResult> = new Versioned({
    version: 1,
    schema: mysqlResultSchema,
  });

  aggregatedResult: Versioned<MysqlAggregatedResult> = new Versioned({
    version: 1,
    schema: mysqlAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<MysqlResult>[]
  ): MysqlAggregatedResult {
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
    config: MysqlConfigInput
  ): Promise<HealthCheckResult<MysqlResult>> {
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
        connectTimeout: validatedConfig.timeout,
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
        rowCount = result.rowCount;
        queryTimeMs = Math.round(performance.now() - queryStart);
      } catch {
        querySuccess = false;
        queryTimeMs = Math.round(performance.now() - queryStart);
      }

      await connection.end();

      const result: Omit<MysqlResult, "failedAssertion" | "error"> = {
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
        message: `MySQL - query returned ${rowCount} row(s) in ${queryTimeMs}ms`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "MySQL connection failed",
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
