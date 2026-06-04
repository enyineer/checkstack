/**
 * Integration test for PER-RUN FORK-BOMB CONTAINMENT (Item 1), exercising the
 * REAL shell + ESM runners against a real `bwrap` + `prlimit` on a host that can
 * create unprivileged user namespaces. Pure/argv-level coverage (that `--nproc`
 * is emitted inside the bwrap userns) lives in `wrapper.test.ts`; this pins the
 * one thing that cannot: that the cap + the per-run PID namespace genuinely
 * CONTAIN an aggressive fork bomb (it fails cleanly, capped) while the
 * supervisor process stays alive and able to fork.
 *
 * The mechanism: rootless `bwrap --unshare-all` creates a fresh USER namespace
 * (so the per-(uid, userns) RLIMIT_NPROC isolates THIS run's process count even
 * though the child shares the supervisor's uid 65532) AND a fresh PID namespace
 * (so a single kill of the wrapper reaps the whole fork tree). Verified
 * in-container: the bomb hits the cap and the supervisor keeps forking.
 *
 * Gated behind `CHECKSTACK_IT=1` AND auto-skipped when the host cannot create a
 * user namespace + lacks a wrapper + prlimit (the detected capabilities say no),
 * so the default `bun test` and non-Linux/non-rootless CI never run it.
 */
import { describe, expect, it } from "bun:test";
import { detectSandboxCapabilities } from "./capabilities";
import {
  DEFAULT_SANDBOX_PROFILE,
  sandboxPolicySchema,
  type SandboxPolicy,
} from "./policy";
import { registerSandboxPolicyProvider } from "./provider";
import { defaultShellScriptRunner } from "../shell-script-runner";
import { defaultEsmScriptRunner } from "../esm-script-runner";

const caps = detectSandboxCapabilities();
// The cap is per-run-isolated only when the bwrap user namespace can actually be
// created and rlimits are enforceable; mirror exactly the in-container target.
const enabled =
  Boolean(process.env.CHECKSTACK_IT) &&
  caps.platform === "linux" &&
  caps.wrapper === "bwrap" &&
  caps.userNsCreatable &&
  caps.rlimitNative;

/** Can the supervisor still spawn a process right now? */
function supervisorCanFork(): boolean {
  const r = Bun.spawnSync(["sh", "-c", "echo alive"]);
  return (
    r.exitCode === 0 && new TextDecoder().decode(r.stdout).trim() === "alive"
  );
}

describe.skipIf(!enabled)("per-run fork-bomb containment (real bwrap)", () => {
  it("caps a shell fork bomb and keeps the supervisor alive", async () => {
    // A low maxProcesses so the cap bites quickly and deterministically.
    const policy: SandboxPolicy = sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      resources: { ...DEFAULT_SANDBOX_PROFILE.resources, maxProcesses: 64 },
    });
    registerSandboxPolicyProvider(async () => policy);

    const start = Date.now();
    const res = await defaultShellScriptRunner.run({
      script: ":(){ :|:& };:",
      timeoutMs: 8000,
    });
    const elapsed = Date.now() - start;

    // The run fails cleanly (the cap kills the bomb), WITHOUT timing out, and
    // every other layer stays enforced with no downgrades.
    expect(res.timedOut).toBe(false);
    expect(elapsed).toBeLessThan(8000);
    expect(res.sandbox?.enforced.resources).toBe(true);
    expect(res.sandbox?.enforced.filesystem).toBe(true);
    expect(res.sandbox?.enforced.network).toBe(true);
    expect(res.sandbox?.enforced.privilege).toBe(true);
    expect(res.sandbox?.downgrades ?? []).toHaveLength(0);
    // The fork-bomb cap is genuinely enforced per-run, so there is NO
    // "RLIMIT_NPROC not applied" note on this wrapped path.
    expect(
      (res.sandbox?.notes ?? []).some((n) => n.note.includes("RLIMIT_NPROC")),
    ).toBe(false);
    // The load-bearing assertion: the supervisor survived the bomb.
    expect(supervisorCanFork()).toBe(true);
  });

  it("caps an ESM spawn-loop bomb and keeps the supervisor alive", async () => {
    const policy: SandboxPolicy = sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      resources: { ...DEFAULT_SANDBOX_PROFILE.resources, maxProcesses: 64 },
    });
    registerSandboxPolicyProvider(async () => policy);

    const script = [
      'const { spawn } = await import("node:child_process");',
      "let n = 0;",
      "try {",
      "  while (n < 100000) { spawn('sleep', ['30']); n++; }",
      "} catch {}",
      "export default { spawned: n };",
    ].join("\n");

    const res = await defaultEsmScriptRunner.run({
      script,
      context: {},
      timeoutMs: 8000,
    });
    expect(res.timedOut).toBe(false);
    expect(res.sandbox?.enforced.resources).toBe(true);
    expect(res.sandbox?.enforced.privilege).toBe(true);
    expect(supervisorCanFork()).toBe(true);
  });

  it("still runs a benign script to success under the same fail-closed default", async () => {
    registerSandboxPolicyProvider(async () => DEFAULT_SANDBOX_PROFILE);
    const ok = await defaultShellScriptRunner.run({
      script: "echo hi; id -u",
      timeoutMs: 5000,
    });
    expect(ok.exitCode).toBe(0);
    // The script runs as the non-root supervisor uid by inheritance.
    expect(ok.stdout).toContain("hi");
    expect(ok.sandbox?.downgrades ?? []).toHaveLength(0);
  });
});
