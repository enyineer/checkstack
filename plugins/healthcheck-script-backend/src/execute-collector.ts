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
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { ScriptTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const executeConfigSchema = z.object({
  command: configString({
    "x-editor-types": ["shell"],
  }).describe("Shell command or script to execute"),
  args: z.array(z.string()).default([]).describe("Command arguments"),
  cwd: z.string().optional().describe("Working directory"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
  timeout: z
    .number()
    .min(100)
    .default(30_000)
    .describe("Timeout in milliseconds"),
});

export type ExecuteConfig = z.infer<typeof executeConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const executeResultSchema = healthResultSchema({
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
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
  }),
});

export type ExecuteResult = z.infer<typeof executeResultSchema>;

// Aggregated result fields definition
const executeAggregatedFields = {
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
export type ExecuteAggregatedResult = InferAggregatedResult<
  typeof executeAggregatedFields
>;

// ============================================================================
// EXECUTE COLLECTOR
// ============================================================================

/**
 * Built-in Script execute collector.
 * Runs commands and checks results.
 */
export class ExecuteCollector implements CollectorStrategy<
  ScriptTransportClient,
  ExecuteConfig,
  ExecuteResult,
  ExecuteAggregatedResult
> {
  id = "execute";
  displayName = "Execute Script";
  description = "Execute a command or script and check the result";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: executeConfigSchema });
  result = new Versioned({ version: 1, schema: executeResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: executeAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: ExecuteConfig;
    client: ScriptTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<ExecuteResult>> {
    const startTime = Date.now();

    const response = await client.exec({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      timeout: config.timeout,
    });

    const executionTimeMs = Date.now() - startTime;
    const success = response.exitCode === 0 && !response.timedOut;

    return {
      result: {
        exitCode: response.exitCode,
        stdout: response.stdout,
        stderr: response.stderr,
        executionTimeMs,
        success,
        timedOut: response.timedOut,
      },
      error:
        response.error ??
        (success ? undefined : `Exit code: ${response.exitCode}`),
    };
  }

  mergeResult(
    existing: ExecuteAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ExecuteResult>,
  ): ExecuteAggregatedResult {
    const metadata = run.metadata;

    return {
      avgExecutionTimeMs: mergeAverage(
        existing?.avgExecutionTimeMs,
        metadata?.executionTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, metadata?.success),
    };
  }
}
