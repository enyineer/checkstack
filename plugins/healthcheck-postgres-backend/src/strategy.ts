import { Client, type ClientConfig } from "pg";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  configString,
  configNumber,
  configBoolean,
  type ConnectedClient,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
} from "@checkstack/healthcheck-common";
import type {
  PostgresTransportClient,
  SqlQueryRequest,
  SqlQueryResult,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for PostgreSQL health checks.
 */
export const postgresConfigSchema = z.object({
  host: configString({}).describe("PostgreSQL server hostname"),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(5432)
    .describe("PostgreSQL port"),
  database: configString({}).describe("Database name"),
  user: configString({}).describe("Database user"),
  password: configString({ "x-secret": true }).describe("Database password"),
  ssl: configBoolean({}).default(false).describe("Use SSL connection"),
  timeout: configNumber({})
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
});

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;
export type PostgresConfigInput = z.input<typeof postgresConfigSchema>;

/**
 * Per-run result metadata.
 */
const postgresResultSchema = z.object({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type PostgresResult = z.infer<typeof postgresResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const postgresAggregatedSchema = z.object({
  avgConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  maxConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
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

type PostgresAggregatedResult = z.infer<typeof postgresAggregatedSchema>;

// ============================================================================
// DATABASE CLIENT INTERFACE (for testability)
// ============================================================================

interface DbQueryResult {
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
      PostgresTransportClient,
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
    version: 2,
    schema: postgresConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no config changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  result: Versioned<PostgresResult> = new Versioned({
    version: 2,
    schema: postgresResultSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult: Versioned<PostgresAggregatedResult> = new Versioned({
    version: 1,
    schema: postgresAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<PostgresResult>[]
  ): PostgresAggregatedResult {
    const validRuns = runs.filter((r) => r.metadata);

    if (validRuns.length === 0) {
      return {
        avgConnectionTime: 0,
        maxConnectionTime: 0,
        successRate: 0,
        errorCount: 0,
      };
    }

    const connectionTimes = validRuns
      .map((r) => r.metadata?.connectionTimeMs)
      .filter((t): t is number => typeof t === "number");

    const avgConnectionTime =
      connectionTimes.length > 0
        ? Math.round(
            connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length
          )
        : 0;

    const maxConnectionTime =
      connectionTimes.length > 0 ? Math.max(...connectionTimes) : 0;

    const successCount = validRuns.filter(
      (r) => r.metadata?.connected === true
    ).length;
    const successRate = Math.round((successCount / validRuns.length) * 100);

    const errorCount = validRuns.filter(
      (r) => r.metadata?.error !== undefined
    ).length;

    return {
      avgConnectionTime,
      maxConnectionTime,
      successRate,
      errorCount,
    };
  }

  async createClient(
    config: PostgresConfigInput
  ): Promise<ConnectedClient<PostgresTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const connection = await this.dbClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      database: validatedConfig.database,
      user: validatedConfig.user,
      password: validatedConfig.password,
      ssl: validatedConfig.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: validatedConfig.timeout,
    });

    const client: PostgresTransportClient = {
      async exec(request: SqlQueryRequest): Promise<SqlQueryResult> {
        try {
          const result = await connection.query(request.query);
          return { rowCount: result.rowCount ?? 0 };
        } catch (error) {
          return {
            rowCount: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };

    return {
      client,
      close: () => {
        connection.end().catch(() => {
          // Ignore close errors
        });
      },
    };
  }
}
