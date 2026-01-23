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

const minecraftPlayersConfigSchema = z.object({});

export type MinecraftPlayersConfig = z.infer<
  typeof minecraftPlayersConfigSchema
>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const minecraftPlayersResultSchema = z.object({
  onlinePlayers: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Online Players",
  }),
  maxPlayers: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Max Players",
  }),
  playerNames: z.array(
    healthResultString({
      "x-chart-type": "text",
      "x-chart-label": "Player",
    }),
  ),
});

export type MinecraftPlayersResult = z.infer<
  typeof minecraftPlayersResultSchema
>;

// Aggregated result fields definition
const minecraftPlayersAggregatedFields = {
  avgOnlinePlayers: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Online Players",
  }),
  maxOnlinePlayers: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Online Players",
  }),
};

// Type inferred from field definitions
export type MinecraftPlayersAggregatedResult = InferAggregatedResult<
  typeof minecraftPlayersAggregatedFields
>;

// ============================================================================
// MINECRAFT PLAYERS COLLECTOR
// ============================================================================

/**
 * Minecraft player list collector.
 * Runs the "list" command and parses the response.
 *
 * Expected response format:
 * "There are X of a max of Y players online: Name1, Name2, ..."
 */
export class MinecraftPlayersCollector implements CollectorStrategy<
  RconTransportClient,
  MinecraftPlayersConfig,
  MinecraftPlayersResult,
  MinecraftPlayersAggregatedResult
> {
  id = "minecraft-players";
  displayName = "Minecraft Players";
  description =
    "Get player count and list from Minecraft server via RCON list command";

  supportedPlugins = [pluginMetadata];
  allowMultiple = false;

  config = new Versioned({ version: 1, schema: minecraftPlayersConfigSchema });
  result = new Versioned({ version: 1, schema: minecraftPlayersResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: minecraftPlayersAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: MinecraftPlayersConfig;
    client: RconTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<MinecraftPlayersResult>> {
    const { response } = await client.exec("list");

    const parsed = this.parseListResponse(response);

    return {
      result: {
        onlinePlayers: parsed.onlinePlayers,
        maxPlayers: parsed.maxPlayers,
        playerNames: parsed.playerNames,
      },
    };
  }

  /**
   * Parse the Minecraft "list" command response.
   * Format: "There are X of a max of Y players online: Name1, Name2, ..."
   */
  private parseListResponse(response: string): {
    onlinePlayers: number;
    maxPlayers: number;
    playerNames: string[];
  } {
    // Match: "There are X of a max of Y players online: ..."
    const countMatch = response.match(
      /There are (\d+) of a max of (\d+) players online/i,
    );

    const onlinePlayers = countMatch ? Number.parseInt(countMatch[1], 10) : 0;
    const maxPlayers = countMatch ? Number.parseInt(countMatch[2], 10) : 0;

    // Extract player names after the colon
    const colonIndex = response.indexOf(":");
    let playerNames: string[] = [];

    if (colonIndex !== -1 && onlinePlayers > 0) {
      const namesStr = response.slice(colonIndex + 1).trim();
      if (namesStr) {
        playerNames = namesStr
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0);
      }
    }

    return { onlinePlayers, maxPlayers, playerNames };
  }

  mergeResult(
    existing: MinecraftPlayersAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<MinecraftPlayersResult>,
  ): MinecraftPlayersAggregatedResult {
    const metadata = run.metadata;

    return {
      avgOnlinePlayers: mergeAverage(
        existing?.avgOnlinePlayers,
        metadata?.onlinePlayers,
      ),
      maxOnlinePlayers: mergeMinMax(
        existing?.maxOnlinePlayers,
        metadata?.onlinePlayers,
      ),
    };
  }
}
