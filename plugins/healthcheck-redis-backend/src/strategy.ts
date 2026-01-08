import Redis from "ioredis";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  timeThresholdField,
  booleanField,
  enumField,
  configString,
  configNumber,
  configBoolean,
  evaluateAssertions,
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
 * Valid Redis server roles from the INFO replication command.
 */
const RedisRole = z.enum(["master", "slave", "sentinel"]);
export type RedisRole = z.infer<typeof RedisRole>;

/**
 * Assertion schema for Redis health checks using shared factories.
 */
const redisAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("connectionTime"),
  timeThresholdField("pingTime"),
  booleanField("pingSuccess"),
  enumField("role", RedisRole.options),
]);

export type RedisAssertion = z.infer<typeof redisAssertionSchema>;

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
    .describe("Password for authentication")
    .optional(),
  database: configNumber({}).int().min(0).default(0).describe("Database index"),
  tls: configBoolean({}).default(false).describe("Use TLS connection"),
  timeout: configNumber({})
    .min(100)
    .default(5000)
    .describe("Connection timeout in milliseconds"),
  assertions: z
    .array(redisAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type RedisConfig = z.infer<typeof redisConfigSchema>;
export type RedisConfigInput = z.input<typeof redisConfigSchema>;

/**
 * Per-run result metadata.
 */
const redisResultSchema = z.object({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  pingTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Ping Time",
    "x-chart-unit": "ms",
  }).optional(),
  pingSuccess: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Ping Success",
  }),
  role: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Role",
  }).optional(),
  redisVersion: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Redis Version",
  }).optional(),
  failedAssertion: redisAssertionSchema.optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

export type RedisResult = z.infer<typeof redisResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const redisAggregatedSchema = z.object({
  avgConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  avgPingTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Ping Time",
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

export type RedisAggregatedResult = z.infer<typeof redisAggregatedSchema>;

// ============================================================================
// REDIS CLIENT INTERFACE (for testability)
// ============================================================================

export interface RedisConnection {
  ping(): Promise<string>;
  info(section: string): Promise<string>;
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
  async connect(config) {
    const redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      tls: config.tls ? {} : undefined,
      connectTimeout: config.connectTimeout,
      lazyConnect: true,
    });

    await redis.connect();

    return {
      ping: () => redis.ping(),
      info: (section: string) => redis.info(section),
      quit: () => redis.quit(),
    };
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class RedisHealthCheckStrategy
  implements
    HealthCheckStrategy<RedisConfig, RedisResult, RedisAggregatedResult>
{
  id = "redis";
  displayName = "Redis Health Check";
  description = "Redis server connectivity and health monitoring";

  private redisClient: RedisClient;

  constructor(redisClient: RedisClient = defaultRedisClient) {
    this.redisClient = redisClient;
  }

  config: Versioned<RedisConfig> = new Versioned({
    version: 1,
    schema: redisConfigSchema,
  });

  result: Versioned<RedisResult> = new Versioned({
    version: 1,
    schema: redisResultSchema,
  });

  aggregatedResult: Versioned<RedisAggregatedResult> = new Versioned({
    version: 1,
    schema: redisAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<RedisResult>[]
  ): RedisAggregatedResult {
    let totalConnectionTime = 0;
    let totalPingTime = 0;
    let successCount = 0;
    let errorCount = 0;
    let validRuns = 0;
    let pingRuns = 0;

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
        if (run.metadata.pingTimeMs !== undefined) {
          totalPingTime += run.metadata.pingTimeMs;
          pingRuns++;
        }
        validRuns++;
      }
    }

    return {
      avgConnectionTime: validRuns > 0 ? totalConnectionTime / validRuns : 0,
      avgPingTime: pingRuns > 0 ? totalPingTime / pingRuns : 0,
      successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      errorCount,
    };
  }

  async execute(
    config: RedisConfigInput
  ): Promise<HealthCheckResult<RedisResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      // Connect to Redis
      const connection = await this.redisClient.connect({
        host: validatedConfig.host,
        port: validatedConfig.port,
        password: validatedConfig.password,
        db: validatedConfig.database,
        tls: validatedConfig.tls,
        connectTimeout: validatedConfig.timeout,
      });

      const connectionTimeMs = Math.round(performance.now() - start);

      // Execute PING command
      const pingStart = performance.now();
      let pingSuccess = false;
      let pingTimeMs: number | undefined;

      try {
        const pong = await connection.ping();
        pingSuccess = pong === "PONG";
        pingTimeMs = Math.round(performance.now() - pingStart);
      } catch {
        pingSuccess = false;
        pingTimeMs = Math.round(performance.now() - pingStart);
      }

      // Get server info
      let role: string | undefined;
      let redisVersion: string | undefined;

      try {
        const info = await connection.info("server");
        const roleMatch = /role:(\w+)/i.exec(info);
        const versionMatch = /redis_version:([^\r\n]+)/i.exec(info);
        role = roleMatch?.[1];
        redisVersion = versionMatch?.[1];
      } catch {
        // Info command failed, continue without it
      }

      await connection.quit();

      const result: Omit<RedisResult, "failedAssertion" | "error"> = {
        connected: true,
        connectionTimeMs,
        pingTimeMs,
        pingSuccess,
        role,
        redisVersion,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        connectionTime: connectionTimeMs,
        pingTime: pingTimeMs ?? 0,
        pingSuccess,
        role: role ?? "",
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs + (pingTimeMs ?? 0),
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      if (!pingSuccess) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs + (pingTimeMs ?? 0),
          message: "Redis PING failed",
          metadata: result,
        };
      }

      return {
        status: "healthy",
        latencyMs: connectionTimeMs + (pingTimeMs ?? 0),
        message: `Redis ${redisVersion ?? "unknown"} (${
          role ?? "unknown"
        }) - PONG in ${pingTimeMs}ms`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "Redis connection failed",
        metadata: {
          connected: false,
          connectionTimeMs: Math.round(end - start),
          pingSuccess: false,
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
