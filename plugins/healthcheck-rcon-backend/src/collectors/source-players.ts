import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
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

const sourcePlayersConfigSchema = z.object({});

export type SourcePlayersConfig = z.infer<typeof sourcePlayersConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const sourcePlayersResultSchema = z.object({
  playerCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Player Count",
  }),
  playerNames: z.array(
    healthResultString({
      "x-chart-type": "text",
      "x-chart-label": "Player",
    })
  ),
});

export type SourcePlayersResult = z.infer<typeof sourcePlayersResultSchema>;

const sourcePlayersAggregatedSchema = z.object({
  avgPlayerCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Player Count",
  }),
  maxPlayerCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Player Count",
  }),
});

export type SourcePlayersAggregatedResult = z.infer<
  typeof sourcePlayersAggregatedSchema
>;

// ============================================================================
// SOURCE PLAYERS COLLECTOR
// ============================================================================

/**
 * Source engine player list collector.
 * Runs the "status" command and extracts player names from the player table.
 *
 * Player entries format:
 * # userid name uniqueid connected ping loss state rate
 * # 2 "PlayerName" STEAM_1:0:12345678 05:23 42 0 active 196608
 */
export class SourcePlayersCollector
  implements
    CollectorStrategy<
      RconTransportClient,
      SourcePlayersConfig,
      SourcePlayersResult,
      SourcePlayersAggregatedResult
    >
{
  id = "source-players";
  displayName = "Source Player List";
  description =
    "Get player list from Source engine games (CS:GO, CS2, etc.) via RCON status";

  supportedPlugins = [pluginMetadata];
  allowMultiple = false;

  config = new Versioned({ version: 1, schema: sourcePlayersConfigSchema });
  result = new Versioned({ version: 1, schema: sourcePlayersResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: sourcePlayersAggregatedSchema,
  });

  async execute({
    client,
  }: {
    config: SourcePlayersConfig;
    client: RconTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<SourcePlayersResult>> {
    const { response } = await client.exec("status");

    const playerNames = this.parsePlayerList(response);

    return {
      result: {
        playerCount: playerNames.length,
        playerNames,
      },
    };
  }

  /**
   * Parse player list from Source engine "status" command response.
   * Players are listed after the header line:
   * # userid name uniqueid connected ping loss state rate
   */
  private parsePlayerList(response: string): string[] {
    const lines = response.split("\n");
    const playerNames: string[] = [];
    let inPlayerSection = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Detect start of player section
      if (trimmedLine.startsWith("# userid")) {
        inPlayerSection = true;
        continue;
      }

      // Parse player entries (lines starting with #)
      if (inPlayerSection && trimmedLine.startsWith("#")) {
        // Format: # 2 "PlayerName" STEAM_1:0:12345678 ...
        const nameMatch = trimmedLine.match(/#\s*\d+\s+"([^"]+)"/);
        if (nameMatch) {
          playerNames.push(nameMatch[1]);
        }
      }
    }

    return playerNames;
  }

  aggregateResult(
    runs: HealthCheckRunForAggregation<SourcePlayersResult>[]
  ): SourcePlayersAggregatedResult {
    const playerCounts = runs
      .map((r) => r.metadata?.playerCount)
      .filter((v): v is number => typeof v === "number");

    return {
      avgPlayerCount:
        playerCounts.length > 0
          ? Math.round(
              playerCounts.reduce((a, b) => a + b, 0) / playerCounts.length
            )
          : 0,
      maxPlayerCount: playerCounts.length > 0 ? Math.max(...playerCounts) : 0,
    };
  }
}
