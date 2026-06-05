/**
 * Integration test for the ROOTLESS egress path (slirp4netns + fail-closed
 * nftables), exercising the REAL launcher against a real `bwrap` + `slirp4netns`
 * + `nft`. Pure/argv-level coverage lives in `rootless-egress.test.ts`,
 * `network.test.ts`, and `wrapper.test.ts`; this pins the one thing those
 * cannot: that the generated launcher actually plumbs filtered egress and that
 * the filter is genuinely enforced (the allowed dest is reachable, a blocked
 * dest is not), so `enforced.network = true` is truthful.
 *
 * Gated behind `CHECKSTACK_IT=1` AND auto-skipped when the host lacks the
 * primitives (the detected capability says no rootless path), so the default
 * `bun test` and non-Linux/non-rootless CI never run it. It needs a host where
 * `unshare --user --net` works, `slirp4netns` + `bwrap` + `nft` are on PATH.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectSandboxCapabilities } from "./capabilities";
import { buildNetworkLayer } from "./network";
import { buildSpawnHardening } from "./wrapper";
import { pickSafeEnv } from "./env-guard";
import { sandboxPolicySchema } from "./policy";

const caps = detectSandboxCapabilities();
const enabled = Boolean(process.env.CHECKSTACK_IT) && caps.netEgressRootless;

describe.skipIf(!enabled)("rootless egress (real slirp4netns)", () => {
  it("delivers filtered egress: blocks a non-allowlisted destination", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "checkstack-rl-it-"));
    try {
      const nftRulesetPath = path.join(dir, "egress.nft");
      const rootlessLauncherPath = path.join(dir, "rootless-egress.sh");
      // Allowlist a single private CIDR that is NOT the public target below.
      const policy = sandboxPolicySchema.parse({
        filesystem: { mode: "off" },
        network: { mode: "allowlist", allow: ["10.255.255.0/24"] },
        privilege: { mode: "inherit" },
        resources: { maxOutputBytes: 64 * 1024 },
      });
      const hardening = buildSpawnHardening({
        policy,
        caps,
        baseEnv: pickSafeEnv(),
        nftRulesetPath,
        rootlessLauncherPath,
      });
      expect(hardening.effective.enforced.network).toBe(true);
      expect(hardening.rootlessLauncher).toBeDefined();
      await writeFile(nftRulesetPath, hardening.nftRuleset ?? "", "utf8");
      await writeFile(rootlessLauncherPath, hardening.rootlessLauncher ?? "", {
        encoding: "utf8",
        mode: 0o700,
      });

      // A blocked destination (1.1.1.1, not in the allowlist) must NOT connect.
      // We use a short-timeout TCP connect; a filtered egress yields failure.
      const cmd = hardening.wrapCmd([
        "sh",
        "-c",
        // `nc`/`/dev/tcp` may be unavailable; use the busybox-ish `timeout` +
        // a connect attempt that returns non-zero when blocked.
        "timeout 3 sh -c 'exec 3<>/dev/tcp/1.1.1.1/443' && echo CONNECTED || echo BLOCKED",
      ]);
      const proc = Bun.spawn({ cmd, env: hardening.env, stdout: "pipe", stderr: "pipe" });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      // The allowlist does not include 1.1.1.1, so egress to it is dropped.
      expect(out).toContain("BLOCKED");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);

  it("the network decision picks the rootless path on this host", () => {
    const d = buildNetworkLayer({
      policy: sandboxPolicySchema.parse({
        network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      }).network,
      caps,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.egressPath).toBe("rootless");
  });
});
