import { spawn, type Subprocess } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * Shared sandbox for executing user-authored TypeScript / JavaScript
 * modules in a fresh Bun subprocess.
 *
 * Used by both `@checkstack/healthcheck-script-backend` (the inline
 * health-check collector) and `@checkstack/integration-script-backend`
 * (the script integration provider). The two had near-identical inline
 * implementations; this module is the canonical version.
 *
 * Why subprocess isolation matters:
 *
 *   Running user code via `new Function(script)` in the satellite's
 *   own process gives the user `globalThis.process`, `node:fs`, etc.
 *   — they can read every secret in `process.env` (DB URLs, signing
 *   keys, queue creds) and exfiltrate them through the result. Even
 *   `manage`-level users typically have no legitimate API for those
 *   secrets, so in-process eval is a privilege amplification.
 *
 *   By spawning a separate Bun process with a curated `SAFE_ENV_VARS`
 *   subset, the user's script gets the full Node/Bun standard library
 *   to work with but cannot see the satellite's environment.
 *
 * Concurrency note: each `run()` invocation is fully isolated.
 *
 *   - `mkdtemp` guarantees a unique directory name (POSIX-atomic).
 *   - The result-marker session id is a `randomUUID`, so each
 *     subprocess's stderr is unambiguously its own — even if user
 *     scripts happen to write text that looks like another invocation's
 *     marker.
 *   - The subprocess is launched with `cmd: [bun, runner.mjs]` whose
 *     references to the temp dir are absolute paths in env/argv. Two
 *     concurrent subprocesses can never read each other's user.mjs.
 *
 * Cleanup is `finally`-guaranteed: the timeout handle is cleared, any
 * straggler subprocess is killed (idempotent on an already-exited
 * process), and the temp dir is removed recursively — on success, on
 * thrown error, AND on timeout.
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface EsmScriptRunResult {
  /** Raw value the user script returned (default export or legacy IIFE return). */
  result?: unknown;
  /** Error message if the script threw or failed to load. */
  error?: string;
  /** Stack trace if available. */
  stack?: string;
  /** Anything the script wrote to stdout — caller can surface as logs. */
  stdout: string;
  /** Anything the script wrote to stderr (with our result-marker stripped). */
  stderr: string;
  /** True if the timeout fired before the subprocess exited. */
  timedOut: boolean;
}

export interface EsmScriptRunOptions {
  /** User-supplied script source (modern ESM with `import`/`export`, or legacy `return X;`). */
  script: string;
  /** Object to expose as `globalThis.context` inside the subprocess. JSON-serialised; no functions / cycles. */
  context: unknown;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  /**
   * Optional virtual module name that the user's script can `import`
   * from. We write a sibling `_helpers.mjs` in the temp dir that
   * exports a single identity function under `helperFunctionName`, and
   * rewrite any `from "<helperModuleName>"` import in the user source
   * to point at that file. Skipped if either field is omitted.
   *
   * @example
   *   helperModuleName: "@checkstack/healthcheck"
   *   helperFunctionName: "defineHealthCheck"
   *   // editor: import { defineHealthCheck } from "@checkstack/healthcheck"
   *   // runtime: import { defineHealthCheck } from "file:///tmp/.../_helpers.mjs"
   */
  helperModuleName?: string;
  /** Name of the helper function injected as a global AND exported by the virtual module. */
  helperFunctionName?: string;
  /**
   * Optional directory the per-run temp dir is created *inside*, so Node /
   * Bun module resolution walks up to `<resolutionRoot>/node_modules` and
   * the user's script can `import` managed npm packages.
   *
   * When unset (the default), the per-run dir is created under
   * `os.tmpdir()` exactly as before - backward-compatible, no node_modules
   * visible, isolation unchanged. The script-packages reconciler points
   * this at `<store>/current` (the atomically-flipped symlink to the
   * active materialized tree).
   *
   * Execution isolation is unchanged either way: the subprocess still gets
   * only `SAFE_ENV_VARS`, so packages cannot read backend secrets.
   */
  resolutionRoot?: string;
}

/**
 * Injectable interface. Production code calls
 * `defaultEsmScriptRunner.run()`; tests can pass a mock to skip the
 * actual subprocess spawn.
 */
export interface EsmScriptRunner {
  run(options: EsmScriptRunOptions): Promise<EsmScriptRunResult>;
}

// =============================================================================
// INTERNALS
// =============================================================================

/**
 * Vars passed through to the subprocess. We intentionally do NOT
 * forward the satellite's full env so backend secrets (DB URLs, API
 * tokens, signing keys) never reach user-authored scripts. PATH / HOME
 * / LANG / ... are kept so `node:child_process`, `node:fs`, and
 * locale-sensitive APIs behave normally.
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
// USER-SCRIPT NORMALISATION
// =============================================================================

const ESM_AT_TOP_LEVEL = /^\s*(import\s|export\s)/m;

/**
 * Make the user's source loadable as an ES module.
 *
 * Three shapes are supported:
 *  1. **Real module** (contains `import` / `export` at top level) — used as-is.
 *  2. **Legacy IIFE-style** (`return X;` at top level) — wrapped in an
 *     async IIFE whose return value becomes the default export.
 *  3. **Side-effect only** — treated as healthy unless it throws.
 */
export function normaliseUserScript(userScript: string): string {
  if (ESM_AT_TOP_LEVEL.test(userScript)) {
    return userScript;
  }
  // Trailing newline so a `// comment` on the last line doesn't swallow
  // the closing brace.
  return `export default await (async () => {\n${userScript}\n})();\n`;
}

