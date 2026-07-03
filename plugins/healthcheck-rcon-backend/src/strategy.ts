import RCON from "rcon-srcds";
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
  configSecret,
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
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for RCON health checks.
 */
export const rconConfigSchema = baseStrategyConfigSchema.extend({
  host: z.string().describe("RCON server hostname"),
  port: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(25_575)
    .describe("RCON port (25575 for Minecraft, 27015 for Source)"),
  password: configSecret({ id: "password" }).describe("RCON password"),
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

type RconResult = z.infer<typeof rconResultSchema>;

/** Aggregated field definitions for bucket merging */
const rconAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency: wider band, debounce, and practical floors.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  maxConnectionTime: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
    "x-chart-unit": "ms",
    // The per-bucket maximum is dominated by single slow outliers and is far
    // noisier than the average twin, which we keep enabled. Disable to avoid
    // alert fatigue from one-off connection spikes.
    "x-anomaly-enabled": false,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    // Availability percent: a sustained drop is a real problem.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Raw per-bucket error counts vary with traffic and bucket boundaries and
    // have no stable baseline. Success rate already covers failures as a
    // normalized percent, so disable this absolute twin.
    "x-anomaly-enabled": false,
  }),
};

type RconAggregatedResult = InferAggregatedResult<typeof rconAggregatedFields>;

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

export class RconHealthCheckStrategy implements HealthCheckStrategy<
  RconConfig,
  RconTransportClient,
  RconResult,
  typeof rconAggregatedFields
> {
  id = "rcon";
  displayName = "RCON Health Check";
  description =
    "Game server connectivity via RCON protocol (Minecraft, CS:GO, etc.)";
  category = StrategyCategory.GAMING;

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

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: rconAggregatedFields,
  });

  mergeResult(
    existing: RconAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<RconResult>,
  ): RconAggregatedResult {
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

  /**
   * Create a connected RCON transport client.
   */
  async createClient(
    config: RconConfigInput,
  ): Promise<ConnectedClient<RconTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const connectStart = performance.now();
    const connection = await this.rconClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      password: validatedConfig.password,
      timeout: validatedConfig.timeout,
    });
    // connect() establishes the socket and authenticates in one step.
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    return {
      client: {
        exec: async (command: string) => {
          const cmdStart = performance.now();
          const response = await connection.command(command);
          // Same timings reference returned below; last command wins.
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - cmdStart),
          );
          return { response };
        },
      },
      timings,
      close: () => connection.disconnect(),
    };
  }
}
