import { spawn, type Subprocess } from "bun";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { detectSandboxCapabilities } from "./script-sandbox/capabilities";
import { readCappedOutput } from "./script-sandbox/capped-output";
import { pickSafeEnv } from "./script-sandbox/env-guard";
import { truncateCapturedOutput } from "./script-sandbox/output-truncation";
import {
  FAIL_CLOSED_DOWNGRADE_REASON,
  resolveActiveSandboxPolicy,
} from "./script-sandbox/provider";
import {
  type EffectiveSandbox,
  SandboxUnavailableError,
} from "./script-sandbox/report";
import { buildSpawnHardening } from "./script-sandbox/wrapper";

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
  /** True if captured output exceeded the sandbox `maxOutputBytes` cap and was trimmed. */
  outputTruncated?: boolean;
  /**
   * What the OS-level sandbox actually enforced / degraded for this run.
   * Always present: the runner resolves the active GLOBAL policy itself and
   * reports the result so callers can surface downgrades.
   */
  sandbox?: EffectiveSandbox;
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
   *   helperModuleName: "@checkstack/sdk/healthcheck"
   *   helperFunctionName: "defineHealthCheck"
   *   // editor: import { defineHealthCheck } from "@checkstack/sdk/healthcheck"
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
  /**
   * Extra environment variables injected into the subprocess for THIS run
   * only, merged on top of `SAFE_ENV_VARS`. The Secrets platform uses this
   * to inject a run's resolved secret -> env allowlist (decision 5,
   * least-privilege): only the consumer's declared secrets are injected,
   * memory-only, for the lifetime of this run. It deliberately does NOT
   * widen the ambient `SAFE_ENV_VARS` whitelist — the values live only in
   * this options object and the spawned process env.
   *
   * The user's script reads these as `process.env.ENV_NAME`. On a key
   * collision with a safe var, the injected value wins.
   *
   * Note: forbidden keys (`LD_PRELOAD`, `NODE_OPTIONS`, ...) are dropped from
   * these overrides by the shared env denylist whenever the active sandbox
   * policy is enabled.
   */
  env?: Record<string, string>;
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
    env: injectedEnv,
  }) {
    // Reconcile the requested policy against this host's capabilities BEFORE
    // any filesystem work or spawn. When `onUnavailable: "fail"` and a layer
    // is unavailable this throws, and we return a clean failure WITHOUT
    // touching disk or spawning a child.
    const caps = detectSandboxCapabilities();
    // Resolve the GLOBAL sandbox policy ourselves (policy is global-only; the
    // runner no longer accepts a per-run override). With a provider wired at
    // startup this is the durable cluster-wide default; with NO provider (or a
    // provider that throws) it FAILS CLOSED to the most restrictive safe policy
    // (deny egress, scratch + read-only managed packages, privilege drop) —
    // never the permissive default. The fail-closed fallback is surfaced as a
    // synthetic downgrade. On hosts lacking a primitive each layer
    // degrades-and-surfaces (never hard-breaks) per the resolved
    // `onUnavailable`.
    const { policy, failedClosed } = await resolveActiveSandboxPolicy();

    const sessionId = randomUUID();
    const markerStart = `##__CS_SCRIPT_RESULT_${sessionId}_START__##`;
    const markerEnd = `##__CS_SCRIPT_RESULT_${sessionId}_END__##`;

    // When a `resolutionRoot` is given, create the per-run dir *inside* it
    // so module resolution walks up to `<resolutionRoot>/node_modules`.
    // Otherwise fall back to `os.tmpdir()` (today's behavior - no
    // node_modules visible, fully backward compatible).
    //
    // The scratch dir is created BEFORE building the hardening so the
    // filesystem layer (Phase 2) can bind it into the namespace. When a
    // fail-closed policy refuses an unenforceable layer we clean the dir up
    // again and never spawn — equivalent to "didn't touch disk" from the
    // caller's view (the dir is gone).
    const tmpBase = resolutionRoot ?? tmpdir();
    const tmpDir = await mkdtemp(path.join(tmpBase, "checkstack-script-"));
    // The reconciled managed-package tree, exposed read-only under
    // `scratch-plus-ro`. Only meaningful when a resolutionRoot is set.
    const nodeModulesDir =
      resolutionRoot === undefined
        ? undefined
        : path.join(resolutionRoot, "node_modules");

    // Path at which we stage the network egress nftables ruleset (consumed by
    // `nsjail --nftables_file`, or the rootless launcher's fail-closed `nft
    // -f`). Resolved on the host before the namespace is entered, so a path
    // inside the per-run dir is fine.
    const nftRulesetPath = path.join(tmpDir, "egress.nft");
    // Path at which we stage the rootless egress launcher script (slirp4netns +
    // the fail-closed nft filter) when the network decision picks the rootless
    // path. Same per-run dir.
    const rootlessLauncherPath = path.join(tmpDir, "rootless-egress.sh");

    let hardening;
    try {
      hardening = buildSpawnHardening({
        policy,
        caps,
        baseEnv: pickSafeEnv(),
        // Fold the controlled ESM memory fallback (NODE_OPTIONS) in AFTER the
        // denylist runs on caller overrides, so a caller can't smuggle
        // NODE_OPTIONS but the sandbox can still set the heap cap.
        envOverrides: injectedEnv,
        filesystem: {
          scratchDir: tmpDir,
          nodeModulesDir,
          // Bind the Bun runtime read-only into the namespace; under FS
          // confinement the host FS is hidden and the interpreter commonly
          // lives outside /usr,/bin (e.g. ~/.bun/bin/bun), so without this the
          // child cannot exec the runtime.
          interpreterPath: realpathSync(process.execPath),
        },
        nftRulesetPath,
        rootlessLauncherPath,
        // The ESM runner execs a Bun/Node interpreter that honours
        // NODE_OPTIONS=--max-old-space-size, so the per-run JS-heap memory cap
        // IS applied here (unlike the shell runner).
        appliesNodeMemoryCap: true,
      });
      // Surface the fail-closed fallback as a notice in the report so a
      // missing/failed policy provider is never silent (the run still proceeds
      // under the most restrictive policy).
      if (failedClosed) {
        hardening.effective.downgrades.push({
          layer: "network",
          reason: FAIL_CLOSED_DOWNGRADE_REASON,
        });
      }
    } catch (error) {
      if (error instanceof SandboxUnavailableError) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {
          // Best-effort: nothing was written yet; the OS reaps any straggler.
        });
        return {
          stdout: "",
          stderr: "",
          timedOut: false,
          error: error.message,
          sandbox: {
            requested: policy,
            enforced: {
              resources: false,
              filesystem: false,
              network: false,
              privilege: false,
            },
            downgrades: error.downgrades,
            notes: [],
            platform: caps.platform,
          },
        };
      }
      throw error;
    }

    const userScriptPath = path.join(tmpDir, "user.mjs");
    const runnerPath = path.join(tmpDir, "runner.mjs");
    const bunfigPath = path.join(tmpDir, "bunfig.toml");

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

      // Disable Bun auto-install in the per-run dir ALWAYS. Without this,
      // `import "any-package"` silently fetches from the registry (verified
      // empirically), defeating the whole managed-allowlist model. With it,
      // an import resolves ONLY against the reconciled `<resolutionRoot>/
      // node_modules` (when set) and otherwise fails fast - the clear
      // degradation the package feature requires.
      await writeFile(bunfigPath, '[install]\nauto = "disable"\n', "utf8");

      // Stage the network egress ruleset (if the sandbox produced one) so the
      // wrapper can install it inside the child's net namespace.
      if (hardening.nftRuleset !== undefined) {
        await writeFile(nftRulesetPath, hardening.nftRuleset, "utf8");
      }
      // Stage the rootless egress launcher (slirp4netns orchestration) when the
      // sandbox picked the rootless path. The prelude execs it as `sh <path>`.
      if (hardening.rootlessLauncher !== undefined) {
        await writeFile(rootlessLauncherPath, hardening.rootlessLauncher, {
          encoding: "utf8",
          mode: 0o700,
        });
      }

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
        // The sandbox may prepend an rlimit prelude (e.g. `prlimit --as=... --`)
        // to the argv. CWD stays the per-run dir.
        cmd: hardening.wrapCmd([process.execPath, runnerPath]),
        // CWD = the per-run dir so Bun reads its `bunfig.toml`
        // (auto-install disabled) and resolves modules from
        // `<resolutionRoot>/node_modules` when set.
        cwd: tmpDir,
        // `hardening.env` is the safe-vars base overlaid with the caller's
        // injected env (denylist applied when the sandbox is enabled). The
        // controlled ESM memory fallback (NODE_OPTIONS=--max-old-space-size)
        // is merged on top — it is a sandbox-set cap, not a caller override,
        // so it is intentionally not subject to the denylist.
        env: { ...hardening.env, ...hardening.nodeMemoryFlagEnv },
        // NOTE: we deliberately do NOT pass `uid`/`gid` to Bun.spawn. On the
        // shipped Bun versions it is a silent no-op (the privilege drop is
        // carried by the namespace wrapper's `--uid`, or by inheritance from a
        // non-root supervisor), AND passing it is a forward-compat hazard: a
        // future Bun that honours it would spawn the WRAPPER itself as the
        // dropped id, breaking unprivileged-userns creation. `hardening.uid` is
        // observability-only. See wrapper.ts.
        stdout: "pipe",
        stderr: "pipe",
      });

      let stdout: string;
      let stderr: string;
      let streamTruncated = false;

      try {
        // Bounded-buffering capture: count bytes against the shared
        // `maxOutputBytes` budget and kill + flag the child once exceeded,
        // rather than buffering the whole output first (OOM guard on a degraded
        // host without RLIMIT_AS — plan §5.1). NOTE: a script that floods past
        // the cap loses its result marker (it is emitted last); that is an
        // acceptable degradation for abusive output, and the run is reported as
        // truncated + "no result".
        const captureProc = proc;
        const [captured] = (await Promise.race([
          Promise.all([
            readCappedOutput({
              stdout: captureProc.stdout as ReadableStream<Uint8Array>,
              stderr: captureProc.stderr as ReadableStream<Uint8Array>,
              maxOutputBytes: hardening.maxOutputBytes,
              onExceeded: () => captureProc.kill(),
            }),
            captureProc.exited,
          ]),
          timeoutPromise,
        ])) as [
          { stdout: string; stderr: string; truncated: boolean },
          number,
        ];
        stdout = captured.stdout;
        stderr = captured.stderr;
        streamTruncated = captured.truncated;
      } catch (error) {
        if (timedOut) {
          return {
            stdout: "",
            stderr: "",
            timedOut: true,
            error: "Script execution timed out",
            sandbox: hardening.effective,
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

      // Apply output truncation AFTER the result marker has been plucked, so
      // the cap never corrupts the marker the parent relies on. Truncation is
      // the portable resource-cap fallback (pure JS, every platform).
      const {
        stdout: cappedStdout,
        stderr: cappedStderr,
        truncated: trimTruncated,
      } = truncateCapturedOutput({
        stdout: stdout.trim(),
        stderr: cleanStderr,
        maxOutputBytes: hardening.maxOutputBytes,
      });
      const outputTruncated = streamTruncated || trimTruncated;

      if (!payload) {
        // The runner never got far enough to emit — typically a syntax
        // error in the user module or a hard crash. Surface whatever the
        // subprocess wrote to stderr as the error.
        return {
          stdout: cappedStdout,
          stderr: cappedStderr,
          timedOut: false,
          outputTruncated,
          sandbox: hardening.effective,
          error:
            cappedStderr.length > 0
              ? cappedStderr
              : "Script exited without producing a result",
        };
      }

      if (payload.ok) {
        return {
          result: payload.result,
          stdout: cappedStdout,
          stderr: cappedStderr,
          timedOut: false,
          outputTruncated,
          sandbox: hardening.effective,
        };
      }

      return {
        error: payload.error,
        stack: payload.stack,
        stdout: cappedStdout,
        stderr: cappedStderr,
        timedOut: false,
        outputTruncated,
        sandbox: hardening.effective,
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
