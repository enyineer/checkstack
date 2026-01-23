import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeMinMax,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "../plugin-metadata";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const minecraftServerConfigSchema = z.object({
  includeTps: z
    .boolean()
    .default(false)
    .describe("Include TPS (Paper/Spigot servers only)"),
});

export type MinecraftServerConfig = z.infer<typeof minecraftServerConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const minecraftServerResultSchema = z.object({
  motd: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "MOTD",
  }).optional(),
  tps: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "TPS",
  }).optional(),
});

export type MinecraftServerResult = z.infer<typeof minecraftServerResultSchema>;

// Aggregated result fields definition
const minecraftServerAggregatedFields = {
  avgTps: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg TPS",
  }),
  minTps: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Min TPS",
  }),
};

// Type inferred from field definitions
export type MinecraftServerAggregatedResult = InferAggregatedResult<
  typeof minecraftServerAggregatedFields
>;

// ============================================================================
// MINECRAFT SERVER COLLECTOR
// ============================================================================

/**
 * Minecraft server info collector.
 * Can optionally collect TPS for Paper/Spigot servers.
 */
export class MinecraftServerCollector implements CollectorStrategy<
  RconTransportClient,
  MinecraftServerConfig,
  MinecraftServerResult,
  MinecraftServerAggregatedResult
> {
  id = "minecraft-server";
  displayName = "Minecraft Server";
  description =
    "Get server info from Minecraft server, optionally including TPS for Paper/Spigot";

  supportedPlugins = [pluginMetadata];
  allowMultiple = false;

  config = new Versioned({ version: 1, schema: minecraftServerConfigSchema });
  result = new Versioned({ version: 1, schema: minecraftServerResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: minecraftServerAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: MinecraftServerConfig;
    client: RconTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<MinecraftServerResult>> {
    const result: MinecraftServerResult = {};

    // Get TPS if enabled (Paper/Spigot servers)
    if (config.includeTps) {
      try {
        const tpsResponse = await client.exec("tps");
        result.tps = this.parseTpsResponse(tpsResponse.response);
      } catch {
        // TPS command may not be available on vanilla servers
      }
    }

    return { result };
  }

  /**
   * Parse TPS from Paper/Spigot server response.
   * Format varies, but commonly: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0"
   * or "§6TPS from last 1m, 5m, 15m: §a*20.0, §a*20.0, §a*20.0"
   */
  private parseTpsResponse(response: string): number | undefined {
    // Remove color codes (§X format) and asterisks
    const cleaned = response
      .replaceAll(/§[0-9a-fk-or]/gi, "")
      .replaceAll("*", "");

    // Look for TPS values after the colon
    // Format: "TPS from last 1m, 5m, 15m: 19.5, 19.8, 20.0"
    const colonIndex = cleaned.indexOf(":");
    if (colonIndex !== -1) {
      const valuesSection = cleaned.slice(colonIndex + 1);
      const match = valuesSection.match(/(\d+\.?\d*)/);
      if (match) {
        const tps = Number.parseFloat(match[1]);
        if (!Number.isNaN(tps) && tps >= 0 && tps <= 20) {
          return Math.round(tps * 10) / 10;
        }
      }
    }

    return undefined;
  }

  mergeResult(
    existing: MinecraftServerAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<MinecraftServerResult>,
  ): MinecraftServerAggregatedResult {
    const metadata = run.metadata;

    const avgState = mergeAverage(existing?.avgTps, metadata?.tps);
    const minState = mergeMinMax(existing?.minTps, metadata?.tps);

    return {
      avgTps: { ...avgState, avg: Math.round(avgState.avg * 10) / 10 },
      minTps: minState,
    };
  }
}
