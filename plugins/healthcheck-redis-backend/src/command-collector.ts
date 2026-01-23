import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { RedisTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const commandConfigSchema = z.object({
  command: z
    .enum(["PING", "INFO", "GET"])
    .default("PING")
    .describe("Redis command to execute"),
  args: z
    .string()
    .optional()
    .describe("Command argument (section for INFO, key for GET)"),
});

export type CommandConfig = z.infer<typeof commandConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const commandResultSchema = healthResultSchema({
  response: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Response",
  }).optional(),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
});

export type CommandResult = z.infer<typeof commandResultSchema>;

// Aggregated result fields definition
const commandAggregatedFields = {
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
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
 * Built-in Redis command collector.
 * Executes Redis commands and checks results.
 */
export class CommandCollector implements CollectorStrategy<
  RedisTransportClient,
  CommandConfig,
  CommandResult,
  CommandAggregatedResult
> {
  id = "command";
  displayName = "Redis Command";
  description = "Execute a Redis command and check the result";

  supportedPlugins = [pluginMetadata];

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
    client: RedisTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<CommandResult>> {
    const startTime = Date.now();

    const response = await client.exec({
      cmd: config.command,
      args: config.args ? [config.args] : undefined,
    });

    const responseTimeMs = Date.now() - startTime;

    return {
      result: {
        response: response.value,
        responseTimeMs,
        success: !response.error,
      },
      error: response.error,
    };
  }

  mergeResult(
    existing: CommandAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<CommandResult>,
  ): CommandAggregatedResult {
    const metadata = run.metadata;

    return {
      avgResponseTimeMs: mergeAverage(
        existing?.avgResponseTimeMs,
        metadata?.responseTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, metadata?.success),
    };
  }
}
