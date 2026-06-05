import { spawn, type Subprocess } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectSandboxCapabilities } from "./script-sandbox/capabilities";
import { readCappedOutput } from "./script-sandbox/capped-output";
import { pickSafeEnv } from "./script-sandbox/env-guard";
import { buildNetworkLayer } from "./script-sandbox/network";
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
  /** True if captured output exceeded the sandbox `maxOutputBytes` cap and was trimmed. */
  outputTruncated?: boolean;
  /**
   * What the OS-level sandbox actually enforced / degraded for this run.
   * Always present: the runner resolves the active GLOBAL policy itself and
   * reports the result so callers can surface downgrades.
   */
  sandbox?: EffectiveSandbox;
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
   *
   * Note: forbidden keys (`LD_PRELOAD`, `NODE_OPTIONS`, `PATH`-override, ...)
   * are dropped from these overrides by the shared env denylist whenever the
   * active sandbox policy is enabled.
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
// DEFAULT RUNNER
// =============================================================================

/**
 * Default runner implementation. Production code should use this; tests
 * can substitute a mock that conforms to {@link ShellScriptRunner}.
 */
export const defaultShellScriptRunner: ShellScriptRunner = {
  async run({ script, timeoutMs, cwd, env }) {
    // Per-run dir for staging the network egress nftables ruleset, created
    // lazily only if the resolved policy actually produces one (so an ordinary
    // shell run pays no extra I/O). Cleaned up in `finally`.
    let nftDir: string | undefined;
    // Per-run writable scratch dir. Required to ENGAGE the namespace wrapper
    // (bwrap/nsjail): the wrapper is what delivers filesystem confinement, the
    // network namespace, AND the privilege drop (`--uid`, the only mechanism
    // that actually drops since Bun.spawn ignores uid/gid). Without a scratch
    // dir the FS layer degrades, the wrapper never engages, and under the
    // secure fail-closed default the run would be REFUSED. Created for every
    // run; cleaned up in `finally`. The shell script's CWD is this dir (unless
    // the caller pinned a `cwd`), so `mktemp`-style writes land in confinement.
    let scratchDir: string | undefined;
    // Reconcile the requested policy against this host's capabilities BEFORE
    // spawning. `buildSpawnHardening` is pure + synchronous (capability
    // detection is cached per-process), so no `await` is introduced here. When
    // `onUnavailable: "fail"` and a layer is unavailable it throws, and we
    // return a clean failure WITHOUT spawning an unsandboxed child.
    const caps = detectSandboxCapabilities();
    // Resolve the GLOBAL sandbox policy ourselves (policy is global-only; the
    // runner no longer accepts a per-run override). With a provider wired at
    // startup this is the durable cluster-wide default; with NO provider (or a
    // provider that throws) it FAILS CLOSED to the most restrictive safe policy
    // (deny egress, scratch + read-only packages, privilege drop) — never the
    // permissive default. The fail-closed fallback is surfaced as a synthetic
    // downgrade so callers can see it. On hosts lacking a primitive each layer
    // degrades-and-surfaces (never hard-breaks) per the resolved
    // `onUnavailable`.
    const { policy, failedClosed } = await resolveActiveSandboxPolicy();
    // Resolve the network decision up front (pure) to learn whether an nftables
    // ruleset must be staged on disk. Avoids creating a temp dir for the common
    // no-network run, and lets a fail-closed allowlist still build correctly
    // (the ruleset is staged BEFORE the hardening build that fails-closed).
    const netDecision = buildNetworkLayer({ policy: policy.network, caps });
    let nftRulesetPath: string | undefined;
    let rootlessLauncherPath: string | undefined;
    let hardening;
    try {
      if (
        netDecision.kind === "namespaced" &&
        netDecision.nftRuleset !== undefined
      ) {
        nftDir = await mkdtemp(path.join(tmpdir(), "checkstack-egress-"));
        nftRulesetPath = path.join(nftDir, "egress.nft");
        // The rootless slirp4netns path additionally needs a launcher script
        // staged alongside the ruleset (the orchestration is not a plain argv
        // prelude). Same temp dir.
        if (netDecision.egressPath === "rootless") {
          rootlessLauncherPath = path.join(nftDir, "rootless-egress.sh");
        }
      }
      // Stage a per-run scratch dir so the FS/network/privilege wrapper can
      // engage (see the `scratchDir` declaration). Only needed when the sandbox
      // is enabled; a disabled policy runs unwrapped exactly as before.
      if (policy.enabled) {
        scratchDir = await mkdtemp(path.join(tmpdir(), "checkstack-shell-"));
      }
      hardening = buildSpawnHardening({
        policy,
        caps,
        baseEnv: pickSafeEnv(),
        envOverrides: env,
        ...(scratchDir === undefined ? {} : { filesystem: { scratchDir } }),
        nftRulesetPath,
        rootlessLauncherPath,
        // Shell scripts exec `sh -c`, which IGNORES NODE_OPTIONS, so the per-run
        // JS-heap memory cap is NOT applied here. Leaving this false makes the
        // hardening builder surface an honest, non-fatal memory note (the
        // ceiling is the container cgroup) rather than implying a per-run
        // guarantee. See the shell-memory honesty note in wrapper.ts.
        appliesNodeMemoryCap: false,
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
      if (hardening.nftRuleset !== undefined && nftRulesetPath !== undefined) {
        await writeFile(nftRulesetPath, hardening.nftRuleset, "utf8");
      }
      if (
        hardening.rootlessLauncher !== undefined &&
        rootlessLauncherPath !== undefined
      ) {
        await writeFile(rootlessLauncherPath, hardening.rootlessLauncher, {
          encoding: "utf8",
          mode: 0o700,
        });
      }
    } catch (error) {
      if (error instanceof SandboxUnavailableError) {
        if (nftDir !== undefined) {
          await rm(nftDir, { recursive: true, force: true }).catch(() => {});
        }
        return {
          exitCode: -1,
          stdout: "",
          stderr: error.message,
          timedOut: false,
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
      if (nftDir !== undefined) {
        await rm(nftDir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }

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
      // rather than a single argv vector. The sandbox may prepend an
      // rlimit prelude (e.g. `prlimit --cpu=... --`) to the argv.
      proc = spawn({
        cmd: hardening.wrapCmd(["sh", "-c", script]),
        // Default the CWD to the per-run scratch dir so unconfined runs still
        // write temp files somewhere disposable; an explicit caller `cwd` wins.
        // Under FS confinement the wrapper `--chdir`s into the scratch dir
        // itself, so this only affects the non-wrapped path.
        cwd: cwd ?? scratchDir,
        env: hardening.env,
        // NOTE: we deliberately do NOT pass `uid`/`gid` to Bun.spawn. It is a
        // silent no-op on the shipped Bun versions (the drop is carried by the
        // namespace wrapper's `--uid`, or by inheritance from a non-root
        // supervisor) AND a forward-compat hazard: a future Bun honouring it
        // would spawn the WRAPPER itself as the dropped id and break userns
        // creation. `hardening.uid` is observability-only. See wrapper.ts.
        stdout: "pipe",
        stderr: "pipe",
      });

      // Bounded-buffering capture: count bytes off stdout/stderr against the
      // shared `maxOutputBytes` budget and kill + flag the child the moment it
      // is exceeded, instead of buffering the entire (possibly gigabytes-large)
      // output first. This is the OOM guard for a degraded host without the
      // RLIMIT_AS cap (plan §5.1).
      const captureProc = proc;
      const [{ stdout: stdoutRaw, stderr: stderrRaw, truncated: streamTruncated }, exitCode] =
        await Promise.race([
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
        ]);

      // Final cosmetic pass: ensures clean multi-byte boundaries and re-asserts
      // the combined cap. A no-op when the stream stayed under budget.
      const { stdout, stderr, truncated: trimTruncated } = truncateCapturedOutput({
        stdout: stdoutRaw,
        stderr: stderrRaw,
        maxOutputBytes: hardening.maxOutputBytes,
      });
      const truncated = streamTruncated || trimTruncated;

      return {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false,
        outputTruncated: truncated,
        sandbox: hardening.effective,
      };
    } catch (error) {
      if (timedOut) {
        return {
          exitCode: -1,
          stdout: "",
          stderr: "Script execution timed out",
          timedOut: true,
          sandbox: hardening.effective,
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
      // Remove the per-run scratch dir, if one was created.
      if (scratchDir !== undefined) {
        await rm(scratchDir, { recursive: true, force: true }).catch(() => {
          // Best-effort; the OS reaps anything left in /tmp.
        });
      }
      // Remove the staged egress ruleset dir, if one was created.
      if (nftDir !== undefined) {
        await rm(nftDir, { recursive: true, force: true }).catch(() => {
          // Best-effort; the OS reaps anything left in /tmp.
        });
      }
    }
  },
};
