import {
  Versioned,
  z,
  configString,
  configNumber,
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
// SCRIPT EXECUTION UTILITIES (shared with integration-script-backend pattern)
// ============================================================================

/**
 * Context available to inline scripts.
 */
interface ScriptContext {
  /** Health check configuration */
  config: Record<string, unknown>;
  /** Fetch API for HTTP requests */
  fetch: typeof fetch;
}

/**
 * Safe console interface for scripts.
 */
interface SafeConsole {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

/**
 * Expected return type from health check scripts.
 */
interface ScriptHealthResult {
  /** Whether the health check passed */
  success: boolean;
  /** Optional message describing the result */
  message?: string;
  /** Optional numeric value for metrics */
  value?: number;
}

/**
 * Execute an inline script with the given context.
 */
async function executeInlineScript({
  script,
  context,
  safeConsole,
  timeoutMs,
}: {
  script: string;
  context: ScriptContext;
  safeConsole: SafeConsole;
  timeoutMs: number;
}): Promise<{
  result: ScriptHealthResult | undefined;
  error?: string;
  timedOut: boolean;
}> {
  try {
    // Create an async function from the script
    const asyncFn = new Function(
      "context",
      "console",
      "fetch",
      `return (async () => { ${script} })();`,
    );

    // Execute with timeout
    const result = await Promise.race([
      asyncFn(context, safeConsole, fetch),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__TIMEOUT__")), timeoutMs),
      ),
    ]);

    // Normalize result
    if (result === undefined || result === null) {
      return { result: { success: true }, timedOut: false };
    }

    if (typeof result === "boolean") {
      return { result: { success: result }, timedOut: false };
    }

    if (typeof result === "object") {
      return {
        result: {
          success: Boolean(result.success ?? true),
          message: result.message,
          value: result.value,
        },
        timedOut: false,
      };
    }

    return {
      result: { success: true, message: String(result) },
      timedOut: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "__TIMEOUT__") {
      return {
        result: undefined,
        error: "Script execution timed out",
        timedOut: true,
      };
    }
    return { result: undefined, error: message, timedOut: false };
  }
}

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const inlineScriptConfigSchema = z.object({
  script: configString({
    "x-editor-types": ["typescript"],
  }).describe(
    "TypeScript/JavaScript code to execute. Return { success: boolean, message?: string, value?: number }",
  ),
  timeout: configNumber({})
    .min(1000)
    .max(60_000)
    .default(10_000)
    .describe("Maximum execution time in milliseconds"),
});

export type InlineScriptConfig = z.infer<typeof inlineScriptConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const inlineScriptResultSchema = healthResultSchema({
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
  message: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Message",
  }).optional(),
  value: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Value",
  }).optional(),
  executionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Execution Time",
    "x-chart-unit": "ms",
  }),
  timedOut: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Timed Out",
  }),
});

export type InlineScriptResult = z.infer<typeof inlineScriptResultSchema>;

// Aggregated result fields definition
const inlineScriptAggregatedFields = {
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
export type InlineScriptAggregatedResult = InferAggregatedResult<
  typeof inlineScriptAggregatedFields
>;

// ============================================================================
// INLINE SCRIPT COLLECTOR
// ============================================================================

/**
 * Inline Script collector for health checks.
 * Executes TypeScript/JavaScript code directly and checks the result.
 *
 * Scripts should return an object with:
 * - success: boolean - Whether the check passed
 * - message?: string - Optional status message
 * - value?: number - Optional numeric value for metrics
 *
 * Scripts have access to:
 * - context.config - The collector configuration
 * - console.log/warn/error - Logging functions
 * - fetch - HTTP client for making requests
 *
 * @example
 * ```typescript
 * // Simple check
 * return { success: true, message: "All good!" };
 *
 * // HTTP health check
 * const response = await fetch("https://api.example.com/health");
 * return {
 *   success: response.ok,
 *   message: `Status: ${response.status}`,
 *   value: response.status
 * };
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

  async execute({
    config,
  }: {
    config: InlineScriptConfig;
    client: ScriptTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<InlineScriptResult>> {
    const startTime = Date.now();

    // Build context for the script
    const scriptContext: ScriptContext = {
      config: config as unknown as Record<string, unknown>,
      fetch,
    };

    // Create a safe console that captures logs
    const logs: string[] = [];
    const safeConsole: SafeConsole = {
      log: (...args) => {
        logs.push(
          args
            .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
            .join(" "),
        );
      },
      warn: (...args) => {
        logs.push(
          `[WARN] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`,
        );
      },
      error: (...args) => {
        logs.push(
          `[ERROR] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`,
        );
      },
      info: (...args) => {
        logs.push(
          `[INFO] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`,
        );
      },
    };

    // Execute the script
    const { result, error, timedOut } = await executeInlineScript({
      script: config.script,
      context: scriptContext,
      safeConsole,
      timeoutMs: config.timeout,
    });

    const executionTimeMs = Date.now() - startTime;

    if (error) {
      return {
        result: {
          success: false,
          message: error,
          executionTimeMs,
          timedOut,
        },
        error,
      };
    }

    return {
      result: {
        success: result?.success ?? true,
        message:
          result?.message ?? (logs.length > 0 ? logs.join("\n") : undefined),
        value: result?.value,
        executionTimeMs,
        timedOut: false,
      },
      error:
        result?.success === false
          ? (result.message ?? "Check failed")
          : undefined,
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
