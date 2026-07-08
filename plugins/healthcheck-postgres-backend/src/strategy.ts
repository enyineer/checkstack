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
  configSecret,
  configNumber,
  configBoolean,
  type ConnectedClient,
  type TransportTimings,
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
  // Templatable connection fields: support `{{ environment.host }}` etc. so one
  // config covers N environments. Presence is enforced POST-RENDER in
  // `createClient`. `password` stays a secret (never templatable).
  host: configString({ "x-templatable": true }).describe(
    "PostgreSQL server hostname. Supports templating, e.g. {{ environment.host }}",
  ),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(5432)
    .describe("PostgreSQL port"),
  database: configString({ "x-templatable": true }).describe(
    "Database name. Supports templating, e.g. {{ environment.database }}",
  ),
  user: configString({ "x-templatable": true }).describe(
    "Database user. Supports templating, e.g. {{ environment.user }}",
  ),
  password: configSecret({ id: "password" }).describe("Database password"),
  ssl: configBoolean({}).default(false).describe("Use SSL connection"),
});

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;
export type PostgresConfigInput = z.input<typeof postgresConfigSchema>;

/**
 * Post-render validator for required connection fields. The stored values are
 * plain templatable strings, so presence cannot be checked at store time; the
 * executor renders `{{ environment.* }}` per environment, then this rejects a
 * render that collapsed to empty/whitespace. An empty host/database/user is a
 * config error that prevents the probe - transport-failure semantics.
 */
const renderedRequiredSchema = z.string().trim().min(1);

/**
 * Per-run result metadata.
 */
const postgresResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-good-direction": "up",
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
    "x-chart-priority": 10,
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
    "x-chart-priority": 10,
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
    "x-chart-good-direction": "down",
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
    "x-chart-good-direction": "down",
    "x-chart-priority": 90,
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

    // Post-render guard: the connection fields are templatable strings, so their
    // presence cannot be checked at store time. The executor has already
    // rendered `{{ environment.* }}`; reject a render that collapsed to empty so
    // the run fails clearly instead of attempting an empty connection.
    const rendered = z
      .object({
        host: renderedRequiredSchema,
        database: renderedRequiredSchema,
        user: renderedRequiredSchema,
      })
      .safeParse({
        host: validatedConfig.host,
        database: validatedConfig.database,
        user: validatedConfig.user,
      });
    if (!rendered.success) {
      throw new Error(
        `Rendered PostgreSQL connection fields are empty ` +
          `(host/database/user). Check the {{ environment.* }} templating ` +
          `for this environment.`,
      );
    }

    const connectStart = performance.now();
    const connection = await this.dbClient.connect({
      host: rendered.data.host,
      port: validatedConfig.port,
      database: rendered.data.database,
      user: rendered.data.user,
      password: validatedConfig.password,
      ssl: validatedConfig.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: validatedConfig.timeout,
    });
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    const client: PostgresTransportClient = {
      async exec(request: SqlQueryRequest): Promise<SqlQueryResult> {
        try {
          const queryStart = performance.now();
          const result = await connection.query(request.query);
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - queryStart),
          );
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
      timings,
      close: () => {
        connection.end().catch(() => {
          // Ignore close errors
        });
      },
    };
  }
}
