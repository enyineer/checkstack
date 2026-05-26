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
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  ScriptTransportClient,
  ScriptRequest,
  ScriptResult as ScriptResultType,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for Script health checks.
 * Global defaults only - action params live on the per-collector schema.
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
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
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
  }),
  exitCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }).optional(),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type ScriptResult = z.infer<typeof scriptResultSchema>;

/** Aggregated field definitions for bucket merging */
const scriptAggregatedFields = {
  avgExecutionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  timeoutCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Timeouts",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
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
    script: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout: number;
  }): Promise<ScriptExecutionResult>;
}

/**
 * Environment variables forwarded to user scripts.
 *
 * The full parent environment is _not_ forwarded by design: many backend
 * processes hold secrets (DB URLs, API tokens, signing keys) in their env,
 * and a user-authored script — even a trusted one — should not be a place
 * those leak from. PATH, HOME, LANG etc. are kept so ordinary commands
 * (awk, curl, etc.) can still be found and behave correctly.
 */
const SAFE_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "HOSTNAME",
  "SHELL",
];

/**
 * Concurrency note: this executor is stateless — every call gets its own
 * subprocess, its own pipes, and its own timeout. There are no shared
 * temp files for the shell path (the user's script is fed to `sh -c`
 * directly via argv), so two concurrent shell checks can't possibly
 * collide on disk.
 *
 * Cleanup is in `finally`: the timeout handle is cleared so a fast
 * script doesn't leak an event-loop timer, and any straggler subprocess
 * is `.kill()`-ed defensively even if we're returning normally.
 */
const defaultScriptExecutor: ScriptExecutor = {
  async execute(config) {
    let proc: Subprocess | undefined;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc?.kill();
        reject(new Error("Script execution timed out"));
      }, config.timeout);
    });

    const safeEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key]!;
      }
    }

    try {
      // Execute through `sh -c` so the user's script can use pipes,
      // redirects, variable expansion, conditionals, etc. — i.e. behave
      // like a real shell script rather than a single argv vector.
      proc = spawn({
        cmd: ["sh", "-c", config.script],
        cwd: config.cwd,
        env: { ...safeEnv, ...config.env },
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
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      // Idempotent — no-op when the subprocess has already exited cleanly,
      // but guarantees we never leave a runaway `sh` from an exception path.
      proc?.kill();
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
  category = StrategyCategory.INFRASTRUCTURE;

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
            script: request.script,
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
            error: extractErrorMessage(error),
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
