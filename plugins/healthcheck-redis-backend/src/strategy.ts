import Redis from "ioredis";
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
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  RedisTransportClient,
  RedisCommand,
  RedisCommandResult,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for Redis health checks.
 */
export const redisConfigSchema = z.object({
  host: configString({}).describe("Redis server hostname"),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(6379)
    .describe("Redis port"),
  password: configString({ "x-secret": true })
    .optional()
    .describe("Redis password"),
  database: configNumber({})
    .int()
    .min(0)
    .default(0)
    .describe("Redis database number"),
  tls: configBoolean({}).default(false).describe("Use TLS connection"),
  timeout: configNumber({})
    .min(100)
    .default(5000)
    .describe("Connection timeout in milliseconds"),
});

export type RedisConfig = z.infer<typeof redisConfigSchema>;
export type RedisConfigInput = z.input<typeof redisConfigSchema>;

/**
 * Per-run result metadata.
 */
const redisResultSchema = healthResultSchema({
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

type RedisResult = z.infer<typeof redisResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const redisAggregatedSchema = healthResultSchema({
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

type RedisAggregatedResult = z.infer<typeof redisAggregatedSchema>;

// ============================================================================
// REDIS CLIENT INTERFACE (for testability)
// ============================================================================

export interface RedisConnection {
  ping(): Promise<string>;
  info(section: string): Promise<string>;
  get(key: string): Promise<string | undefined>;
  quit(): Promise<string>;
}

export interface RedisClient {
  connect(config: {
    host: string;
    port: number;
    password?: string;
    db: number;
    tls: boolean;
    connectTimeout: number;
  }): Promise<RedisConnection>;
}

// Default client using ioredis
const defaultRedisClient: RedisClient = {
  connect(config) {
    return new Promise((resolve, reject) => {
      const redis = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        tls: config.tls ? {} : undefined,
        connectTimeout: config.connectTimeout,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
      });

      redis.on("error", reject);

      redis
        .connect()
        .then(() => {
          resolve({
            ping: () => redis.ping(),
            info: (section: string) => redis.info(section),
            get: (key: string) => redis.get(key).then((v) => v ?? undefined),
            quit: () => redis.quit(),
          });
        })
        .catch(reject);
    });
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class RedisHealthCheckStrategy
  implements
    HealthCheckStrategy<
      RedisConfig,
      RedisTransportClient,
      RedisResult,
      RedisAggregatedResult
    >
{
  id = "redis";
  displayName = "Redis Health Check";
  description = "Redis server connectivity and health monitoring";

  private redisClient: RedisClient;

  constructor(redisClient: RedisClient = defaultRedisClient) {
    this.redisClient = redisClient;
  }

  config: Versioned<RedisConfig> = new Versioned({
    version: 2, // Bumped for createClient pattern
    schema: redisConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no config changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  result: Versioned<RedisResult> = new Versioned({
    version: 2,
    schema: redisResultSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult: Versioned<RedisAggregatedResult> = new Versioned({
    version: 1,
    schema: redisAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<RedisResult>[]
  ): RedisAggregatedResult {
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
    config: RedisConfigInput
  ): Promise<ConnectedClient<RedisTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const connection = await this.redisClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      password: validatedConfig.password,
      db: validatedConfig.database,
      tls: validatedConfig.tls,
      connectTimeout: validatedConfig.timeout,
    });

    const client: RedisTransportClient = {
      async exec(command: RedisCommand): Promise<RedisCommandResult> {
        try {
          let value: string | undefined;
          switch (command.cmd) {
            case "PING": {
              value = await connection.ping();
              break;
            }
            case "INFO": {
              value = await connection.info(command.args?.[0] ?? "server");
              break;
            }
            case "GET": {
              value = await connection.get(command.args?.[0] ?? "");
              break;
            }
            default: {
              return {
                value: undefined,
                error: `Unsupported command: ${command.cmd}`,
              };
            }
          }
          return { value };
        } catch (error) {
          return {
            value: undefined,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };

    return {
      client,
      close: () => {
        connection.quit().catch(() => {
          // Ignore quit errors
        });
      },
    };
  }
}
