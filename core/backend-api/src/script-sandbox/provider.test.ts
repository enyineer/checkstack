import { afterEach, describe, expect, it } from "bun:test";
import {
  FAIL_CLOSED_SANDBOX_PROFILE,
  registerSandboxPolicyProvider,
  resetSandboxPolicyProvider,
  resolveActiveSandboxPolicy,
} from "./provider";
import { resolveDefaultSandboxProfile, type SandboxPolicy } from "./policy";

describe("script-sandbox policy provider", () => {
  afterEach(() => {
    resetSandboxPolicyProvider();
  });

  it("fails closed (deny egress, scratch-only) when no provider is registered", async () => {
    resetSandboxPolicyProvider();
    const { policy, failedClosed } = await resolveActiveSandboxPolicy();
    expect(failedClosed).toBe(true);
    expect(policy).toEqual(FAIL_CLOSED_SANDBOX_PROFILE);
    expect(policy.network.mode).toBe("deny");
    expect(policy.filesystem.mode).toBe("scratch-plus-ro");
    expect(policy.privilege.mode).toBe("drop-to-uid");
    expect(policy.enabled).toBe(true);
  });

  it("returns the registered provider's policy", async () => {
    const provided: SandboxPolicy = resolveDefaultSandboxProfile();
    registerSandboxPolicyProvider(async () => provided);
    const { policy, failedClosed } = await resolveActiveSandboxPolicy();
    expect(failedClosed).toBe(false);
    expect(policy).toEqual(provided);
  });

  it("fails closed when the provider throws (does not widen the sandbox)", async () => {
    registerSandboxPolicyProvider(async () => {
      throw new Error("transient db error");
    });
    const { policy, failedClosed } = await resolveActiveSandboxPolicy();
    expect(failedClosed).toBe(true);
    expect(policy).toEqual(FAIL_CLOSED_SANDBOX_PROFILE);
  });

  it("fail-closed network is never unrestricted", async () => {
    expect(FAIL_CLOSED_SANDBOX_PROFILE.network.mode).not.toBe("unrestricted");
    expect(FAIL_CLOSED_SANDBOX_PROFILE.network.allow).toEqual([]);
    expect(FAIL_CLOSED_SANDBOX_PROFILE.network.denyLinkLocalAndMetadata).toBe(
      true,
    );
  });

  it("last registered provider wins (single cluster-wide value)", async () => {
    registerSandboxPolicyProvider(async () => resolveDefaultSandboxProfile());
    const second: SandboxPolicy = {
      ...resolveDefaultSandboxProfile(),
      network: { mode: "deny", allow: [], denyLinkLocalAndMetadata: true },
    };
    registerSandboxPolicyProvider(async () => second);
    const { policy } = await resolveActiveSandboxPolicy();
    expect(policy.network.mode).toBe("deny");
  });
});
