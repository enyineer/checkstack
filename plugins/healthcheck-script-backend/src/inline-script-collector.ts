import { spawn, type Subprocess } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  Versioned,
  z,
  configString,
  requestTimeoutMs,
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
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// EXECUTOR CONTRACT
// ============================================================================

/**
 * Shape returned by an inline-script executor. Mirrors what the runner
 * subprocess emits — `result` is whatever the user's `export default` (or
 * legacy `return X;`) produced, normalised by the collector after the fact.
 */
export interface InlineScriptExecutionResult {
  /** Raw value returned by the user script (default export or IIFE return). */
  result?: unknown;
  /** Error message if the script threw or failed to load. */
  error?: string;
  /** Stack trace if available. */
  stack?: string;
  /** Anything the script wrote to stdout — surfaces as the run's logs. */
  stdout: string;
  /** Anything the script wrote to stderr (with our marker stripped). */
  stderr: string;
  /** True if the timeout fired before the subprocess exited. */
  timedOut: boolean;
}

/**
 * Injectable executor. The default implementation spawns a Bun subprocess
 * against a temp `.mjs` file; tests can inject a mock to skip the spawn.
 */
export interface InlineScriptExecutor {
  execute(input: {
    script: string;
    config: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<InlineScriptExecutionResult>;
}

// ============================================================================
// SAFE ENVIRONMENT
// ============================================================================

/**
 * Vars passed through to the subprocess. We intentionally do _not_ forward
 * the full parent env so that backend secrets (DB URLs, API tokens, signing
 * keys) never reach user-authored scripts. PATH/HOME/LANG/... are kept so
 * `node:child_process`, `node:fs`, locale-sensitive APIs etc. behave normally.
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

function pickSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

// ============================================================================
// USER-SCRIPT NORMALISATION
// ============================================================================

const ESM_AT_TOP_LEVEL = /^\s*(import\s|export\s)/m;

/**
 * Source of the virtual `@checkstack/healthcheck` helper module that the
 * editor pretends exists. The user can `import { defineHealthCheck } from
 * "@checkstack/healthcheck"` and Monaco type-checks the call against
 * `HealthCheckScriptResult`. At runtime, `defineHealthCheck` is just an
 * identity function — it exists only to act as a type assertion.
 */
const HEALTHCHECK_HELPER_SOURCE = `// Auto-generated. Identity helpers that exist only so the editor can
// type-check the user's return shape. The runtime is intentionally trivial.
export function defineHealthCheck(value) { return value; }
`;

/**
 * Rewrite imports of the virtual `@checkstack/healthcheck` module to point
 * at a real on-disk helper file. The user writes a clean package import in
 * the editor (with IntelliSense from the virtual ambient module), and at
 * runtime we redirect it to a local sibling.
 */
export function rewriteHelperImports(userScript: string, helperUrl: string): string {
  // Conservative regex: only matches the exact spec string in `from "..."`
  // / `from '...'`. Doesn't touch substrings inside comments or strings.
  const fromRe =
    /(from\s+)(["'])@checkstack\/healthcheck\2/g;
  const sideEffectRe = /(import\s+)(["'])@checkstack\/healthcheck\2/g;
  return userScript
    .replaceAll(fromRe, (_match, fromKw: string, _q: string) =>
      `${fromKw}${JSON.stringify(helperUrl)}`,
    )
    .replaceAll(sideEffectRe, (_match, importKw: string, _q: string) =>
      `${importKw}${JSON.stringify(helperUrl)}`,
    );
}

/**
 * Make the user's source loadable as an ES module.
 *
 * Three shapes are supported, in priority order:
 *
 * 1. **Real module**: contains `import` / `export` at top level — used as-is.
 *    The runner reads `export default`. Top-level `await` works.
 *
 *      import { loadavg } from "node:os";
 *      export default { success: loadavg()[0] < 0.6 };
 *
 * 2. **Legacy IIFE-style** (backwards compatible with the pre-rewrite
 *    inline-script collector): no top-level ESM syntax, may use `return X;`.
 *    We wrap the whole body in an async IIFE whose result becomes the
 *    default export.
 *
 *      // user writes:
 *      return { success: true };
 *      // we run:
 *      export default await (async () => { return { success: true }; })();
 *
 * 3. **Side-effect only**: no return, no export. Treated as healthy unless
 *    the script throws.
 */
export function normaliseUserScript(userScript: string): string {
  if (ESM_AT_TOP_LEVEL.test(userScript)) {
    return userScript;
  }
  // Trailing newline before `})` so a `// comment` on the last line
  // doesn't swallow the closing brace.
  return `export default await (async () => {\n${userScript}\n})();\n`;
}

// ============================================================================
// RUNNER GENERATION
// ============================================================================

/**
 * Generate the runner module that imports the user's script, captures its
 * default export, and emits the result through a UUID-tagged marker on
 * stderr. We use stderr (not stdout) so user `console.log()` calls remain
 * uncontaminated and can be surfaced as logs.
 */
function buildRunnerSource({
  userScriptUrl,
  contextJson,
  markerStart,
  markerEnd,
}: {
  userScriptUrl: string;
  contextJson: string;
  markerStart: string;
  markerEnd: string;
}): string {
  // `String.raw` so embedded \n / \\ in the generated source survive verbatim
  // to the temp file — we want the runner to write a real newline at runtime,
  // which means the file on disk needs the two characters `\n` (not a real LF).
  return String.raw`// Auto-generated runner for an inline-script health check.
// Sets up the user-facing globals, imports the user module, captures the
// result, and writes it back to the parent through a stderr marker.

globalThis.context = ${contextJson};

// Expose \`defineHealthCheck\` as a global so users can call it without
// having to add \`import { defineHealthCheck } from "@checkstack/healthcheck"\`
// — particularly useful for the empty-script-no-starter case where the
// editor can autocomplete a known global but can't suggest an auto-import
// (Monaco 0.55 doesn't surface module-export completions before import).
// It's the same identity function as the helper module; both code paths
// converge on a value-passthrough.
globalThis.defineHealthCheck = (value) => value;

const __markerStart = ${JSON.stringify(markerStart)};
const __markerEnd = ${JSON.stringify(markerEnd)};

function __emit(payload) {
  // Single-line JSON, sandwiched between unique markers. The parent process
  // does a lastIndexOf() to find it and is therefore tolerant of arbitrary
  // user output on stderr above.
  process.stderr.write(__markerStart + JSON.stringify(payload) + __markerEnd + "\n");
}

try {
  const __mod = await import(${JSON.stringify(userScriptUrl)});
  let __result;
  if (__mod && "default" in __mod && __mod.default !== undefined) {
    const __def = __mod.default;
    __result =
      typeof __def === "function"
        ? await __def(globalThis.context)
        : __def;
  }
  __emit({ ok: true, result: __result ?? null });
} catch (err) {
  const __message =
    err && typeof err === "object" && "message" in err
      ? String(err.message)
      : String(err);
  const __stack =
    err && typeof err === "object" && "stack" in err
      ? String(err.stack)
      : undefined;
  __emit({ ok: false, error: __message, stack: __stack });
  process.exit(1);
}
`;
}

// ============================================================================
// DEFAULT EXECUTOR (Bun subprocess)
// ============================================================================

type RunnerPayload =
  | { ok: true; result: unknown }
  | { ok: false; error: string; stack?: string };

function isRunnerPayload(value: unknown): value is RunnerPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) return true;
  if (v.ok === false && typeof v.error === "string") return true;
  return false;
}

/**
 * Concurrency note: each invocation of `execute` is fully isolated.
 *
 *  - `mkdtemp` guarantees a unique directory name even if N invocations race
 *    on the same Bun process (it uses `os.tmpdir() + prefix + random suffix`
 *    and won't return until the directory exists exclusively).
 *  - The result-marker session ID is a `randomUUID`, so each subprocess's
 *    stderr is unambiguously its own — even if user scripts happen to write
 *    text that looks like another invocation's marker.
 *  - The subprocess is launched with a `cmd: [bun, runner.mjs]` whose only
 *    references to the temp dir are absolute paths in env/argv, so two
 *    concurrent subprocesses can never read each other's user.mjs.
 *
 * Cleanup is guaranteed by the `finally` block:
 *
 *  - The whole subprocess+IO body runs inside a try whose `finally` deletes
 *    the temp dir recursively (`{ recursive: true, force: true }`), so the
 *    dir is removed on success, on a thrown error, on timeout, and on a
 *    crashing user script.
 *  - The setTimeout handle is captured and `clearTimeout`-ed in the same
 *    finally, so a fast script doesn't leak an event-loop timer.
 *  - If the timer fired (timedOut=true), the subprocess was `.kill()`ed when
 *    the timer rejected; for safety we also kill it again in `finally` —
 *    `.kill()` is idempotent and free on an already-exited process.
 */
const defaultInlineScriptExecutor: InlineScriptExecutor = {
  async execute({ script, config, timeoutMs }) {
    const sessionId = randomUUID();
    const markerStart = `##__CHECKSTACK_RESULT_${sessionId}_START__##`;
    const markerEnd = `##__CHECKSTACK_RESULT_${sessionId}_END__##`;

    const tmpDir = await mkdtemp(path.join(tmpdir(), "checkstack-script-"));
    const userScriptPath = path.join(tmpDir, "user.mjs");
    const runnerPath = path.join(tmpDir, "runner.mjs");
    const helperPath = path.join(tmpDir, "_helpers.mjs");
    const helperUrl = pathToFileURL(helperPath).href;

    let proc: Subprocess | undefined;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc?.kill();
        reject(new Error("__TIMEOUT__"));
      }, timeoutMs);
    });

    try {
      // Drop the helper module first so the user's `import { defineHealthCheck }
      // from "@checkstack/healthcheck"` (which we rewrite to point at this
      // file's URL) resolves at module-evaluation time.
      await writeFile(helperPath, HEALTHCHECK_HELPER_SOURCE, "utf8");
      await writeFile(
        userScriptPath,
        rewriteHelperImports(normaliseUserScript(script), helperUrl),
        "utf8",
      );
      await writeFile(
        runnerPath,
        buildRunnerSource({
          userScriptUrl: pathToFileURL(userScriptPath).href,
          contextJson: JSON.stringify({ config }),
          markerStart,
          markerEnd,
        }),
        "utf8",
      );

      proc = spawn({
        cmd: [process.execPath, runnerPath],
        env: pickSafeEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });

      let stdout: string;
      let stderr: string;

      try {
        [stdout, stderr] = (await Promise.race([
          Promise.all([
            new Response(proc.stdout as ReadableStream).text(),
            new Response(proc.stderr as ReadableStream).text(),
            proc.exited,
          ]),
          timeoutPromise,
        ])) as [string, string, number];
      } catch (error) {
        if (timedOut) {
          return {
            stdout: "",
            stderr: "",
            timedOut: true,
            error: "Script execution timed out",
          };
        }
        throw error;
      }

      // Pluck the runner payload out of stderr.
      const startIdx = stderr.lastIndexOf(markerStart);
      const endIdx = stderr.lastIndexOf(markerEnd);

      let cleanStderr = stderr;
      let payload: RunnerPayload | undefined;

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = stderr.slice(startIdx + markerStart.length, endIdx);
        try {
          const parsed: unknown = JSON.parse(jsonStr);
          if (isRunnerPayload(parsed)) {
            payload = parsed;
          }
        } catch {
          // Fall through to the "no marker" branch below.
        }
        cleanStderr = (
          stderr.slice(0, startIdx) + stderr.slice(endIdx + markerEnd.length)
        )
          .replace(/\n$/, "")
          .trim();
      }

      if (!payload) {
        // The runner never got far enough to emit — typically a syntax
        // error in the user module or a hard crash. Surface whatever the
        // subprocess wrote to stderr as the error.
        return {
          stdout: stdout.trim(),
          stderr: cleanStderr,
          timedOut: false,
          error:
            cleanStderr.length > 0
              ? cleanStderr
              : "Script exited without producing a result",
        };
      }

      if (payload.ok) {
        return {
          result: payload.result,
          stdout: stdout.trim(),
          stderr: cleanStderr,
          timedOut: false,
        };
      }

      return {
        error: payload.error,
        stack: payload.stack,
        stdout: stdout.trim(),
        stderr: cleanStderr,
        timedOut: false,
      };
    } finally {
      // Order matters here:
      //  1. Clear the timeout — otherwise the timer keeps the event loop
      //     alive for up to `timeoutMs` past return on a fast script.
      //  2. Kill any subprocess still running (idempotent if already exited)
      //     — defends against an exception path that didn't bubble through
      //     the timeout branch.
      //  3. Remove the temp dir last, after the subprocess can no longer be
      //     touching its files.
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      proc?.kill();
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {
        // Cleanup is best-effort; if a concurrent OS process holds a lock
        // we'll let the OS reap /tmp eventually rather than throwing here.
      });
    }
  },
};

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const inlineScriptConfigSchema = z.object({
  script: configString({
    "x-editor-types": ["typescript"],
  }).describe(
    "TypeScript/JavaScript module. Use `import { ... } from \"node:os\"` to pull in Node built-ins. The recommended pattern is `export default defineHealthCheck({ success, message?, value? })` — `defineHealthCheck` is provided by `@checkstack/healthcheck` and asserts the return shape at the type level. Throwing also signals failure.",
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
 * Successful return shapes:
 * - `{ success: boolean, message?: string, value?: number }`
 * - `boolean` (treated as `success`)
 * - `number` (treated as `value`, success implied)
 * - `undefined` / nothing exported (success implied)
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
 * @example HTTP check
 * ```ts
 * const res = await fetch("https://api.example.com/health");
 * export default { success: res.ok, value: res.status };
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

  constructor(executor: InlineScriptExecutor = defaultInlineScriptExecutor) {
    this.executor = executor;
  }

  async execute({
    config,
  }: {
    config: InlineScriptConfig;
    client: ScriptTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<InlineScriptResult>> {
    const startTime = Date.now();

    let exec: InlineScriptExecutionResult;
    try {
      exec = await this.executor.execute({
        script: config.script,
        config: config as unknown as Record<string, unknown>,
        timeoutMs: config.timeout,
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
