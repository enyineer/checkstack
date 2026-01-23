import Redis from "ioredis";
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
export const redisConfigSchema = baseStrategyConfigSchema.extend({
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

/** Aggregated field definitions for bucket merging */
const redisAggregatedFields = {
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

type RedisAggregatedResult = InferAggregatedResult<
  typeof redisAggregatedFields
>;

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

export class RedisHealthCheckStrategy implements HealthCheckStrategy<
  RedisConfig,
  RedisTransportClient,
  RedisResult,
  typeof redisAggregatedFields
> {
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

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: redisAggregatedFields,
  });

  mergeResult(
    existing: RedisAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<RedisResult>,
  ): RedisAggregatedResult {
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
    config: RedisConfigInput,
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
