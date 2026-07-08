import {
  Versioned,
  z,
  configString,
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
  // Templatable: supports `{{ environment.command }}` so one config covers N
  // environments. `.min(1)` still guards the STORED value (a `{{ }}` template is
  // non-empty); the CONCRETE rendered command is re-checked POST-RENDER in
  // `execute` because an empty render must not run as a successful command.
  command: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "RCON command to execute. Supports templating, e.g. {{ environment.command }}",
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
  response: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Response",
    "x-anomaly-enabled": false,
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Command execution time is a real latency signal. Err wide and require a
    // sustained, practically significant slowdown before alerting.
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
    // Latency: wider band, debounce, and practical floors so small jitter on
    // fast commands does not alert.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
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

    // Post-render guard: `command` is a templatable string, so the concrete
    // value is re-validated here after the executor rendered `{{ environment.* }}`.
    // An empty render is a config error - fail as a transport failure rather
    // than running (and "succeeding" at) an empty command.
    const command = renderedCommandSchema.safeParse(config.command);
    if (!command.success) {
      return {
        result: {
          response: "",
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
