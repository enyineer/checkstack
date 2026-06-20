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
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  PostgresTransportClient,
  SqlQueryRequest,
  SqlQueryResult,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for PostgreSQL health checks.
 */
export const postgresConfigSchema = baseStrategyConfigSchema.extend({
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
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type PostgresResult = z.infer<typeof postgresResultSchema>;

/** Aggregated field definitions for bucket merging */
const postgresAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Connection latency saturation. Err wider and require sustained drift plus
    // a practical floor so a fast handshake is not flagged on small jitter.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  maxConnectionTime: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
    "x-chart-unit": "ms",
    // The per-bucket maximum is inherently spiky: one slow handshake (GC pause,
    // transient network blip) moves it sharply, so baselining it produces noisy
    // alerts. Average connection time already covers the latency-saturation
    // signal, so the max is off by default and remains chartable.
    "x-anomaly-enabled": false,
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
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Raw error count per bucket scales with check frequency and bucket size,
    // so it has no stable universal baseline. Success rate already expresses
    // failures as a normalized percent, so this absolute twin is off by default
    // to avoid duplicate, volume-sensitive alerts.
    "x-anomaly-enabled": false,
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
  category = StrategyCategory.DATABASE;

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
            error: extractErrorMessage(error),
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
