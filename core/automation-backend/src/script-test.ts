/**
 * In-UI script testing for automation `run_script` / `run_shell` actions.
 *
 * This is the backend half of Feature 2 (test scripts in the UI). It
 * exercises the **same** sandboxed runners the real actions use
 * (`defaultEsmScriptRunner` for TypeScript/JavaScript, `defaultShellScriptRunner`
 * for shell) against an editable, user-supplied sample context — so an
 * operator can click "Run" in the editor and see the result without
 * triggering a whole automation.
 *
 * Security: the test runs on the central backend with the same subprocess
 * isolation + curated `SAFE_ENV_VARS` env as production. Authoring a
 * script already lets the user execute code, so no new privilege is
 * granted; the endpoint is `manage`-gated and time-bounded.
 *
 * The module is deliberately pure (no DB, no oRPC) and takes injectable
 * runners so it can be unit-tested without spawning a real subprocess.
 */
import {
  defaultEsmScriptRunner,
  defaultShellScriptRunner,
  type EsmScriptRunner,
  type ShellScriptRunner,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { flattenScopeToShellEnv } from "./script-test-shell-env";

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type ScriptTestKind = "typescript" | "shell";

/**
 * Sample run context an operator edits in the test panel. Mirrors the
 * shape `run_script` exposes as `globalThis.context` and `run_shell`
 * flattens into `$CHECKSTACK_*` env vars. Every field is optional so a
 * partial sample still runs.
 */
export interface ScriptTestContext {
  trigger?: {
    event?: string;
    payload?: Record<string, unknown>;
  };
  artifacts?: Record<string, unknown>;
  var?: Record<string, unknown>;
  repeat?: { index: number; item?: unknown };
}

export interface ScriptTestInput {
  kind: ScriptTestKind;
  script: string;
  /** Editable sample context (auto-seeded in the UI). */
  context?: ScriptTestContext;
  /** Extra env vars for shell tests (merged over the flattened context). */
  env?: Record<string, string>;
  /** Working directory for shell tests. */
  workingDirectory?: string;
  timeoutMs: number;
}

export interface ScriptTestResult {
  /** Return value of a TypeScript test (undefined for shell). */
  result?: unknown;
  stdout: string;
  stderr: string;
  /** Exit code of a shell test (undefined for TypeScript). */
  exitCode?: number;
  durationMs: number;
  timedOut: boolean;
  /** Populated when the script threw / failed to load / exited non-zero. */
  error?: string;
}

export interface ScriptTestDeps {
  esmRunner?: EsmScriptRunner;
  shellRunner?: ShellScriptRunner;
  /**
   * Managed npm-package resolution root, so a TypeScript test resolves the
   * same allowlisted packages the real `run_script` action would. Omit when
   * no packages are configured (today's behavior). Plan §4.1: "with the
   * managed resolutionRoot once Feature 1 lands."
   */
  resolutionRoot?: string;
}

// =============================================================================
// CONTEXT NORMALISATION
// =============================================================================

/**
 * Build the `globalThis.context` object a `run_script` action sees, from
 * the editable sample. Keeps the same key names (`trigger`, `artifacts`,
 * `var`, `automation`, optional `repeat`) so testing matches runtime.
 */
export function buildScriptContext(
  context: ScriptTestContext | undefined,
): Record<string, unknown> {
  return {
    trigger: {
      event: context?.trigger?.event ?? "",
      payload: context?.trigger?.payload ?? {},
    },
    artifacts: context?.artifacts ?? {},
    var: context?.var ?? {},
    ...(context?.repeat ? { repeat: context.repeat } : {}),
    // A test run has no real automation identity; surface stable
    // placeholder values so `context.automation.runId` is non-null.
    automation: {
      runId: "test-run",
      automationId: "test-automation",
      contextKey: null,
    },
  };
}

// =============================================================================
// RUN
// =============================================================================

/**
 * Execute a single test run of a script against a sample context.
 *
 * Never throws for ordinary script failures (syntax error, thrown error,
 * non-zero exit, timeout) — those are returned in the {@link ScriptTestResult}
 * so the UI can render them. Only truly unexpected infrastructure errors
 * propagate, and even those are caught and surfaced as `error`.
 */
export async function runScriptTest({
  input,
  deps = {},
}: {
  input: ScriptTestInput;
  deps?: ScriptTestDeps;
}): Promise<ScriptTestResult> {
  const startedAt = Date.now();
  try {
    if (input.kind === "shell") {
      const runner = deps.shellRunner ?? defaultShellScriptRunner;
      const flattened = flattenScopeToShellEnv(input.context);
      const res = await runner.run({
        script: input.script,
        env: { ...flattened, ...input.env },
        cwd: input.workingDirectory,
        timeoutMs: input.timeoutMs,
      });
      const durationMs = Date.now() - startedAt;
      if (res.timedOut) {
        return {
          stdout: res.stdout,
          stderr: res.stderr,
          exitCode: res.exitCode,
          durationMs,
          timedOut: true,
          error: "Script execution timed out",
        };
      }
      return {
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        durationMs,
        timedOut: false,
        error:
          res.exitCode === 0
            ? undefined
            : `Shell script exited with code ${res.exitCode}`,
      };
    }

    const runner = deps.esmRunner ?? defaultEsmScriptRunner;
    const res = await runner.run({
      script: input.script,
      context: buildScriptContext(input.context),
      timeoutMs: input.timeoutMs,
      helperModuleName: "@checkstack/integration",
      helperFunctionName: "defineIntegration",
      ...(deps.resolutionRoot ? { resolutionRoot: deps.resolutionRoot } : {}),
    });
    const durationMs = Date.now() - startedAt;
    return {
      result: res.result,
      stdout: res.stdout,
      stderr: res.stderr,
      durationMs,
      timedOut: res.timedOut,
      error: res.timedOut
        ? "Script execution timed out"
        : res.error,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
      timedOut: false,
      error: extractErrorMessage(error),
    };
  }
}
