/**
 * In-UI testing for health-check collector scripts (the inline-script TS
 * collector and the shell `script` collector from
 * `@checkstack/healthcheck-script-backend`).
 *
 * Exercises the same sandboxed runners the real collectors use against an
 * editable sample context, so an operator can click "Run" in the collector
 * editor and see the result without scheduling a real check execution.
 *
 * Mirrors the automation `runScriptTest` design: pure, runner-injectable,
 * never throws for ordinary script failures (they're returned in the
 * result), central-only, time-bounded. Healthcheck *replay* from a past
 * execution is intentionally NOT supported - `health_check_runs` persists
 * only the result, never the script/config/check/system that produced it,
 * so a faithful replay cannot be reconstructed. Auto-seed is the only
 * context source (see the feature plan, open item g).
 */
import {
  defaultEsmScriptRunner,
  defaultShellScriptRunner,
  type EsmScriptRunner,
  type ShellScriptRunner,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import {
  buildTestSecretEnv,
  maskScriptRunOutput,
} from "@checkstack/secrets-common";

export type CollectorScriptTestKind = "typescript" | "shell";

/** Curated check/system metadata a collector script can read. */
export interface CollectorTestRunContext {
  check?: { id: string; name: string; intervalSeconds: number };
  system?: { id: string; name: string };
}

export interface CollectorScriptTestInput {
  kind: CollectorScriptTestKind;
  script: string;
  /** Collector config the script reads via `context.config` / its own fields. */
  config?: Record<string, unknown>;
  /** Extra env vars for shell collectors (merged over the run-context vars). */
  env?: Record<string, string>;
  /**
   * The collector's declared secret -> env mapping. The test panel NEVER
   * resolves real secret values (decision 4): each declared env var gets a
   * `__SECRET_<NAME>__` placeholder, or the user override below.
   */
  secretEnv?: Record<string, string>;
  /** User-supplied per-secret-NAME override values, masked out of the result. */
  secretOverrides?: Record<string, string>;
  /** Working directory for shell collectors. */
  workingDirectory?: string;
  runContext?: CollectorTestRunContext;
  timeoutMs: number;
}

export interface CollectorScriptTestResult {
  result?: unknown;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

export interface CollectorScriptTestDeps {
  esmRunner?: EsmScriptRunner;
  shellRunner?: ShellScriptRunner;
  /**
   * Managed npm-package resolution root, so a TypeScript collector test
   * resolves the same allowlisted packages the real collector would. Omit
   * when no packages are configured. Plan §4.1.
   */
  resolutionRoot?: string;
}

/**
 * Map curated run-context metadata to the reserved `CHECKSTACK_*` env vars
 * the shell collector exposes. Mirrors `runContextEnv` in
 * `@checkstack/healthcheck-script-backend` (kept local - we don't import
 * across plugins). Only emits vars for the parts of the context provided.
 */
export function buildShellRunContextEnv(
  runContext: CollectorTestRunContext | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (runContext?.check) {
    env.CHECKSTACK_CHECK_ID = runContext.check.id;
    env.CHECKSTACK_CHECK_NAME = runContext.check.name;
    env.CHECKSTACK_CHECK_INTERVAL_SECONDS = String(
      runContext.check.intervalSeconds,
    );
  }
  if (runContext?.system) {
    env.CHECKSTACK_SYSTEM_ID = runContext.system.id;
    env.CHECKSTACK_SYSTEM_NAME = runContext.system.name;
  }
  return env;
}

/**
 * Build the `globalThis.context` object the inline-script (TS) collector
 * sees: `{ config, check?, system? }`. Matches the runtime collector so a
 * test mirrors production.
 */
export function buildCollectorContext(
  input: Pick<CollectorScriptTestInput, "config" | "runContext">,
): Record<string, unknown> {
  return {
    config: input.config ?? {},
    ...(input.runContext?.check ? { check: input.runContext.check } : {}),
    ...(input.runContext?.system ? { system: input.runContext.system } : {}),
  };
}

/**
 * Execute a single collector-script test against a sample context. Never
 * throws for ordinary script failures - those land in the result.
 */
export async function runCollectorScriptTest({
  input,
  deps = {},
}: {
  input: CollectorScriptTestInput;
  deps?: CollectorScriptTestDeps;
}): Promise<CollectorScriptTestResult> {
  const startedAt = Date.now();
  // Build the test secret env: placeholders by default, user overrides if
  // given. NO real secret value is resolved in the test path (decision 4).
  const secretTest = buildTestSecretEnv({
    secretEnv: input.secretEnv,
    secretOverrides: input.secretOverrides,
  });
  // Mask any user-override value out of the result so it can't round-trip.
  const mask = (
    res: CollectorScriptTestResult,
  ): CollectorScriptTestResult => {
    const masked = maskScriptRunOutput({
      output: {
        result: res.result,
        stdout: res.stdout,
        stderr: res.stderr,
        error: res.error,
      },
      values: secretTest.maskValues,
    });
    return { ...res, ...masked };
  };

  try {
    if (input.kind === "shell") {
      const runner = deps.shellRunner ?? defaultShellScriptRunner;
      const res = await runner.run({
        script: input.script,
        // Run-context vars, operator env, then the test secret env on top.
        env: {
          ...buildShellRunContextEnv(input.runContext),
          ...input.env,
          ...secretTest.env,
        },
        cwd: input.workingDirectory,
        timeoutMs: input.timeoutMs,
      });
      const durationMs = Date.now() - startedAt;
      if (res.timedOut) {
        return mask({
          stdout: res.stdout,
          stderr: res.stderr,
          exitCode: res.exitCode,
          durationMs,
          timedOut: true,
          error: "Script execution timed out",
        });
      }
      return mask({
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        durationMs,
        timedOut: false,
        error:
          res.exitCode === 0
            ? undefined
            : `Shell script exited with code ${res.exitCode}`,
      });
    }

    const runner = deps.esmRunner ?? defaultEsmScriptRunner;
    const res = await runner.run({
      script: input.script,
      context: buildCollectorContext(input),
      timeoutMs: input.timeoutMs,
      helperModuleName: "@checkstack/healthcheck",
      helperFunctionName: "defineHealthCheck",
      ...(Object.keys(secretTest.env).length > 0
        ? { env: secretTest.env }
        : {}),
      ...(deps.resolutionRoot ? { resolutionRoot: deps.resolutionRoot } : {}),
    });
    const durationMs = Date.now() - startedAt;
    return mask({
      result: res.result,
      stdout: res.stdout,
      stderr: res.stderr,
      durationMs,
      timedOut: res.timedOut,
      error: res.timedOut ? "Script execution timed out" : res.error,
    });
  } catch (error) {
    return mask({
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
      timedOut: false,
      error: extractErrorMessage(error),
    });
  }
}
