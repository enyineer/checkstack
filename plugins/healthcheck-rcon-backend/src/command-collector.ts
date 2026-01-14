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
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const commandConfigSchema = z.object({
  command: z.string().min(1).describe("RCON command to execute"),
});

export type CommandConfig = z.infer<typeof commandConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const commandResultSchema = healthResultSchema({
  response: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Response",
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
  }),
});

export type CommandResult = z.infer<typeof commandResultSchema>;

const commandAggregatedSchema = healthResultSchema({
  avgExecutionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
});

export type CommandAggregatedResult = z.infer<typeof commandAggregatedSchema>;

// ============================================================================
// COMMAND COLLECTOR
// ============================================================================

/**
 * Generic RCON command collector.
 * Allows users to run arbitrary RCON commands as check items.
 */
export class CommandCollector
  implements
    CollectorStrategy<
      RconTransportClient,
      CommandConfig,
      CommandResult,
      CommandAggregatedResult
    >
{
  id = "command";
  displayName = "RCON Command";
  description = "Execute an arbitrary RCON command and check the result";

  supportedPlugins = [pluginMetadata];

  /** Allow multiple command instances per config */
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: commandConfigSchema });
  result = new Versioned({ version: 1, schema: commandResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: commandAggregatedSchema,
  });

  async execute({
    config,
    client,
  }: {
    config: CommandConfig;
    client: RconTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<CommandResult>> {
    const startTime = Date.now();
    const result = await client.exec(config.command);
    const executionTimeMs = Date.now() - startTime;

    return {
      result: {
        response: result.response,
        executionTimeMs,
      },
    };
  }

  aggregateResult(
    runs: HealthCheckRunForAggregation<CommandResult>[]
  ): CommandAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.executionTimeMs)
      .filter((v): v is number => typeof v === "number");

    return {
      avgExecutionTimeMs:
        times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
    };
  }
}
