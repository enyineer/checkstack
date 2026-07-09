import {
  Versioned,
  z,
  configString,
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
  // Templatable: supports `{{ environment.command }}` so one config covers N
  // environments. `.min(1)` still guards the STORED value (a `{{ }}` template is
  // non-empty); the CONCRETE rendered command is re-checked POST-RENDER in
  // `execute` because an empty render must not run as a successful command.
  command: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "Shell command to execute. Supports templating, e.g. {{ environment.command }}",
    ),
});

export type CommandConfig = z.infer<typeof commandConfigSchema>;

/**
 * Post-render validator for the rendered `command`. An empty render (e.g. an
 * env-less run resolving `{{ environment.command }}` to "") is a config error
 * that prevents the probe - transport-failure semantics - not a healthy empty
 * command.
 */
const renderedCommandSchema = z.string().trim().min(1);

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const commandResultSchema = healthResultSchema({
  exitCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
    // Disabled by default: the command is arbitrary and user-supplied, so the
    // exit code has no learnable baseline (many commands legitimately return
    // non-zero, and the meaningful "did it succeed" signal is already carried
    // by the aggregated successRate). Treating exit-code changes as anomalies
    // is a classic alert-fatigue source. Still chartable; users can opt in.
    "x-anomaly-enabled": false,
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
  }),
  stdout: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Standard Output",
    "x-anomaly-enabled": false,
  }),
  stderr: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Standard Error",
    "x-anomaly-enabled": false,
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
});

export type CommandResult = z.infer<typeof commandResultSchema>;

// Aggregated result fields definition
const commandAggregatedFields = {
  avgExecutionTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency: err wider and require sustained slowdown plus practical floors
    // so small jitter on fast commands never alerts.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    // Availability percent: confirm a sustained drop and require a few percent
    // of real movement before alerting.
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
    "x-chart-priority": 20,
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

    // Post-render guard: `command` is a templatable string, so the concrete
    // value is re-validated here after the executor rendered `{{ environment.* }}`.
    // An empty render is a config error - fail as a transport failure rather
    // than running (and "succeeding" at) an empty command.
    const command = renderedCommandSchema.safeParse(config.command);
    if (!command.success) {
      return {
        result: {
          exitCode: 0,
          stdout: "",
          stderr: "",
          executionTimeMs: Date.now() - startTime,
        },
        error:
          `Rendered command is empty: ${JSON.stringify(config.command)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      };
    }

    const result = await client.exec(command.data);
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
