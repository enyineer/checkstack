import {
  Versioned,
  z,
  configString,
  withConfigMeta,
  requestTimeoutMs,
  defaultEsmScriptRunner,
  type EsmScriptRunResult,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
  type CollectorRunContext,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { ScriptTransportClient } from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";
import {
  secretEnvMappingSchema,
  maskScriptRunOutput,
} from "@checkstack/secrets-common";
import type { ResolutionRootStatus } from "@checkstack/script-packages-backend";

// ============================================================================
// EXECUTOR ADAPTER
// ============================================================================
//
// The collector keeps its own injectable `InlineScriptExecutor`
// interface for backwards-compatible test mocks. In production it
// wraps the shared `EsmScriptRunner` from `@checkstack/backend-api` —
// the canonical subprocess sandbox shared with the integration-script
// provider. See `core/backend-api/src/esm-script-runner.ts` for the
// isolation + cleanup model.

/**
 * Shape returned by an inline-script executor. Mirrors
 * `EsmScriptRunResult` from the shared runner, kept as a separate
 * interface so the test surface of this collector doesn't have to
 * import from backend-api just to construct a mock.
 */
export interface InlineScriptExecutionResult {
  result?: unknown;
  error?: string;
  stack?: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface InlineScriptExecutor {
  execute(input: {
    script: string;
    config: Record<string, unknown>;
    timeoutMs: number;
    runContext?: CollectorRunContext;
    /** Managed npm-package resolution root for this run, if ready. */
    resolutionRoot?: string;
    /** Resolved secret env injected into the runner for this run only. */
    secretEnv?: Record<string, string>;
  }): Promise<InlineScriptExecutionResult>;
}

/**
 * Default executor — delegates to the shared `EsmScriptRunner`. Wires
 * `globalThis.context = { config, check?, system?, environment? }` (the
 * inline health-check runtime surface) and the `@checkstack/sdk/healthcheck`
 * module / global `defineHealthCheck` helper.
 */
export const defaultInlineScriptExecutor: InlineScriptExecutor = {
  async execute({
    script,
    config,
    timeoutMs,
    runContext,
    resolutionRoot,
    secretEnv,
  }) {
    const res: EsmScriptRunResult = await defaultEsmScriptRunner.run({
      script,
      context: {
        config,
        ...(runContext
          ? {
              check: runContext.check,
              system: runContext.system,
              ...(runContext.environment
                ? { environment: runContext.environment }
                : {}),
            }
          : {}),
      },
      timeoutMs,
      helperModuleName: "@checkstack/sdk/healthcheck",
      helperFunctionName: "defineHealthCheck",
      ...(resolutionRoot ? { resolutionRoot } : {}),
      // Inject the resolved secrets as process.env for THIS run only.
      ...(secretEnv && Object.keys(secretEnv).length > 0
        ? { env: secretEnv }
        : {}),
    });
    return res;
  },
};

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const inlineScriptConfigSchema = z.object({
  script: configString({
    "x-editor-types": ["typescript"],
    "x-script-testable": true,
  }).describe(
    "TypeScript/JavaScript module. Use `import { ... } from \"node:os\"` to pull in Node built-ins. The recommended pattern is `export default defineHealthCheck({ success, message?, value? })` — `defineHealthCheck` is provided by `@checkstack/sdk/healthcheck` and asserts the return shape at the type level. Throwing also signals failure.",
  ),
  secretEnv: withConfigMeta(secretEnvMappingSchema, { "x-secret-env": true })
    .optional()
    .describe(
      'Secret → env mapping, e.g. { "API_TOKEN": "${{ secrets.token }}" }. Only the named secrets are resolved and injected for this run (read via process.env.API_TOKEN / $API_TOKEN); on a satellite they are delivered just-in-time over the encrypted channel, never persisted. Values are masked out of the collector output.',
    ),
  timeout: requestTimeoutMs().describe("Maximum execution time in milliseconds"),
});

export type InlineScriptConfig = z.infer<typeof inlineScriptConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const inlineScriptResultSchema = healthResultSchema({
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
  message: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Message",
    "x-anomaly-enabled": false,
  }).optional(),
  value: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Value",
    // Free-form user-returned number with no stable baseline and no
    // universal good/bad direction (it could be a load average, a queue
    // depth, a row count, anything). A learned band over an arbitrary
    // value is the core alert-fatigue case, so do not alert by default.
    // It stays fully chartable and a user can opt in per check.
    "x-anomaly-enabled": false,
  }).optional(),
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
});

export type InlineScriptResult = z.infer<typeof inlineScriptResultSchema>;

