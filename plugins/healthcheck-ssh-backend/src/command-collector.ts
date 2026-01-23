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
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata as sshPluginMetadata } from "./plugin-metadata";
import type { SshTransportClient } from "@checkstack/healthcheck-ssh-common";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const commandConfigSchema = z.object({
  command: z.string().min(1).describe("Shell command to execute"),
});

export type CommandConfig = z.infer<typeof commandConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const commandResultSchema = healthResultSchema({
  exitCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
  }),
  stdout: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Standard Output",
  }),
  stderr: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Standard Error",
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
// COMMAND COLLECTOR (PSEUDO-COLLECTOR)
// ============================================================================

/**
 * Built-in command collector for SSH strategy.
 * Allows users to run arbitrary shell commands as check items.
 * This is the "basic mode" functionality exposed as a collector.
 */
export class CommandCollector implements CollectorStrategy<
  SshTransportClient,
  CommandConfig,
  CommandResult,
  CommandAggregatedResult
> {
  /**
   * ID for this collector.
   * Built-in collectors are identified by ownerPlugin matching the strategy's plugin.
   * Fully-qualified: healthcheck-ssh.command
   */
  id = "command";
  displayName = "Shell Command";
  description = "Execute a shell command and check the result";

  supportedPlugins = [sshPluginMetadata];

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
    client: SshTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<CommandResult>> {
    const startTime = Date.now();
    const result = await client.exec(config.command);
    const executionTimeMs = Date.now() - startTime;

    return {
      result: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        executionTimeMs,
      },
    };
  }

  mergeResult(
    existing: CommandAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<CommandResult>,
  ): CommandAggregatedResult {
    const metadata = run.metadata;

    // Success is exit code 0
    return {
      avgExecutionTimeMs: mergeAverage(
        existing?.avgExecutionTimeMs,
        metadata?.executionTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, metadata?.exitCode === 0),
    };
  }
}
