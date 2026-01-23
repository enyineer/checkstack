import { spawn, type Subprocess } from "bun";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  aggregatedCounter,
  mergeAverage,
  mergeRate,
  mergeCounter,
  z,
  type ConnectedClient,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  ScriptTransportClient,
  ScriptRequest,
  ScriptResult as ScriptResultType,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for Script health checks.
 * Global defaults only - action params moved to ExecuteCollector.
 */
export const scriptConfigSchema = baseStrategyConfigSchema.extend({});

export type ScriptConfig = z.infer<typeof scriptConfigSchema>;
export type ScriptConfigInput = z.input<typeof scriptConfigSchema>;

// Legacy config type for migrations
interface ScriptConfigV1 {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout: number;
}

/**
 * Per-run result metadata.
 */
const scriptResultSchema = healthResultSchema({
  executed: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Executed",
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
  }),
  exitCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
  }).optional(),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type ScriptResult = z.infer<typeof scriptResultSchema>;

/** Aggregated field definitions for bucket merging */
const scriptAggregatedFields = {
  avgExecutionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
  timeoutCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Timeouts",
  }),
};

type ScriptAggregatedResult = InferAggregatedResult<
  typeof scriptAggregatedFields
>;

// ============================================================================
// SCRIPT EXECUTOR INTERFACE (for testability)
// ============================================================================

interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ScriptExecutor {
  execute(config: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout: number;
  }): Promise<ScriptExecutionResult>;
}

// Default executor using Bun.spawn
const defaultScriptExecutor: ScriptExecutor = {
  async execute(config) {
    let proc: Subprocess | undefined;
    let timedOut = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        proc?.kill();
        reject(new Error("Script execution timed out"));
      }, config.timeout);
    });

    try {
      proc = spawn({
        cmd: [config.command, ...config.args],
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([
          new Response(proc.stdout as ReadableStream).text(),
          new Response(proc.stderr as ReadableStream).text(),
          proc.exited,
        ]),
        timeoutPromise,
      ]);

      return {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false,
      };
    } catch (error) {
      if (timedOut) {
        return {
          exitCode: -1,
          stdout: "",
          stderr: "Script execution timed out",
          timedOut: true,
        };
      }
      throw error;
    }
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class ScriptHealthCheckStrategy implements HealthCheckStrategy<
  ScriptConfig,
  ScriptTransportClient,
  ScriptResult,
  typeof scriptAggregatedFields
> {
  id = "script";
  displayName = "Script Health Check";
  description = "Execute local scripts or commands for health checking";

  private executor: ScriptExecutor;

  constructor(executor: ScriptExecutor = defaultScriptExecutor) {
    this.executor = executor;
  }

  config: Versioned<ScriptConfig> = new Versioned({
    version: 2,
    schema: scriptConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Remove command/args/cwd/env (moved to ExecuteCollector)",
        migrate: (data: ScriptConfigV1): ScriptConfig => ({
          timeout: data.timeout,
        }),
      },
    ],
  });

  result: Versioned<ScriptResult> = new Versioned({
    version: 2,
    schema: scriptResultSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: scriptAggregatedFields,
  });

  mergeResult(
    existing: ScriptAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ScriptResult>,
  ): ScriptAggregatedResult {
    const metadata = run.metadata;

    const avgExecutionTime = mergeAverage(
      existing?.avgExecutionTime,
      metadata?.executionTimeMs,
    );

    const isSuccess = metadata?.success ?? false;
    const successRate = mergeRate(existing?.successRate, isSuccess);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    const hasTimeout = metadata?.timedOut === true;
    const timeoutCount = mergeCounter(existing?.timeoutCount, hasTimeout);

    return { avgExecutionTime, successRate, errorCount, timeoutCount };
  }

  async createClient(
    _config: ScriptConfigInput,
  ): Promise<ConnectedClient<ScriptTransportClient>> {
    const client: ScriptTransportClient = {
      exec: async (request: ScriptRequest): Promise<ScriptResultType> => {
        try {
          const result = await this.executor.execute({
            command: request.command,
            args: request.args,
            cwd: request.cwd,
            env: request.env,
            timeout: request.timeout,
          });

          return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
          };
        } catch (error) {
          return {
            exitCode: -1,
            stdout: "",
            stderr: "",
            timedOut: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };

    return {
      client,
      close: () => {
        // Script executor is stateless, nothing to close
      },
    };
  }
}
