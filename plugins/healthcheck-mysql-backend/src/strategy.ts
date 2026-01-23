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
  configNumber,
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
  MysqlTransportClient,
  SqlQueryRequest,
  SqlQueryResult,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

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
  user: configString({}).describe("Database user"),
  password: configString({ "x-secret": true }).describe("Database password"),
  timeout: configNumber({})
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
});

export type MysqlConfig = z.infer<typeof mysqlConfigSchema>;
export type MysqlConfigInput = z.input<typeof mysqlConfigSchema>;

/**
 * Per-run result metadata.
 */
const mysqlResultSchema = healthResultSchema({
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

type MysqlResult = z.infer<typeof mysqlResultSchema>;

/** Aggregated field definitions for bucket merging */
const mysqlAggregatedFields = {
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

    const connection = await this.dbClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      database: validatedConfig.database,
      user: validatedConfig.user,
      password: validatedConfig.password,
      connectTimeout: validatedConfig.timeout,
    });

    const client: MysqlTransportClient = {
      async exec(request: SqlQueryRequest): Promise<SqlQueryResult> {
        try {
          const result = await connection.query(request.query);
          return { rowCount: result.rowCount };
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
