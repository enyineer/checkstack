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
    "x-chart-true-label": "executed",
    "x-chart-false-label": "not executed",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-priority": 30,
    "x-chart-good-direction": "up",
  }),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  exitCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
    // Arbitrary integer with no stable distribution; the pass/fail signal
    // it carries is already covered by `success`. Keep chartable only.
    "x-anomaly-enabled": false,
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
  }).optional(),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
    "x-chart-true-label": "successful",
    "x-chart-false-label": "failing",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-priority": 20,
    "x-chart-good-direction": "up",
  }),
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
    "x-chart-true-label": "timed out",
    "x-chart-false-label": "completed in time",
    // Always implies `success: false`; alerting here as well double-fires
    // on the same incident. Keep chartable, let `success` carry the alert.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type ScriptResult = z.infer<typeof scriptResultSchema>;

/**
 * Shape of the RUN-level metadata the executor actually stores for a
 * collector-based script check. The per-collector result lives under
 * `metadata.collectors[<entryId>]`; each entry carries the platform-added
 * `_collectorError` (a GENUINE transport error string, or absent on success),
 * the stripped `timedOut` metric, and - IGNORED here - `_assertionFailed` (an
 * assertion outcome, NOT a transport failure). A catastrophic run that failed
 * before any collector produced an entry carries a top-level `error` instead.
 * Extra keys (including `_assertionFailed`) are stripped by the default parse,
 * so this reads only the transport signals without touching assertion state.
 */
const runTransportMetadataSchema = z.object({
  error: z.string().nullish(),
  collectors: z
    .record(
      z.string(),
      z.object({
        _collectorError: z.string().nullish(),
        timedOut: z.boolean().optional(),
      }),
    )
    .optional(),
});

interface RunTransportOutcome {
  /** The probe could not complete (a genuine transport failure or timeout). */
  hasError: boolean;
  /** The probe was aborted by a timeout specifically. */
  hasTimeout: boolean;
}

/** True when a nullish/optional error string carries an actual message. */
function isNonEmptyError(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Classify a run's TRANSPORT outcome from its stored metadata, per the
 * health-check collector semantics rule: success/error reflect only whether the
 * probe COMPLETED, INDEPENDENT of assertion outcomes. An assertion failure
 * (`_assertionFailed`) makes the run `unhealthy` but is deliberately NOT read
 * here - it must not lower the success rate or count as an error.
 */
function classifyRunTransport(metadata: unknown): RunTransportOutcome {
  const parsed = runTransportMetadataSchema.safeParse(metadata);
  if (!parsed.success) return { hasError: false, hasTimeout: false };

  let hasError = isNonEmptyError(parsed.data.error);
  let hasTimeout = false;
  for (const entry of Object.values(parsed.data.collectors ?? {})) {
    if (isNonEmptyError(entry._collectorError)) hasError = true;
    if (entry.timedOut === true) hasTimeout = true;
  }

  // A timeout is a transport failure. Both collectors set `error` on timeout so
  // it is already covered, but fold it in explicitly so a timeout can never be
  // read as a success even if a future collector flags only `timedOut`.
  if (hasTimeout) hasError = true;

  return { hasError, hasTimeout };
}

/** Aggregated field definitions for bucket merging */
const scriptAggregatedFields = {
  avgExecutionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Execution Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2.5,
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
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
    "x-chart-priority": 20,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Raw per-bucket count is the absolute twin of `successRate`; it scales
    // with bucket volume and has no stable baseline. Prefer the percent
    // form (`successRate`) for alerting and keep this chartable only.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
  }),
  timeoutCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Timeouts",
    // Same as errorCount: a volume-scaled absolute twin of the failure
    // rate already expressed by `successRate`. Chartable only.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
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
    // The metadata the executor passes here is the RUN metadata (with the
    // per-collector results under `metadata.collectors`), NOT the strategy's
    // own `ScriptResult` shape - see the note in the body. Typed as the generic
    // run metadata so the code reads what actually arrives at runtime.
    run: HealthCheckRunForAggregation,
  ): ScriptAggregatedResult {
    // In the collector-based execution model the strategy no longer produces a
    // top-level per-run result: the executor stores each collector's `success` /
    // `executionTimeMs` / `timedOut` (and the transport-error signal
    // `_collectorError`) under `metadata.collectors[<entryId>]`. Reading
    // `metadata.success` / `metadata.executionTimeMs` (the pre-collector shape)
    // therefore always saw `undefined`, which `mergeRate` / `mergeAverage` fold
    // into rate 0 / avg 0 - the "0% success, 0ms" aggregate tiles.
    //
    // Success Rate and Errors are TRANSPORT-level metrics (did the probe run?),
    // INDEPENDENT of assertion outcomes - the platform convention shared by
    // every other strategy (see .claude/rules/healthcheck-collectors.md). We must
    // NOT use `run.status`: it goes `unhealthy` on an assertion failure too, so
    // it cannot distinguish a genuine transport error from a completed-but-
    // asserted-failing run. Classify from the collector transport signals
    // instead; `avgExecutionTime` stays the run's wall-clock latency.
    const { hasError, hasTimeout } = classifyRunTransport(run.metadata);

    const successRate = mergeRate(existing?.successRate, !hasError);

    const avgExecutionTime = mergeAverage(
      existing?.avgExecutionTime,
      run.latencyMs,
    );

    const errorCount = mergeCounter(existing?.errorCount, hasError);
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
