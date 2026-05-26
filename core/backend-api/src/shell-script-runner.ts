import { spawn, type Subprocess } from "bun";

/**
 * Shared sandbox for executing user-authored shell scripts through
 * `sh -c`.
 *
 * Used by both `@checkstack/healthcheck-script-backend` (the shell
 * health-check strategy) and `@checkstack/integration-script-backend`
 * (the shell integration provider). The two had near-identical inline
 * implementations; this module is the canonical version.
 *
 * Why a curated env: a script author already has authority to execute
 * arbitrary shell, but we must not leak the satellite's own secrets to
 * them. The forwarded env is the minimum needed for ordinary commands
 * (`awk`, `curl`, `git`, locale-aware tools) to behave correctly:
 * `PATH` so binaries resolve, `HOME` / `USER` so tools find their
 * config, `LANG` / `LC_*` so output is parseable, `TZ` so timestamps
 * are consistent, `TMPDIR` so `mktemp` works. Everything else
 * (DB URLs, signing keys, queue creds, etc.) is dropped.
 *
 * Cleanup is `finally`-guaranteed: the timeout handle is cleared so a
 * fast script doesn't leak an event-loop timer, and any straggler
 * subprocess is `.kill()`-ed (idempotent on an already-exited
 * process). This matches the pattern in the ESM script runner.
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface ShellScriptRunResult {
  /** Exit code reported by the subprocess. -1 if it never started or timed out. */
  exitCode: number;
  /** Captured stdout, trimmed of trailing newlines. */
  stdout: string;
  /** Captured stderr, trimmed of trailing newlines. */
  stderr: string;
  /** True if the timeout fired before the subprocess exited. */
  timedOut: boolean;
}

export interface ShellScriptRunOptions {
  /** Shell-script source. Fed verbatim to `sh -c`, so pipes, redirects, etc. work. */
  script: string;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  /** Optional working directory for the subprocess. */
  cwd?: string;
  /**
   * Optional extra environment variables. Merged on top of the
   * safe-vars whitelist (`PATH`, `HOME`, ...). User-supplied values
   * win on key collision.
   *
   * Note: callers should validate the keys themselves if they need to
   * forbid `LD_PRELOAD`, `NODE_OPTIONS`, etc. — at the shared-runner
   * layer we accept whatever the caller passes, because the legitimate
   * use cases (e.g. integration shell scripts injecting `PAYLOAD_*`
   * vars) vary too much.
   */
  env?: Record<string, string>;
}

/**
 * Injectable interface. Production code calls
 * `defaultShellScriptRunner.run()`; tests can pass a mock to skip the
 * actual subprocess spawn.
 */
export interface ShellScriptRunner {
  run(options: ShellScriptRunOptions): Promise<ShellScriptRunResult>;
}

// =============================================================================
// INTERNALS
// =============================================================================

/**
 * Vars passed through to the subprocess. We intentionally do NOT
 * forward the satellite's full env so backend secrets (DB URLs, API
 * tokens, signing keys) never reach user-authored scripts.
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

// =============================================================================
// DEFAULT RUNNER
// =============================================================================

/**
 * Default runner implementation. Production code should use this; tests
 * can substitute a mock that conforms to {@link ShellScriptRunner}.
 */
export const defaultShellScriptRunner: ShellScriptRunner = {
  async run({ script, timeoutMs, cwd, env }) {
    let proc: Subprocess | undefined;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc?.kill();
        reject(new Error("Script execution timed out"));
      }, timeoutMs);
    });

    try {
      // Execute through `sh -c` so the user's script can use pipes,
      // redirects, variable expansion, conditionals, command
      // substitution, etc. — i.e. behave like a real shell script
      // rather than a single argv vector.
      proc = spawn({
        cmd: ["sh", "-c", script],
        cwd,
        env: { ...pickSafeEnv(), ...env },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([
          new Response(proc.stdout as ReadableStream).text(),
          new Response(proc.stderr as ReadableStream).text(),
          proc.exited,
        ]),
        timeoutPromise,
      ]);

      return {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false,
      };
    } catch (error) {
      if (timedOut) {
        return {
          exitCode: -1,
          stdout: "",
          stderr: "Script execution timed out",
          timedOut: true,
        };
      }
      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      // Idempotent — no-op when the subprocess has already exited
      // cleanly, but guarantees we never leave a runaway `sh` from
      // an exception path.
      proc?.kill();
    }
  },
};
