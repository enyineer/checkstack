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
  RedisTransportClient,
  RedisCommand,
  RedisCommandResult,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for Redis health checks.
 */
export const redisConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable connection field: supports `{{ environment.host }}` etc. so one
  // config covers N environments. Presence is enforced POST-RENDER in
  // `createClient`. `password` stays a secret (never templatable).
  host: configString({ "x-templatable": true }).describe(
    "Redis server hostname. Supports templating, e.g. {{ environment.host }}",
  ),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(6379)
    .describe("Redis port"),
  password: configSecret({ id: "password" })
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
 * Post-render validator for the required `host`. The stored value is a plain
 * templatable string, so presence cannot be checked at store time; the executor
 * renders `{{ environment.* }}` per environment, then this rejects a render that
 * collapsed to empty/whitespace. An empty host is a config error that prevents
 * the probe - transport-failure semantics.
 */
const renderedRequiredSchema = z.string().trim().min(1);

/**
 * Per-run result metadata.
 */
const redisResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-priority": 20,
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

type RedisResult = z.infer<typeof redisResultSchema>;

/** Aggregated field definitions for bucket merging */
const redisAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency: bias toward fewer alerts. Wider band, debounce, and both an
    // absolute floor (tens of ms) and a relative floor so small jitter on a
    // fast connection never alerts.
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
    // Per-bucket max captures the single worst sample, which spikes
    // run-to-run with no stable baseline. Keep it chartable but do not alert
    // on it: avgConnectionTime already carries the latency signal.
    "x-anomaly-enabled": false,
    "x-chart-priority": 30,
    "x-chart-good-direction": "down",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    // Availability rate: debounce a single bad bucket and require a few
    // percent of real movement before alerting.
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
    "x-chart-priority": 20,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Raw error count scales with bucket volume and traffic, so it has no
    // stable baseline. The failure signal is already covered by successRate
    // as a percent, so keep this chartable but off by default.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
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
  category = StrategyCategory.DATABASE;

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

    // Post-render guard: `host` is a templatable string, so its presence cannot
    // be checked at store time. The executor has already rendered
    // `{{ environment.* }}`; reject a render that collapsed to empty so the run
    // fails clearly instead of attempting an empty connection.
    const host = renderedRequiredSchema.safeParse(validatedConfig.host);
    if (!host.success) {
      throw new Error(
        `Rendered host is empty: ${JSON.stringify(validatedConfig.host)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }

    const connectStart = performance.now();
    const connection = await this.redisClient.connect({
      host: host.data,
      port: validatedConfig.port,
      password: validatedConfig.password,
      db: validatedConfig.database,
      tls: validatedConfig.tls,
      connectTimeout: validatedConfig.timeout,
    });
    // Connect + auth + db select all happen inside the single connect call.
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    const client: RedisTransportClient = {
      async exec(command: RedisCommand): Promise<RedisCommandResult> {
        const cmdStart = performance.now();
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
            error: extractErrorMessage(error),
          };
        } finally {
          // Same timings reference returned on the client; last command wins.
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - cmdStart),
          );
        }
      },
    };

    return {
      client,
      timings,
      close: () => {
        connection.quit().catch(() => {
          // Ignore quit errors
        });
      },
    };
  }
}
