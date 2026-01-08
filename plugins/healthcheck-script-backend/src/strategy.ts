import { spawn, type Subprocess } from "bun";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  timeThresholdField,
  numericField,
  booleanField,
  stringField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
} from "@checkmate-monitor/healthcheck-common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for Script health checks using shared factories.
 */
const scriptAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("executionTime"),
  numericField("exitCode", { min: 0 }),
  booleanField("success"),
  stringField("stdout"),
]);

export type ScriptAssertion = z.infer<typeof scriptAssertionSchema>;

/**
 * Configuration schema for Script health checks.
 */
export const scriptConfigSchema = z.object({
  command: z.string().describe("Command or script path to execute"),
  args: z
    .array(z.string())
    .default([])
    .describe("Arguments to pass to the command"),
  cwd: z.string().optional().describe("Working directory for script execution"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables to set"),
  timeout: z
    .number()
    .min(100)
    .default(30_000)
    .describe("Execution timeout in milliseconds"),
  assertions: z
    .array(scriptAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type ScriptConfig = z.infer<typeof scriptConfigSchema>;
export type ScriptConfigInput = z.input<typeof scriptConfigSchema>;

/**
 * Per-run result metadata.
 */
const scriptResultSchema = z.object({
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
  stdout: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Stdout",
  }).optional(),
  stderr: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Stderr",
  }).optional(),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
  }),
  failedAssertion: scriptAssertionSchema.optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

export type ScriptResult = z.infer<typeof scriptResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const scriptAggregatedSchema = z.object({
  avgExecutionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
  timeoutCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Timeouts",
  }),
});

export type ScriptAggregatedResult = z.infer<typeof scriptAggregatedSchema>;

// ============================================================================
// SCRIPT EXECUTOR INTERFACE (for testability)
// ============================================================================

export interface ScriptExecutionResult {
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

    const execPromise = (async () => {
      proc = spawn({
        cmd: [config.command, ...config.args],
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdoutStream = proc.stdout;
      const stderrStream = proc.stderr;
      const stdout = stdoutStream
        ? await new Response(stdoutStream as unknown as ReadableStream).text()
        : "";
      const stderr = stderrStream
        ? await new Response(stderrStream as unknown as ReadableStream).text()
        : "";
      const exitCode = await proc.exited;

      return {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false,
      };
    })();

    try {
      return await Promise.race([execPromise, timeoutPromise]);
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

export class ScriptHealthCheckStrategy
  implements
    HealthCheckStrategy<ScriptConfig, ScriptResult, ScriptAggregatedResult>
{
  id = "script";
  displayName = "Script Health Check";
  description = "Execute local scripts or commands for health checking";

  private executor: ScriptExecutor;

  constructor(executor: ScriptExecutor = defaultScriptExecutor) {
    this.executor = executor;
  }

  config: Versioned<ScriptConfig> = new Versioned({
    version: 1,
    schema: scriptConfigSchema,
  });

  result: Versioned<ScriptResult> = new Versioned({
    version: 1,
    schema: scriptResultSchema,
  });

  aggregatedResult: Versioned<ScriptAggregatedResult> = new Versioned({
    version: 1,
    schema: scriptAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<ScriptResult>[]
  ): ScriptAggregatedResult {
    let totalExecutionTime = 0;
    let successCount = 0;
    let errorCount = 0;
    let timeoutCount = 0;
    let validRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.metadata?.timedOut) {
        timeoutCount++;
      }
      if (run.status === "healthy") {
        successCount++;
      }
      if (run.metadata) {
        totalExecutionTime += run.metadata.executionTimeMs;
        validRuns++;
      }
    }

    return {
      avgExecutionTime: validRuns > 0 ? totalExecutionTime / validRuns : 0,
      successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      errorCount,
      timeoutCount,
    };
  }

  async execute(
    config: ScriptConfigInput
  ): Promise<HealthCheckResult<ScriptResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      const execResult = await this.executor.execute({
        command: validatedConfig.command,
        args: validatedConfig.args,
        cwd: validatedConfig.cwd,
        env: validatedConfig.env as Record<string, string> | undefined,
        timeout: validatedConfig.timeout,
      });

      const executionTimeMs = Math.round(performance.now() - start);
      const success = execResult.exitCode === 0 && !execResult.timedOut;

      const result: Omit<ScriptResult, "failedAssertion" | "error"> = {
        executed: true,
        executionTimeMs,
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        success,
        timedOut: execResult.timedOut,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        executionTime: executionTimeMs,
        exitCode: execResult.exitCode,
        success,
        stdout: execResult.stdout,
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: executionTimeMs,
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      if (execResult.timedOut) {
        return {
          status: "unhealthy",
          latencyMs: executionTimeMs,
          message: `Script timed out after ${validatedConfig.timeout}ms`,
          metadata: result,
        };
      }

      if (!success) {
        return {
          status: "unhealthy",
          latencyMs: executionTimeMs,
          message: `Script failed with exit code ${execResult.exitCode}`,
          metadata: result,
        };
      }

      return {
        status: "healthy",
        latencyMs: executionTimeMs,
        message: `Script executed successfully (exit 0) in ${executionTimeMs}ms`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "Script execution failed",
        metadata: {
          executed: false,
          executionTimeMs: Math.round(end - start),
          success: false,
          timedOut: false,
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
