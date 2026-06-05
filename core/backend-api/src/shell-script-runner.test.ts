import { afterEach, describe, expect, it } from "bun:test";
import { defaultShellScriptRunner } from "./shell-script-runner";
import {
  registerSandboxPolicyProvider,
  resetSandboxPolicyProvider,
} from "./script-sandbox/provider";
import {
  resolveDefaultSandboxProfile,
  sandboxPolicySchema,
  type SandboxPolicyInput,
} from "./script-sandbox/policy";

/** Register a one-shot provider returning the given (partial) policy. */
function withPolicy(input: SandboxPolicyInput): void {
  const policy = sandboxPolicySchema.parse(input);
  registerSandboxPolicyProvider(async () => policy);
}

/**
 * Register the shipped default profile but pinned to `onUnavailable: "degrade"`.
 *
 * The shipped default is now fail-closed (`onUnavailable: "fail"`): on a
 * capability-poor CI/dev host (non-root macOS, no bwrap/prlimit) it refuses
 * EVERY spawn. The runner-BEHAVIOR tests below (an ordinary echo runs, the env
 * denylist is applied, layers degrade-and-surface) need a deterministic spawn
 * on any host, so they use the `degrade` variant. The fail-closed default value
 * is asserted in `policy.test.ts`; the fail-closed RUNTIME refusal is asserted
 * by the dedicated "fails cleanly (no spawn)" test below.
 */
function withDefaultDegradePolicy(): void {
  const policy = sandboxPolicySchema.parse({
    ...resolveDefaultSandboxProfile(),
    onUnavailable: "degrade",
  });
  registerSandboxPolicyProvider(async () => policy);
}

