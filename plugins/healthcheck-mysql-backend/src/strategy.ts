import mysql from "mysql2/promise";
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
  MysqlTransportClient,
  SqlQueryRequest,
  SqlQueryResult,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for MySQL health checks.
 */
export const mysqlConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable connection fields: support `{{ environment.host }}` etc. so one
  // config covers N environments. Presence is enforced POST-RENDER in
  // `createClient`. `password` stays a secret (never templatable - see
  // assertNoSecretTemplatableConflict).
  host: configString({ "x-templatable": true }).describe(
    "MySQL server hostname. Supports templating, e.g. {{ environment.host }}",
  ),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(3306)
    .describe("MySQL port"),
  database: configString({ "x-templatable": true }).describe(
    "Database name. Supports templating, e.g. {{ environment.database }}",
  ),
  user: configString({ "x-templatable": true }).describe(
    "Database user. Supports templating, e.g. {{ environment.user }}",
  ),
  password: configSecret({ id: "password" }).describe("Database password"),
});

export type MysqlConfig = z.infer<typeof mysqlConfigSchema>;
export type MysqlConfigInput = z.input<typeof mysqlConfigSchema>;

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
const mysqlResultSchema = healthResultSchema({
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
    // Err wider so small jitter on a fast connection does not alert.
    "x-anomaly-sensitivity": 2.5,
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

type MysqlResult = z.infer<typeof mysqlResultSchema>;

/** Aggregated field definitions for bucket merging */
const mysqlAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  maxConnectionTime: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
    "x-chart-unit": "ms",
    // Max within a bucket is dominated by single transient spikes, so a learned
    // baseline over it is highly noisy. Avg connection time already covers the
    // latency signal, so this is off by default and remains chartable.
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
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
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Raw error count scales with how many checks landed in the bucket, so its
    // baseline drifts with cadence rather than health. Success rate (percent)
    // is the stable twin for this signal, so the absolute count is off by
    // default and remains chartable.
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
    "x-chart-priority": 90,
  }),
};

type MysqlAggregatedResult = InferAggregatedResult<
  typeof mysqlAggregatedFields
>;

// ============================================================================
// DATABASE CLIENT INTERFACE (for testability)
// ============================================================================

interface DbQueryResult {
  rowCount: number;
}

interface DbConnection {
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
        const [rows] = await connection.execute(sql);
        return { rowCount: Array.isArray(rows) ? rows.length : 0 };
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

export class MysqlHealthCheckStrategy implements HealthCheckStrategy<
  MysqlConfig,
  MysqlTransportClient,
  MysqlResult,
  typeof mysqlAggregatedFields
> {
  id = "mysql";
  displayName = "MySQL Health Check";
  description = "MySQL database connectivity and query health check";
  category = StrategyCategory.DATABASE;

  private dbClient: DbClient;

  constructor(dbClient: DbClient = defaultDbClient) {
    this.dbClient = dbClient;
  }

  config: Versioned<MysqlConfig> = new Versioned({
    version: 2,
    schema: mysqlConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no config changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  result: Versioned<MysqlResult> = new Versioned({
    version: 2,
    schema: mysqlResultSchema,
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
    fields: mysqlAggregatedFields,
  });

  mergeResult(
    existing: MysqlAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<MysqlResult>,
  ): MysqlAggregatedResult {
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
    config: MysqlConfigInput,
  ): Promise<ConnectedClient<MysqlTransportClient>> {
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
        `Rendered MySQL connection fields are empty ` +
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
      connectTimeout: validatedConfig.timeout,
    });
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    const client: MysqlTransportClient = {
      async exec(request: SqlQueryRequest): Promise<SqlQueryResult> {
        try {
          const queryStart = performance.now();
          const result = await connection.query(request.query);
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - queryStart),
          );
          return { rowCount: result.rowCount };
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
