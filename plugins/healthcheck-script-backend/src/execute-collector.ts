import {
  Versioned,
  z,
  configString,
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

// ============================================================================
// RUN-CONTEXT ENV INJECTION
// ============================================================================
//
// Reserved env var names exposing curated run-context metadata to the
// shell script. These mirror the automation `CHECKSTACK_` shell
// convention; intentionally NOT imported from automation-common to keep
// this plugin's dependency surface minimal.

const CHECKSTACK_CHECK_ID = "CHECKSTACK_CHECK_ID";
const CHECKSTACK_CHECK_NAME = "CHECKSTACK_CHECK_NAME";
const CHECKSTACK_CHECK_INTERVAL_SECONDS = "CHECKSTACK_CHECK_INTERVAL_SECONDS";
const CHECKSTACK_SYSTEM_ID = "CHECKSTACK_SYSTEM_ID";
const CHECKSTACK_SYSTEM_NAME = "CHECKSTACK_SYSTEM_NAME";

/**
 * Map curated run-context metadata to the reserved `CHECKSTACK_*` env
 * vars exposed to the shell script.
 */
function runContextEnv(ctx: CollectorRunContext): Record<string, string> {
  return {
    [CHECKSTACK_CHECK_ID]: ctx.check.id,
    [CHECKSTACK_CHECK_NAME]: ctx.check.name,
    [CHECKSTACK_CHECK_INTERVAL_SECONDS]: String(ctx.check.intervalSeconds),
    [CHECKSTACK_SYSTEM_ID]: ctx.system.id,
    [CHECKSTACK_SYSTEM_NAME]: ctx.system.name,
  };
}

// ============================================================================
// LEGACY CONFIG (v1) — kept for migration
// ============================================================================

interface ExecuteConfigV1 {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout: number;
}

/**
 * Quote an arg for the shell when migrating a v1 command+args pair into a
 * single v2 script. Bare identifiers are passed through untouched; anything
 * else gets single-quoted with embedded quotes escaped.
 */
function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_\-./=:@%+]+$/.test(arg)) return arg;
  // POSIX single-quote escape: close, emit an escaped quote, reopen.
  return `'${arg.replaceAll("'", String.raw`'\''`)}'`;
}

// ============================================================================
// CONFIGURATION SCHEMA (v2)
// ============================================================================

const executeConfigSchemaV2 = z.object({
  script: configString({
    "x-editor-types": ["shell"],
  }).describe(
    "Shell script source. Executed via `sh -c`, so pipes, redirects, `if`/`for`/`while`, variable expansion, command substitution etc. all work. Exit non-zero to fail the check.",
  ),
  cwd: z
    .string()
    .optional()
    .describe("Working directory for the script (defaults to the satellite's CWD)"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Extra environment variables to expose to the script. Merged on top of the safe-vars whitelist (PATH, HOME, ...).",
    ),
  timeout: z
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(30_000)
    .describe("Maximum execution time in milliseconds"),
});

export type ExecuteConfig = z.infer<typeof executeConfigSchemaV2>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const executeResultSchema = healthResultSchema({
  exitCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  stdout: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Standard Output",
    "x-anomaly-enabled": false,
  }),
  stderr: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Standard Error",
    "x-anomaly-enabled": false,
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
});

export type ExecuteResult = z.infer<typeof executeResultSchema>;

// Aggregated result fields definition
const executeAggregatedFields = {
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
export type ExecuteAggregatedResult = InferAggregatedResult<
  typeof executeAggregatedFields
>;

// ============================================================================
// EXECUTE COLLECTOR
// ============================================================================

/**
 * Shell-script execute collector.
 *
 * The user provides a shell script as a single string; we run it through
 * `sh -c`. That means anything POSIX `sh` accepts works as expected:
 *
 * ```sh
 * # Fail when 1-minute load average exceeds 0.60 (portable: Linux + macOS).
 * load=$(uptime | sed 's/.*load average[s]*: //' | awk '{print $1}' | tr -d ',')
 * awk -v l="$load" 'BEGIN { exit (l+0 > 0.60) ? 1 : 0 }'
 * ```
 *
 * Exit code 0 = healthy, anything else = unhealthy. stdout / stderr are
 * captured and reported with the run.
 */
export class ExecuteCollector implements CollectorStrategy<
  ScriptTransportClient,
  ExecuteConfig,
  ExecuteResult,
  ExecuteAggregatedResult
> {
  id = "execute";
  displayName = "Shell Script";
  description = "Run a shell script and treat exit code 0 as healthy";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({
    version: 2,
    schema: executeConfigSchemaV2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description:
          "Collapse {command, args} into a single shell script executed via `sh -c`",
        migrate: (data: ExecuteConfigV1): ExecuteConfig => {
          const parts = [data.command, ...(data.args ?? [])].map((arg) =>
            shellQuote(arg),
          );
          return {
            script: parts.join(" "),
            cwd: data.cwd,
            env: data.env,
            timeout: data.timeout,
          };
        },
      },
    ],
  });
  result = new Versioned({ version: 1, schema: executeResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: executeAggregatedFields,
  });

  async execute({
    config,
    client,
    runContext,
  }: {
    config: ExecuteConfig;
    client: ScriptTransportClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<ExecuteResult>> {
    const startTime = Date.now();

    // Merge run-context metadata under the user-supplied env so a user
    // `config.env` key always wins on collision (matches the runner's
    // existing merge order against the safe-vars whitelist).
    const env = runContext
      ? { ...runContextEnv(runContext), ...config.env }
      : config.env;

    const response = await client.exec({
      script: config.script,
      cwd: config.cwd,
      env,
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

  mergeResult(
    existing: ExecuteAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ExecuteResult>,
  ): ExecuteAggregatedResult {
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