describe("defaultShellScriptRunner — sandbox default profile", () => {
  afterEach(() => {
    resetSandboxPolicyProvider();
  });

  it("applies the provider's policy (the shipped default) and surfaces a report", async () => {
    withDefaultDegradePolicy();
    const result = await defaultShellScriptRunner.run({
      script: "echo hi",
      timeoutMs: 5000,
    });

    // Default-on must NOT break the common case: an ordinary echo still runs.
    // On a host lacking the strong primitives (the typical CI/dev box) the FS
    // and metadata-block layers degrade-and-surface — never hard-break.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hi");
    expect(result.sandbox).toBeDefined();
    // The shipped default profile is the base: resource caps, FS confinement,
    // a secure-by-default egress posture, and a privilege drop are all
    // REQUESTED; the report carries the requested policy regardless of host.
    expect(result.sandbox?.requested.enabled).toBe(true);
    expect(result.sandbox?.requested.resources.cpuSeconds).toBe(60);
    expect(result.sandbox?.requested.filesystem.mode).toBe("scratch-plus-ro");
    // Secure-by-default: egress is denied via an empty allowlist, NOT
    // unrestricted.
    expect(result.sandbox?.requested.network.mode).toBe("allowlist");
    expect(result.sandbox?.requested.network.allow).toEqual([]);
    expect(result.sandbox?.requested.network.denyLinkLocalAndMetadata).toBe(
      true,
    );
    expect(result.sandbox?.requested.privilege.mode).toBe("drop-to-uid");
  });

  it("enforces the provider's policy (network deny is requested)", async () => {
    withPolicy({ network: { mode: "deny" } });
    const result = await defaultShellScriptRunner.run({
      script: "echo enforced",
      timeoutMs: 5000,
    });
    expect(result.stdout).toBe("enforced");
    expect(result.sandbox?.requested.network.mode).toBe("deny");
  });

  it("fails closed (most restrictive policy) when no provider is registered", async () => {
    resetSandboxPolicyProvider();
    const result = await defaultShellScriptRunner.run({
      script: "echo closed",
      timeoutMs: 5000,
    });
    // Still runs the simple case, but under the fail-closed policy: deny
    // egress, scratch + read-only packages, privilege drop, and a surfaced
    // notice.
    expect(result.stdout).toBe("closed");
    expect(result.sandbox?.requested.network.mode).toBe("deny");
    expect(result.sandbox?.requested.filesystem.mode).toBe("scratch-plus-ro");
    const reasons = result.sandbox?.downgrades.map((d) => d.reason) ?? [];
    expect(
      reasons.some((r) => r.includes("no global sandbox policy provider")),
    ).toBe(true);
  });

  it("degrades, never hard-breaks, on a host lacking the strong primitives", async () => {
    withDefaultDegradePolicy();
    // Default profile requests FS confinement; on a CI/dev box with no
    // namespace wrapper the FS layer (and the metadata block) cannot be
    // enforced. The guarantee: the run STILL succeeds and the report surfaces
    // every dropped layer — it does not refuse to run.
    const hasWrapper =
      process.platform === "linux" &&
      Bun.spawnSync(["sh", "-c", "command -v bwrap || command -v nsjail"])
        .exitCode === 0;
    const result = await defaultShellScriptRunner.run({
      script: "echo ok",
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    if (!hasWrapper) {
      // FS confinement degraded (no wrapper) — surfaced, not silently dropped.
      const layers = result.sandbox?.downgrades.map((d) => d.layer) ?? [];
      expect(layers).toContain("filesystem");
      expect(result.sandbox?.enforced.filesystem).toBe(false);
    }
  });

  it("opts out globally with { enabled: false } and runs exactly as before", async () => {
    // The documented GLOBAL opt-out: no caps, no denylist, no confinement.
    withPolicy({ enabled: false });
    const result = await defaultShellScriptRunner.run({
      script: "echo out",
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("out");
    expect(result.sandbox?.enforced.resources).toBe(false);
    expect(result.sandbox?.enforced.filesystem).toBe(false);
  });

  it("drops a forbidden env override (LD_PRELOAD) when enabled", async () => {
    withDefaultDegradePolicy();
    const result = await defaultShellScriptRunner.run({
      script: "echo \"LD=$LD_PRELOAD\"",
      timeoutMs: 5000,
      env: { LD_PRELOAD: "/evil.so" },
    });
    expect(result.exitCode).toBe(0);
    // The child never received LD_PRELOAD.
    expect(result.stdout).toBe("LD=");
    expect(result.sandbox?.downgrades).toBeDefined();
  });

  it("opts out with { enabled: false } — forbidden keys pass through (back-compat)", async () => {
    withPolicy({ enabled: false });
    const result = await defaultShellScriptRunner.run({
      script: "echo \"LD=$LD_PRELOAD\"",
      timeoutMs: 5000,
      env: { LD_PRELOAD: "/passthrough.so" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("LD=/passthrough.so");
  });

  it("does not leak unrelated process env (existing security guarantee)", async () => {
    withDefaultDegradePolicy();
    process.env.SHELL_RUNNER_SECRET = "DO_NOT_LEAK";
    const result = await defaultShellScriptRunner.run({
      script: "env",
      timeoutMs: 5000,
    });
    delete process.env.SHELL_RUNNER_SECRET;
    expect(result.stdout).not.toContain("DO_NOT_LEAK");
  });

  it("truncates output and flags it when over maxOutputBytes", async () => {
    withPolicy({ resources: { maxOutputBytes: 200 } });
    const result = await defaultShellScriptRunner.run({
      // ~2000 bytes of output
      script: "for i in $(seq 1 100); do echo 'xxxxxxxxxxxxxxxxxxxx'; done",
      timeoutMs: 5000,
    });
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(200);
  });

  it("kills a flooding child once maxOutputBytes is hit (bounded buffering, no OOM)", async () => {
    // `yes` emits effectively unbounded output. With a tiny cap the runner must
    // stream-count, hit the cap, KILL the child, and flag truncation — instead
    // of buffering gigabytes first. If the OOM-safe streaming path regressed,
    // this would hang until the wall-clock timeout (and/or balloon memory).
    withPolicy({ resources: { maxOutputBytes: 4096 } });
    const start = Date.now();
    const result = await defaultShellScriptRunner.run({
      script: "yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      timeoutMs: 10_000,
    });
    const elapsed = Date.now() - start;
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(4096);
    // Should finish promptly via the kill, NOT ride out the 10s timeout.
    expect(elapsed).toBeLessThan(8000);
    expect(result.timedOut).toBe(false);
  });

  it("fails cleanly (no spawn) when onUnavailable:fail and a layer is unenforceable", async () => {
    // On a host lacking the namespace wrapper (the typical non-Linux dev/CI
    // box), the filesystem + network namespace layers cannot be enforced, so a
    // fail-closed (onUnavailable:fail) policy must refuse without spawning.
    // (Privilege is now enforced by non-root inheritance and is NOT the failing
    // layer; FS/network are.)
    const isRoot = process.getuid?.() === 0;
    if (isRoot && process.platform === "linux") {
      // On a capable host this might enforce; skip the negative assertion.
      return;
    }
    withPolicy({
      onUnavailable: "fail",
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "drop-to-uid", uid: 1001 },
    });
    const result = await defaultShellScriptRunner.run({
      script: "echo should-not-run",
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("sandbox unavailable");
  });

  it("scratch dir is writable by the run's effective identity (ownership)", async () => {
    // The reviewer flagged: is the per-run scratch dir writable by the run's
    // effective identity? Under the non-root supervisor it trivially is - the
    // supervisor (uid 65532) does the mkdtemp and the script inherits that uid,
    // so it owns the dir. We prove it end-to-end: a shell run (CWD = the per-run
    // scratch dir on the unconfined path) writes a file into its CWD and reads
    // it back. A write failure (EACCES) would surface as a non-zero exit.
    withDefaultDegradePolicy();
    const result = await defaultShellScriptRunner.run({
      // Write into the CWD (the per-run scratch dir), then read it back.
      script: 'echo owned > probe.txt && cat probe.txt',
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("owned");
  });
});
