import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  VersionedAggregated,
  aggregatedAverage,
  type InferAggregatedResult,
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

// Aggregated result fields definition
const commandAggregatedFields = {
  avgExecutionTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
};

// Type inferred from field definitions
export type CommandAggregatedResult = InferAggregatedResult<
  typeof commandAggregatedFields
>;

// ============================================================================
// COMMAND COLLECTOR
// ============================================================================

/**
 * Generic RCON command collector.
 * Allows users to run arbitrary RCON commands as check items.
 */
export class CommandCollector implements CollectorStrategy<
  RconTransportClient,
  CommandConfig,
  CommandResult,
  CommandAggregatedResult
> {
  id = "command";
  displayName = "RCON Command";
  description = "Execute an arbitrary RCON command and check the result";

  supportedPlugins = [pluginMetadata];

  /** Allow multiple command instances per config */
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: commandConfigSchema });
  result = new Versioned({ version: 1, schema: commandResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: commandAggregatedFields,
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

  mergeResult(
    existing: CommandAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<CommandResult>,
  ): CommandAggregatedResult {
    const metadata = run.metadata;

    return {
      avgExecutionTimeMs: mergeAverage(
        existing?.avgExecutionTimeMs,
        metadata?.executionTimeMs,
      ),
    };
  }
}
