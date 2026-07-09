import {
  Versioned,
  z,
  configString,
  withConfigMeta,
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
import {
  secretEnvMappingSchema,
  maskScriptRunOutput,
} from "@checkstack/secrets-common";
import {
  CHECKSTACK_ENV_ID,
  CHECKSTACK_ENV_NAME,
  buildEnvironmentShellEnv,
} from "./shell-env";

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
 * vars exposed to the shell script. When the run carries a resolved
 * environment (post-fan-out), its id, name, and each custom field are
 * additionally exposed as `CHECKSTACK_ENV_*` vars.
 */
function runContextEnv(ctx: CollectorRunContext): Record<string, string> {
  return {
    [CHECKSTACK_CHECK_ID]: ctx.check.id,
    [CHECKSTACK_CHECK_NAME]: ctx.check.name,
    [CHECKSTACK_CHECK_INTERVAL_SECONDS]: String(ctx.check.intervalSeconds),
    [CHECKSTACK_SYSTEM_ID]: ctx.system.id,
    [CHECKSTACK_SYSTEM_NAME]: ctx.system.name,
    ...(ctx.environment
      ? {
          [CHECKSTACK_ENV_ID]: ctx.environment.id,
          [CHECKSTACK_ENV_NAME]: ctx.environment.name,
          ...buildEnvironmentShellEnv(ctx.environment.fields),
        }
      : {}),
  };
}

// ============================================================================
// LEGACY CONFIG (v1) — migration narrowing helpers
// ============================================================================
//
// The migrate input is `unknown` per the versioning chain, so narrowing is
// done with `typeof`/`in` guards (no casts).

/** Type guard: the migrate input is a plain object whose keys can be probed. */
function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

/** Read the v1 `command` string from a config blob. */
function readCommand(data: Record<string, unknown>): string {
  return typeof data.command === "string" ? data.command : "";
}

/** Read the v1 `args` string[] from a config blob (missing => empty). */
function readArgs(data: Record<string, unknown>): string[] {
  const value = data.args;
  return Array.isArray(value)
    ? value.filter((arg): arg is string => typeof arg === "string")
    : [];
}

/** Read an optional `cwd` string from a config blob. */
function readCwd(data: Record<string, unknown>): string | undefined {
  return typeof data.cwd === "string" ? data.cwd : undefined;
}

/** Read an optional `env` string->string record from a config blob. */
function readEnv(
  data: Record<string, unknown>,
): Record<string, string> | undefined {
  const value = data.env;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** Read a numeric `timeout` field from a config blob (default 30s). */
function readTimeout(data: Record<string, unknown>): number {
  return typeof data.timeout === "number" ? data.timeout : 30_000;
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
  // Deliberately NOT `x-templatable`: rendering `{{ environment.* }}` into the
  // shell source would splice env-field values into executed code (a shell
  // injection surface). Per-environment data reaches the script safely via the
  // reserved `CHECKSTACK_ENV_*` env vars (see `runContextEnv`), which are
  // exposed as shell variables, not interpolated into the source.
  script: configString({
    "x-editor-types": ["shell"],
    "x-script-testable": true,
  }).describe(
    "Shell script source. Executed via `sh -c`, so pipes, redirects, `if`/`for`/`while`, variable expansion, command substitution etc. all work. Exit non-zero to fail the check.",
  ),
  // Templatable: a per-environment working directory (e.g.
  // `{{ environment.workdir }}`) so one check config fans out across N
  // environments. This is a plain path VALUE substitution - unlike the `script`
  // body (see below), rendering it cannot inject executable shell code.
  cwd: configString({ "x-templatable": true })
    .optional()
    .describe(
      "Working directory for the script (defaults to the satellite's CWD). Supports templating, e.g. {{ environment.workdir }}",
    ),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Extra environment variables to expose to the script. Merged on top of the safe-vars whitelist (PATH, HOME, ...).",
    ),
  secretEnv: withConfigMeta(secretEnvMappingSchema, { "x-secret-env": true })
    .optional()
    .describe(
      'Secret → env mapping, e.g. { "API_TOKEN": "${{ secrets.token }}" }. Only the named secrets are resolved and injected for this run (read via process.env.API_TOKEN / $API_TOKEN); on a satellite they are delivered just-in-time over the encrypted channel, never persisted. Values are masked out of the collector output.',
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
    // Exit codes are arbitrary integers (0, 1, 2, 127, -1, ...) with no
    // stable distribution; the pass/fail signal they carry is already
    // covered by `success`. Charting it stays useful; alerting on it just
    // double-fires (and flaps for scripts that vary their nonzero codes).
    "x-anomaly-enabled": false,
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
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
    // Err wider than the default band: only sustained, materially-larger
    // run times should alert, not normal jitter.
    "x-anomaly-sensitivity": 2.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
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
    // A timeout always implies `success: false`, so alerting here on top of
    // `success` double-fires on the same incident. Keep it chartable, let
    // `success` carry the alert.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
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
    // Only a real drop in availability should alert, not single-sample
    // jitter in the rate.
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
    "x-chart-priority": 20,
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
 * The exit code is exposed as the assertable `exitCode` / `success` metric
 * (`success` is true when the exit code is 0). It does NOT hard-fail the
 * collector: add an assertion (e.g. "success is true", or "exitCode equals 0")
 * to turn a non-zero exit into an unhealthy result. Only a genuine transport
 * failure (the script could not be spawned, or it timed out) fails the
 * collector itself. stdout / stderr are captured and reported with the run.
 */
export class ExecuteCollector implements CollectorStrategy<
  ScriptTransportClient,
  ExecuteConfig,
  ExecuteResult,
  ExecuteAggregatedResult
> {
  id = "execute";
  displayName = "Shell Script";
  description =
    "Run a shell script and expose its exit code as an assertable metric";

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
        // IDEMPOTENT + HIGHEST RISK: only reshape a genuine v1 blob — one that
        // has `command` but NO `script`. An already-v2 blob carries `script`,
        // so this guard prevents fabricating `script: "undefined"` from it by
        // shell-quoting a missing `command`. Already-v2 data passes through.
        migrate: (data: unknown): unknown => {
          if (isRecord(data) && "command" in data && !("script" in data)) {
            const parts = [readCommand(data), ...readArgs(data)].map((arg) =>
              shellQuote(arg),
            );
            return {
              script: parts.join(" "),
              cwd: readCwd(data),
              env: readEnv(data),
              timeout: readTimeout(data),
            };
          }
          return data;
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
    secretEnv,
  }: {
    config: ExecuteConfig;
    client: ScriptTransportClient;
    pluginId: string;
    runContext?: CollectorRunContext;
    secretEnv?: Record<string, string>;
  }): Promise<CollectorResult<ExecuteResult>> {
    const startTime = Date.now();

    // Merge run-context metadata under the user-supplied env, then the
    // resolved secret env on top (a declared secret env name wins, matching
    // the central action's layering). User `config.env` still wins over the
    // run-context vars.
    const env = {
      ...(runContext ? runContextEnv(runContext) : {}),
      ...config.env,
      ...secretEnv,
    };

    // The OS-level sandbox is GLOBAL-only and resolved by the runner itself
    // (durable cluster default on the core pod, or fail-closed). No per-item
    // override is sent through the transport.
    const response = await client.exec({
      script: config.script,
      cwd: config.cwd,
      env,
      timeout: config.timeout,
    });

    // Source-side masking: redact the delivered secret values from the
    // captured output BEFORE it leaves the satellite (core masks again on
    // receipt). A script echoing a secret it was given is masked here.
    const maskValues = Object.values(secretEnv ?? {});
    const masked = maskScriptRunOutput({
      output: {
        stdout: response.stdout,
        stderr: response.stderr,
        error: response.error,
      },
      values: maskValues,
    });

    const executionTimeMs = Date.now() - startTime;
    // `success` (exit code 0) and the raw `exitCode` are ASSERTABLE METRICS,
    // not a collector-failure signal. A script that ran to completion and
    // exited non-zero is a SUCCESSFUL collection: the command executed and
    // reported a result. Whether a non-zero exit makes the check unhealthy is
    // the user's decision via assertions (e.g. "exitCode equals 0", or
    // "exitCode equals 1" when a non-zero exit is the wanted state). We must
    // NOT set the `error` field on a non-zero exit, otherwise the executor
    // hard-fails the run before assertions get to decide.
    //
    // Only a genuine transport failure fails the collector: `masked.error`
    // (the script could not be spawned / a runner-level error) or `timedOut`
    // (the script could not complete within the timeout). Those propagate as
    // the collector `error`.
    const success = response.exitCode === 0 && !response.timedOut;
    const transportError = response.timedOut
      ? (masked.error ?? "Script execution timed out")
      : masked.error;

    return {
      result: {
        exitCode: response.exitCode,
        stdout: masked.stdout,
        stderr: masked.stderr,
        executionTimeMs,
        success,
        timedOut: response.timedOut,
      },
      error: transportError,
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
