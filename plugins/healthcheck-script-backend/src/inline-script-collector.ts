import {
  Versioned,
  z,
  configString,
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
import { secretEnvMappingSchema } from "@checkstack/secrets-common";
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
  }): Promise<InlineScriptExecutionResult>;
}

/**
 * Default executor — delegates to the shared `EsmScriptRunner`. Wires
 * `globalThis.context = { config, check?, system? }` (the inline
 * health-check runtime surface) and the virtual `@checkstack/healthcheck`
 * module / global `defineHealthCheck` helper.
 */
export const defaultInlineScriptExecutor: InlineScriptExecutor = {
  async execute({ script, config, timeoutMs, runContext, resolutionRoot }) {
    const res: EsmScriptRunResult = await defaultEsmScriptRunner.run({
      script,
      context: {
        config,
        ...(runContext
          ? { check: runContext.check, system: runContext.system }
          : {}),
      },
      timeoutMs,
      helperModuleName: "@checkstack/healthcheck",
      helperFunctionName: "defineHealthCheck",
      ...(resolutionRoot ? { resolutionRoot } : {}),
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
    "TypeScript/JavaScript module. Use `import { ... } from \"node:os\"` to pull in Node built-ins. The recommended pattern is `export default defineHealthCheck({ success, message?, value? })` — `defineHealthCheck` is provided by `@checkstack/healthcheck` and asserts the return shape at the type level. Throwing also signals failure.",
  ),
  secretEnv: secretEnvMappingSchema
    .optional()
    .describe(
      'Secret → env mapping, e.g. { "API_TOKEN": "${{ secrets.token }}" }. NOTE: collectors run on satellites; secret injection is delivered just-in-time in Phase 3. This phase only authors + validates the mapping (it is NOT injected yet).',
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
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  message: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Message",
    "x-anomaly-enabled": false,
  }).optional(),
  value: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Value",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "deviation",
  }).optional(),
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
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
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
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
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
 * `return X;`. `globalThis.context` exposes `{ config }` for access to the
 * collector configuration.
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
  }: {
    config: InlineScriptConfig;
    client: ScriptTransportClient;
    pluginId: string;
    runContext?: CollectorRunContext;
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

    let exec: InlineScriptExecutionResult;
    try {
      exec = await this.executor.execute({
        script: config.script,
        config: config as unknown as Record<string, unknown>,
        timeoutMs: config.timeout,
        runContext,
        ...(resolutionRoot ? { resolutionRoot } : {}),
      });
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
