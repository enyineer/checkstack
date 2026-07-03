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

const sourcePlayersConfigSchema = z.object({});

export type SourcePlayersConfig = z.infer<typeof sourcePlayersConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const sourcePlayersResultSchema = z.object({
  playerCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Player Count",
    // Player population swings widely run to run (empty off peak, full at
    // peak) with no stable baseline and no good or bad direction. Charting it
    // is useful, but baseline anomaly detection here is pure alert fatigue.
    "x-anomaly-enabled": false,
    "x-chart-priority": 10,
  }),
  playerNames: z.array(
    healthResultString({
      "x-chart-type": "text",
      "x-chart-label": "Player",
      "x-anomaly-enabled": false,
    }),
  ),
});

export type SourcePlayersResult = z.infer<typeof sourcePlayersResultSchema>;

// Aggregated result fields definition
const sourcePlayersAggregatedFields = {
  avgPlayerCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Player Count",
    // Same volatile population signal as the per-run player count. No stable
    // baseline, no good or bad direction: chart only, do not alert.
    "x-anomaly-enabled": false,
    "x-chart-priority": 10,
  }),
  maxPlayerCount: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Player Count",
    "x-anomaly-enabled": false,
    "x-chart-priority": 30,
  }),
};

// Type inferred from field definitions
export type SourcePlayersAggregatedResult = InferAggregatedResult<
  typeof sourcePlayersAggregatedFields
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
export class SourcePlayersCollector implements CollectorStrategy<
  RconTransportClient,
  SourcePlayersConfig,
  SourcePlayersResult,
  SourcePlayersAggregatedResult
> {
  id = "source-players";
  displayName = "Source Player List";
  description =
    "Get player list from Source engine games (CS:GO, CS2, etc.) via RCON status";

  supportedPlugins = [pluginMetadata];
  allowMultiple = false;

  config = new Versioned({ version: 1, schema: sourcePlayersConfigSchema });
  result = new Versioned({ version: 1, schema: sourcePlayersResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: sourcePlayersAggregatedFields,
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

  mergeResult(
    existing: SourcePlayersAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<SourcePlayersResult>,
  ): SourcePlayersAggregatedResult {
    const metadata = run.metadata;

    return {
      avgPlayerCount: mergeAverage(
        existing?.avgPlayerCount,
        metadata?.playerCount,
      ),
      maxPlayerCount: mergeMinMax(
        existing?.maxPlayerCount,
        metadata?.playerCount,
      ),
    };
  }
}
