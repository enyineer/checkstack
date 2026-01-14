import RCON from "rcon-srcds";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  configString,
  configNumber,
  type ConnectedClient,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for RCON health checks.
 */
export const rconConfigSchema = z.object({
  host: z.string().describe("RCON server hostname"),
  port: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(25_575)
    .describe("RCON port (25575 for Minecraft, 27015 for Source)"),
  password: configString({ "x-secret": true }).describe("RCON password"),
  timeout: configNumber({})
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
});

export type RconConfig = z.infer<typeof rconConfigSchema>;
export type RconConfigInput = z.input<typeof rconConfigSchema>;

/**
 * Per-run result metadata.
 */
const rconResultSchema = healthResultSchema({
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

type RconResult = z.infer<typeof rconResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const rconAggregatedSchema = healthResultSchema({
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

type RconAggregatedResult = z.infer<typeof rconAggregatedSchema>;

// ============================================================================
// RCON CLIENT INTERFACE (for testability)
// ============================================================================

export interface RconConnection {
  command(cmd: string): Promise<string>;
  disconnect(): void;
}

export interface RconClient {
  connect(config: {
    host: string;
    port: number;
    password: string;
    timeout: number;
  }): Promise<RconConnection>;
}

// Default client using rcon-srcds
const defaultRconClient: RconClient = {
  async connect(config) {
    const rcon = new RCON({
      host: config.host,
      port: config.port,
      timeout: config.timeout,
    });

    await rcon.authenticate(config.password);

    return {
      async command(cmd: string): Promise<string> {
        const result = await rcon.execute(cmd);
        // rcon.execute can return boolean for some commands, coerce to string
        return typeof result === "string" ? result : String(result);
      },
      disconnect() {
        rcon.disconnect();
      },
    };
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class RconHealthCheckStrategy
  implements
    HealthCheckStrategy<
      RconConfig,
      RconTransportClient,
      RconResult,
      RconAggregatedResult
    >
{
  id = "rcon";
  displayName = "RCON Health Check";
  description =
    "Game server connectivity via RCON protocol (Minecraft, CS:GO, etc.)";

  private rconClient: RconClient;

  constructor(rconClient: RconClient = defaultRconClient) {
    this.rconClient = rconClient;
  }

  config: Versioned<RconConfig> = new Versioned({
    version: 1,
    schema: rconConfigSchema,
  });

  result: Versioned<RconResult> = new Versioned({
    version: 1,
    schema: rconResultSchema,
  });

  aggregatedResult: Versioned<RconAggregatedResult> = new Versioned({
    version: 1,
    schema: rconAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<RconResult>[]
  ): RconAggregatedResult {
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

  /**
   * Create a connected RCON transport client.
   */
  async createClient(
    config: RconConfigInput
  ): Promise<ConnectedClient<RconTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const connection = await this.rconClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      password: validatedConfig.password,
      timeout: validatedConfig.timeout,
    });

    return {
      client: {
        exec: async (command: string) => {
          const response = await connection.command(command);
          return { response };
        },
      },
      close: () => connection.disconnect(),
    };
  }
}
