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

const sourceStatusConfigSchema = z.object({});

export type SourceStatusConfig = z.infer<typeof sourceStatusConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const sourceStatusResultSchema = z.object({
  hostname: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Hostname",
  }).optional(),
  version: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Version",
  }).optional(),
  map: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Map",
  }).optional(),
  humanPlayers: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Human Players",
  }),
  botPlayers: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Bot Players",
  }),
  maxPlayers: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Max Players",
  }),
});

export type SourceStatusResult = z.infer<typeof sourceStatusResultSchema>;

// Aggregated result fields definition
const sourceStatusAggregatedFields = {
  avgHumanPlayers: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Human Players",
  }),
  maxHumanPlayers: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Human Players",
  }),
};

// Type inferred from field definitions
export type SourceStatusAggregatedResult = InferAggregatedResult<
  typeof sourceStatusAggregatedFields
>;

// ============================================================================
// SOURCE STATUS COLLECTOR
// ============================================================================

/**
 * Source engine (CS:GO/CS2) status collector.
 * Runs the "status" command and parses the response.
 *
 * Expected response format:
 * hostname: "Server Name"
 * version : X.X.X.X/X XXX...
 * map     : de_dust2
 * players : X humans, Y bots (Z max)
 */
export class SourceStatusCollector implements CollectorStrategy<
  RconTransportClient,
  SourceStatusConfig,
  SourceStatusResult,
  SourceStatusAggregatedResult
> {
  id = "source-status";
  displayName = "Source Server Status";
  description =
    "Get server status from Source engine games (CS:GO, CS2, etc.) via RCON";

  supportedPlugins = [pluginMetadata];
  allowMultiple = false;

  config = new Versioned({ version: 1, schema: sourceStatusConfigSchema });
  result = new Versioned({ version: 1, schema: sourceStatusResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: sourceStatusAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: SourceStatusConfig;
    client: RconTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<SourceStatusResult>> {
    const { response } = await client.exec("status");

    const parsed = this.parseStatusResponse(response);

    return {
      result: {
        hostname: parsed.hostname,
        version: parsed.version,
        map: parsed.map,
        humanPlayers: parsed.humanPlayers,
        botPlayers: parsed.botPlayers,
        maxPlayers: parsed.maxPlayers,
      },
    };
  }

  /**
   * Parse the Source engine "status" command response.
   */
  private parseStatusResponse(response: string): {
    hostname?: string;
    version?: string;
    map?: string;
    humanPlayers: number;
    botPlayers: number;
    maxPlayers: number;
  } {
    const lines = response.split("\n");
    let hostname: string | undefined;
    let version: string | undefined;
    let map: string | undefined;
    let humanPlayers = 0;
    let botPlayers = 0;
    let maxPlayers = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Parse hostname: "Server Name" or hostname : "Server Name"
      const hostnameMatch = trimmedLine.match(/^hostname\s*:\s*"?([^"]+)"?$/i);
      if (hostnameMatch) {
        hostname = hostnameMatch[1].trim();
        continue;
      }

      // Parse version : X.X.X.X/X XXX...
      const versionMatch = trimmedLine.match(/^version\s*:\s*(.+)$/i);
      if (versionMatch) {
        version = versionMatch[1].trim();
        continue;
      }

      // Parse map : de_dust2
      const mapMatch = trimmedLine.match(/^map\s*:\s*(\S+)/i);
      if (mapMatch) {
        map = mapMatch[1].trim();
        continue;
      }

      // Parse players : X humans, Y bots (Z max)
      const playersMatch = trimmedLine.match(
        /^players\s*:\s*(\d+)\s*humans?,\s*(\d+)\s*bots?\s*\((\d+)\s*max\)/i,
      );
      if (playersMatch) {
        humanPlayers = Number.parseInt(playersMatch[1], 10);
        botPlayers = Number.parseInt(playersMatch[2], 10);
        maxPlayers = Number.parseInt(playersMatch[3], 10);
        continue;
      }
    }

    return { hostname, version, map, humanPlayers, botPlayers, maxPlayers };
  }

  mergeResult(
    existing: SourceStatusAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<SourceStatusResult>,
  ): SourceStatusAggregatedResult {
    const metadata = run.metadata;

    return {
      avgHumanPlayers: mergeAverage(
        existing?.avgHumanPlayers,
        metadata?.humanPlayers,
      ),
      maxHumanPlayers: mergeMinMax(
        existing?.maxHumanPlayers,
        metadata?.humanPlayers,
      ),
    };
  }
}
