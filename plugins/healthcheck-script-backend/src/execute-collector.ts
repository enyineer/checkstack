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
import type { ScriptTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const executeConfigSchema = z.object({
  command: z.string().min(1).describe("Command or script path to execute"),
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

const executeAggregatedSchema = healthResultSchema({
  avgExecutionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
});

export type ExecuteAggregatedResult = z.infer<typeof executeAggregatedSchema>;

// ============================================================================
// EXECUTE COLLECTOR
// ============================================================================

/**
 * Built-in Script execute collector.
 * Runs commands and checks results.
 */
export class ExecuteCollector
  implements
    CollectorStrategy<
      ScriptTransportClient,
      ExecuteConfig,
      ExecuteResult,
      ExecuteAggregatedResult
    >
{
  id = "execute";
  displayName = "Execute Script";
  description = "Execute a command or script and check the result";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: executeConfigSchema });
  result = new Versioned({ version: 1, schema: executeResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: executeAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<ExecuteResult>[]
  ): ExecuteAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.executionTimeMs)
      .filter((v): v is number => typeof v === "number");

    const successes = runs
      .map((r) => r.metadata?.success)
      .filter((v): v is boolean => typeof v === "boolean");

    const successCount = successes.filter(Boolean).length;

    return {
      avgExecutionTimeMs:
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
