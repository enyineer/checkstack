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

const commandAggregatedSchema = healthResultSchema({
  avgResponseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
});

export type CommandAggregatedResult = z.infer<typeof commandAggregatedSchema>;

// ============================================================================
// COMMAND COLLECTOR
// ============================================================================

/**
 * Built-in Redis command collector.
 * Executes Redis commands and checks results.
 */
export class CommandCollector
  implements
    CollectorStrategy<
      RedisTransportClient,
      CommandConfig,
      CommandResult,
      CommandAggregatedResult
    >
{
  id = "command";
  displayName = "Redis Command";
  description = "Execute a Redis command and check the result";

  supportedPlugins = [pluginMetadata];

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

  aggregateResult(
    runs: HealthCheckRunForAggregation<CommandResult>[]
  ): CommandAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.responseTimeMs)
      .filter((v): v is number => typeof v === "number");

    const successes = runs
      .map((r) => r.metadata?.success)
      .filter((v): v is boolean => typeof v === "boolean");

    const successCount = successes.filter(Boolean).length;

    return {
      avgResponseTimeMs:
        times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
      successRate:
        successes.length > 0
          ? Math.round((successCount / successes.length) * 100)
          : 0,
    };
  }
}
