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
  defaultShellScriptRunner,
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

// The migrate input is `unknown` per the versioning chain, so narrowing is
// done with `typeof`/`in` guards (no casts).

/** Type guard: the migrate input is a plain object whose keys can be probed. */
function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

/** Read a numeric `timeout` field from a legacy/current config blob. */
function readTimeout(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.timeout;
  return typeof value === "number" ? value : undefined;
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
 * Default executor — delegates to the shared `ShellScriptRunner` in
 * `@checkstack/backend-api`. That module is the canonical home for the
 * `sh -c` + safe-env-vars + timeout/kill/cleanup pattern (also used by
 * the integration shell provider). This thin adapter exists so tests
 * can substitute a mock for `ScriptExecutor` without touching the
 * shared runner.
 */
const defaultScriptExecutor: ScriptExecutor = {
  async execute(config) {
    return defaultShellScriptRunner.run({
      script: config.script,
      timeoutMs: config.timeout,
      cwd: config.cwd,
      env: config.env,
    });
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
        // IDEMPOTENT: only a genuine v1 blob still carries `command`. An
        // already-v2 blob (just `{ timeout }`) passes through untouched.
        migrate: (data: unknown): unknown => {
          if (isRecord(data) && "command" in data) {
            return { timeout: readTimeout(data) };
          }
          return data;
        },
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
