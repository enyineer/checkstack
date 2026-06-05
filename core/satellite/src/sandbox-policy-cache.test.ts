import { describe, expect, it } from "bun:test";
import {
  FAIL_CLOSED_SANDBOX_PROFILE,
  resolveDefaultSandboxProfile,
  sandboxPolicySchema,
} from "@checkstack/backend-api";
import { SatelliteSandboxPolicyCache } from "./sandbox-policy-cache";

const RELAYED = sandboxPolicySchema.parse({
  enabled: true,
  onUnavailable: "degrade",
  resources: { cpuSeconds: 42 },
  filesystem: { mode: "scratch-plus-ro" },
  network: { mode: "deny", allow: [], denyLinkLocalAndMetadata: true },
  privilege: { mode: "drop-to-uid" },
});

describe("SatelliteSandboxPolicyCache fail-closed-until-relay", () => {
  it("resolves the FAIL-CLOSED profile BEFORE any policy is relayed", async () => {
    const cache = new SatelliteSandboxPolicyCache();
    const policy = await cache.resolve();
    expect(policy).toEqual(FAIL_CLOSED_SANDBOX_PROFILE);
    // Crucially NOT the permissive shipped default.
    expect(policy).not.toEqual(resolveDefaultSandboxProfile());
    expect(policy.network.mode).toBe("deny");
  });

  it("resolves the CACHED relayed policy once one has been received", async () => {
    const cache = new SatelliteSandboxPolicyCache();
    cache.set(RELAYED);
    const policy = await cache.resolve();
    expect(policy).toEqual(RELAYED);
    expect(policy.resources.cpuSeconds).toBe(42);
  });

  it("a later relay replaces the cached policy", async () => {
    const cache = new SatelliteSandboxPolicyCache();
    cache.set(RELAYED);
    const next = sandboxPolicySchema.parse({
      ...RELAYED,
      network: { mode: "allowlist", allow: ["10.0.0.1"], denyLinkLocalAndMetadata: true },
    });
    cache.set(next);
    const policy = await cache.resolve();
    expect(policy.network.mode).toBe("allowlist");
    expect(policy.network.allow).toEqual(["10.0.0.1"]);
  });

  it("the provider closure fails closed until the first relay, then returns the cache", async () => {
    const cache = new SatelliteSandboxPolicyCache();
    const provider = cache.toProvider();
    expect(await provider()).toEqual(FAIL_CLOSED_SANDBOX_PROFILE);
    cache.set(RELAYED);
    expect(await provider()).toEqual(RELAYED);
  });
});