/**
 * Rewrite imports of a virtual module to point at a real on-disk
 * helper file. The user writes a clean package import in the editor
 * (with IntelliSense from the virtual ambient module), and at runtime
 * we redirect it to a local sibling.
 *
 * The regex is anchored to the literal spec position of `from "..."` /
 * `import "..."` — it doesn't touch substrings of comments or string
 * literals.
 */
export function rewriteHelperImports({
  userScript,
  helperModuleName,
  helperUrl,
}: {
  userScript: string;
  helperModuleName: string;
  helperUrl: string;
}): string {
  const escapedName = helperModuleName.replaceAll(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  );
  const fromRe = new RegExp(
    String.raw`(from\s+)(["'])${escapedName}\2`,
    "g",
  );
  const sideEffectRe = new RegExp(
    String.raw`(import\s+)(["'])${escapedName}\2`,
    "g",
  );
  return userScript
    .replaceAll(fromRe, (_match, fromKw: string) =>
      `${fromKw}${JSON.stringify(helperUrl)}`,
    )
    .replaceAll(sideEffectRe, (_match, importKw: string) =>
      `${importKw}${JSON.stringify(helperUrl)}`,
    );
}

// =============================================================================
// RUNNER GENERATION
// =============================================================================

function buildHelperSource(helperFunctionName: string): string {
  return `// Auto-generated. Identity helper that exists only so the editor can
// type-check the user's return shape. The runtime is intentionally trivial.
export function ${helperFunctionName}(value) { return value; }
`;
}

function buildRunnerSource({
  userScriptUrl,
  contextJson,
  helperFunctionName,
  markerStart,
  markerEnd,
}: {
  userScriptUrl: string;
  contextJson: string;
  helperFunctionName: string | undefined;
  markerStart: string;
  markerEnd: string;
}): string {
  const helperGlobal = helperFunctionName
    ? `globalThis.${helperFunctionName} = (value) => value;\n`
    : "";

  // `String.raw` so embedded \n / \\ in the generated source survive
  // verbatim to the temp file — the runner needs to write a real
  // newline at runtime, which means the file on disk needs the two
  // characters `\n` (not a real LF).
  return String.raw`// Auto-generated runner for an inline user-script execution.
// Sets up the user-facing globals, imports the user module, captures the
// result, and writes it back to the parent through a stderr marker.

globalThis.context = ${contextJson};
${helperGlobal}
const __markerStart = ${JSON.stringify(markerStart)};
const __markerEnd = ${JSON.stringify(markerEnd)};

function __emit(payload) {
  // Single-line JSON, sandwiched between unique markers. The parent
  // process does a lastIndexOf() to find it and is tolerant of
  // arbitrary user output on stderr above.
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

// =============================================================================
// MARKER PAYLOAD VALIDATION
// =============================================================================

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

// =============================================================================
// DEFAULT RUNNER
// =============================================================================

/**
 * Default runner implementation. Production code should use this; tests
 * can substitute a mock that conforms to {@link EsmScriptRunner}.
 */
export const defaultEsmScriptRunner: EsmScriptRunner = {
  async run({
    script,
    context,
    timeoutMs,
    helperModuleName,
    helperFunctionName,
    resolutionRoot,
  }) {
    const sessionId = randomUUID();
    const markerStart = `##__CS_SCRIPT_RESULT_${sessionId}_START__##`;
    const markerEnd = `##__CS_SCRIPT_RESULT_${sessionId}_END__##`;

    // When a `resolutionRoot` is given, create the per-run dir *inside* it
    // so module resolution walks up to `<resolutionRoot>/node_modules`.
    // Otherwise fall back to `os.tmpdir()` (today's behavior - no
    // node_modules visible, fully backward compatible).
    const tmpBase = resolutionRoot ?? tmpdir();
    const tmpDir = await mkdtemp(path.join(tmpBase, "checkstack-script-"));
    const userScriptPath = path.join(tmpDir, "user.mjs");
    const runnerPath = path.join(tmpDir, "runner.mjs");

    const hasHelper =
      typeof helperModuleName === "string" &&
      helperModuleName.length > 0 &&
      typeof helperFunctionName === "string" &&
      helperFunctionName.length > 0;
    const helperPath = hasHelper ? path.join(tmpDir, "_helpers.mjs") : undefined;
    const helperUrl = helperPath ? pathToFileURL(helperPath).href : undefined;

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
      // Helper module first so the user's
      // `import { <fn> } from "<helperModuleName>"` (which we rewrite
      // to point at this file's URL) resolves at module-evaluation time.
      if (helperPath && helperFunctionName) {
        await writeFile(helperPath, buildHelperSource(helperFunctionName), "utf8");
      }

      const normalisedSource = normaliseUserScript(script);
      const userSource =
        hasHelper && helperUrl
          ? rewriteHelperImports({
              userScript: normalisedSource,
              helperModuleName: helperModuleName!,
              helperUrl,
            })
          : normalisedSource;

      await writeFile(userScriptPath, userSource, "utf8");
      await writeFile(
        runnerPath,
        buildRunnerSource({
          userScriptUrl: pathToFileURL(userScriptPath).href,
          contextJson: JSON.stringify(context),
          helperFunctionName: hasHelper ? helperFunctionName : undefined,
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
          // Fall through to the "no marker" branch.
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
      // Order matters:
      //   1. Clear the timer (otherwise a fast script leaks an
      //      event-loop handle for up to `timeoutMs`).
      //   2. Kill any straggler subprocess. `.kill()` is idempotent on
      //      an already-exited process.
      //   3. Remove the tempdir last — after the subprocess can no
      //      longer be touching its files.
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      proc?.kill();
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {
        // Best-effort. Anything left in /tmp will be reaped by the OS.
      });
    }
  },
};
