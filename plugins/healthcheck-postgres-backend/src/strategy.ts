import { Client, type ClientConfig } from "pg";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  aggregatedRate,
  aggregatedCounter,
  mergeAverage,
  mergeRate,
  mergeCounter,
  mergeMinMax,
  z,
  configString,
  configNumber,
  configBoolean,
  type ConnectedClient,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
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
const postgresResultSchema = healthResultSchema({
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

/** Aggregated field definitions for bucket merging */
const postgresAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  maxConnectionTime: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
};

type PostgresAggregatedResult = InferAggregatedResult<
  typeof postgresAggregatedFields
>;

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

export class PostgresHealthCheckStrategy implements HealthCheckStrategy<
  PostgresConfig,
  PostgresTransportClient,
  PostgresResult,
  typeof postgresAggregatedFields
> {
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

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: postgresAggregatedFields,
  });

  mergeResult(
    existing: PostgresAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<PostgresResult>,
  ): PostgresAggregatedResult {
    const metadata = run.metadata;

    const avgConnectionTime = mergeAverage(
      existing?.avgConnectionTime,
      metadata?.connectionTimeMs,
    );

    const maxConnectionTime = mergeMinMax(
      existing?.maxConnectionTime,
      metadata?.connectionTimeMs,
    );

    const isSuccess = metadata?.connected ?? false;
    const successRate = mergeRate(existing?.successRate, isSuccess);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { avgConnectionTime, maxConnectionTime, successRate, errorCount };
  }

  async createClient(
    config: PostgresConfigInput,
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