// Aggregated result fields definition
const inlineScriptAggregatedFields = {
  avgExecutionTimeMs: aggregatedAverage({
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
};

// Type inferred from field definitions
export type InlineScriptAggregatedResult = InferAggregatedResult<
  typeof inlineScriptAggregatedFields
>;

// ============================================================================
// RESULT NORMALISATION
// ============================================================================

interface NormalisedScriptResult {
  success: boolean;
  message?: string;
  value?: number;
}

function normaliseScriptReturn(raw: unknown): NormalisedScriptResult {
  if (raw === undefined || raw === null) {
    return { success: true };
  }
  if (typeof raw === "boolean") {
    return { success: raw };
  }
  if (typeof raw === "number") {
    return { success: true, value: raw };
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      success: typeof obj.success === "boolean" ? obj.success : true,
      message: typeof obj.message === "string" ? obj.message : undefined,
      value: typeof obj.value === "number" ? obj.value : undefined,
    };
  }
  return { success: true, message: String(raw) };
}

// ============================================================================
// INLINE SCRIPT COLLECTOR
// ============================================================================

/**
 * Inline Script collector for health checks.
 *
 * The user writes a TypeScript/JavaScript ES module. It can `import` from
 * Node built-ins (`node:os`, `node:fs/promises`, `node:child_process`,
 * `node:crypto`, ...), use top-level `await`, and signal its result either
 * via `export default` or — for backwards compatibility — a top-level
 * `return X;`. `globalThis.context` exposes `{ config, check?, system?,
 * environment? }` — the collector configuration plus curated run-context
 * metadata. `context.environment` (when the run resolved one) carries
 * `{ id, name, fields }`, where `fields` is the environment's custom
 * metadata, e.g. `globalThis.context.environment.fields.baseUrl`.
 *
 * Subprocess isolation, env scrubbing, temp-dir lifecycle and result
 * marshalling all live in the shared `EsmScriptRunner` in
 * `@checkstack/backend-api`. This collector is just the schema +
 * result-shape glue.
 *
 * @example Modern (ES module)
 * ```ts
 * import { loadavg } from "node:os";
 * const load = loadavg()[0];
 * export default {
 *   success: load < 0.6,
 *   message: `Load: ${load.toFixed(2)}`,
 *   value: load,
 * };
 * ```
 *
 * @example Legacy (still works)
 * ```ts
 * return { success: true, message: "All good!" };
 * ```
 */
export class InlineScriptCollector implements CollectorStrategy<
  ScriptTransportClient,
  InlineScriptConfig,
  InlineScriptResult,
  InlineScriptAggregatedResult
> {
  id = "inline-script";
  displayName = "Inline Script";
  description = "Execute TypeScript/JavaScript code for health checking";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: inlineScriptConfigSchema });
  result = new Versioned({ version: 1, schema: inlineScriptResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: inlineScriptAggregatedFields,
  });

  private executor: InlineScriptExecutor;
  private getResolutionRoot?: () => Promise<ResolutionRootStatus>;

  constructor(
    executor: InlineScriptExecutor = defaultInlineScriptExecutor,
    getResolutionRoot?: () => Promise<ResolutionRootStatus>,
  ) {
    this.executor = executor;
    this.getResolutionRoot = getResolutionRoot;
  }

  async execute({
    config,
    runContext,
    secretEnv,
  }: {
    config: InlineScriptConfig;
    client: ScriptTransportClient;
    pluginId: string;
    runContext?: CollectorRunContext;
    secretEnv?: Record<string, string>;
  }): Promise<CollectorResult<InlineScriptResult>> {
    const startTime = Date.now();

    // Resolve the managed npm-package root. `notReady` -> fail clearly;
    // `none` -> unset (no packages); `ready` -> point the runner at it.
    const rootStatus = await this.getResolutionRoot?.();
    if (rootStatus?.mode === "notReady") {
      return {
        result: {
          success: false,
          message: rootStatus.reason,
          executionTimeMs: Date.now() - startTime,
          timedOut: false,
        },
        error: rootStatus.reason,
      };
    }
    const resolutionRoot =
      rootStatus?.mode === "ready" ? rootStatus.root : undefined;

    // Source-side masking values: the run's delivered secret values.
    const maskValues = Object.values(secretEnv ?? {});

    // The OS-level sandbox is GLOBAL-only and resolved by the runner itself
    // (durable cluster default on the core pod, or fail-closed). No per-item
    // override is applied here.
    let exec: InlineScriptExecutionResult;
    try {
      const raw = await this.executor.execute({
        script: config.script,
        config: config as unknown as Record<string, unknown>,
        timeoutMs: config.timeout,
        runContext,
        ...(resolutionRoot ? { resolutionRoot } : {}),
        ...(secretEnv ? { secretEnv } : {}),
      });
      // Redact the delivered secret values from the captured output BEFORE
      // any of it leaves the satellite (defense in depth: core masks again
      // on receipt). A script echoing a secret it was given is masked here.
      // `raw` carries `stdout`/`stderr` (required by ScriptRunOutput) plus
      // `timedOut`, so the masked result keeps the full shape.
      exec = maskScriptRunOutput({ output: raw, values: maskValues });
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const message = extractErrorMessage(error);
      return {
        result: {
          success: false,
          message,
          executionTimeMs,
          timedOut: false,
        },
        error: message,
      };
    }

    const executionTimeMs = Date.now() - startTime;

    if (exec.timedOut) {
      return {
        result: {
          success: false,
          message: exec.error ?? "Script execution timed out",
          executionTimeMs,
          timedOut: true,
        },
        error: exec.error ?? "Script execution timed out",
      };
    }

    if (exec.error !== undefined) {
      return {
        result: {
          success: false,
          message: exec.error,
          executionTimeMs,
          timedOut: false,
        },
        error: exec.error,
      };
    }

    const normalised = normaliseScriptReturn(exec.result);
    const fallbackMessage =
      exec.stdout.length > 0 ? exec.stdout : undefined;

    return {
      result: {
        success: normalised.success,
        message: normalised.message ?? fallbackMessage,
        value: normalised.value,
        executionTimeMs,
        timedOut: false,
      },
      error: normalised.success
        ? undefined
        : (normalised.message ?? "Check failed"),
    };
  }

  mergeResult(
    existing: InlineScriptAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<InlineScriptResult>,
  ): InlineScriptAggregatedResult {
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
