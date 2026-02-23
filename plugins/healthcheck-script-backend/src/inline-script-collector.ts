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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { spawn } from "bun";
import { SAFE_ENV_VARS } from "./strategy";

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
 * Execute an inline script in a secure child process.
 */
async function executeInlineScript({
  script,
  context,
  timeoutMs,
}: {
  script: string;
  context: ScriptContext;
  timeoutMs: number;
}): Promise<{
  result: ScriptHealthResult | undefined;
  logs: string[];
  error?: string;
  timedOut: boolean;
}> {
  const tmpFile = join(tmpdir(), `checkstack-script-${randomUUID()}.ts`);
  let timedOut = false;

  try {
    // Construct the wrapper script
    // We redirect console output to stderr so we can capture logs
    // We print the result JSON to stdout
    const wrapperScript = `
      const context = ${JSON.stringify({ config: context.config })};

      // Wrap console to redirect to stderr
      const originalConsole = console;
      const safeConsole = {
        log: (...args) => originalConsole.error(...args),
        warn: (...args) => originalConsole.error('[WARN]', ...args),
        error: (...args) => originalConsole.error('[ERROR]', ...args),
        info: (...args) => originalConsole.error('[INFO]', ...args),
      };

      // Apply safe console
      globalThis.console = safeConsole;

      async function runUserScript(context, fetch) {
        // User script
        ${script}
      }

      runUserScript(context, fetch)
        .then(result => {
           // Output result to stdout
           if (result !== undefined) {
             process.stdout.write(JSON.stringify(result));
           }
        })
        .catch(err => {
           // On error, print to stderr and exit 1
           console.error(err instanceof Error ? err.message : String(err));
           process.exit(1);
        });
    `;

    await Bun.write(tmpFile, wrapperScript);

    const safeEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key]!;
      }
    }

    // Spawn process
    const proc = spawn({
      cmd: ["bun", "run", tmpFile],
      env: safeEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error("__TIMEOUT__"));
      }, timeoutMs);
    });

    try {
      const [stdout, stderr] = await Promise.race([
        Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]).then(res => [res[0], res[1]]),
        timeoutPromise,
      ]);

      const logs = stderr.split('\n').filter(line => line.trim().length > 0);

      // Check for error via exit code
      if (proc.exitCode !== 0) {
          return {
             result: undefined,
             logs,
             error: logs.length > 0 ? logs[logs.length - 1] : "Script execution failed",
             timedOut: false
          };
      }

      // Parse result
      let result: ScriptHealthResult | undefined;
      const stdoutTrimmed = stdout.trim();

      if (stdoutTrimmed) {
        try {
          const parsed = JSON.parse(stdoutTrimmed);

          if (typeof parsed === "boolean") {
             result = { success: parsed };
           } else if (typeof parsed === "object") {
             result = {
               success: Boolean(parsed.success ?? true),
               message: parsed.message,
               value: parsed.value,
             };
           } else {
              result = { success: true, message: String(parsed) };
           }
        } catch (e) {
           // If parsing fails, treat entire stdout as message if successful?
           // But exitCode was 0.
           // Maybe user returned a string? "return 'foo'" -> JSON.stringify -> '"foo"' -> JSON.parse -> 'foo'
           // If user returned undefined, we handle it below.
           // If user printed garbage to stdout? (They shouldn't, console is redirected).
           result = { success: true, message: stdoutTrimmed };
        }
      }

      // If success but no result (undefined return)
      if (!result) {
         result = { success: true };
      }

      return { result, logs, timedOut: false };

    } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
        if (message === "__TIMEOUT__") {
          return {
            result: undefined,
            logs: [],
            error: "Script execution timed out",
            timedOut: true,
          };
        }
        throw error;
    }

  } catch (error) {
     const message = error instanceof Error ? error.message : String(error);
     return { result: undefined, logs: [], error: message, timedOut: false };
  } finally {
     try {
       await unlink(tmpFile);
     } catch (e) {
       // Ignore cleanup errors
     }
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

    // Execute the script
    const { result, logs, error, timedOut } = await executeInlineScript({
      script: config.script,
      context: scriptContext,
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
