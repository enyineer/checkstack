import { describe, expect, it } from "bun:test";
import { scriptPackagesContract } from "./rpc-contract";
import { scriptPackagesAccess, scriptSandboxAccess } from "./access";

/**
 * The global sandbox-policy endpoints must be gated by the DEDICATED admin
 * permission (`script-sandbox.manage`) for BOTH read and write — not the
 * package-management permission and not a general role. `autoAuthMiddleware`
 * enforces the `access` array on every procedure's meta, so asserting the meta
 * here proves the gate exists and that a caller without the permission is
 * rejected (the middleware denies any user missing a required access id).
 */
function accessIdsFor(procName: "getSandboxPolicy" | "setSandboxPolicy"): string[] {
  const proc = scriptPackagesContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = proc["~orpc"] as { meta?: { access?: { id: string }[] } };
  return (orpc.meta?.access ?? []).map((rule) => rule.id);
}

describe("global sandbox-policy endpoints are gated by the dedicated admin permission", () => {
  it("the dedicated permission is a distinct id, not script-packages.manage", () => {
    expect(scriptSandboxAccess.manage.id).toBe("script-sandbox.manage");
    expect(scriptSandboxAccess.manage.id).not.toBe(
      scriptPackagesAccess.manage.id,
    );
    // Not granted to regular authenticated users by default (admin-only).
    expect(scriptSandboxAccess.manage.isDefault).toBeFalsy();
    expect(scriptSandboxAccess.manage.isPublic).toBeFalsy();
  });

  it("READ (getSandboxPolicy) requires script-sandbox.manage", () => {
    const ids = accessIdsFor("getSandboxPolicy");
    expect(ids).toEqual([scriptSandboxAccess.manage.id]);
    expect(ids).not.toContain(scriptPackagesAccess.manage.id);
  });

  it("WRITE (setSandboxPolicy) requires script-sandbox.manage", () => {
    const ids = accessIdsFor("setSandboxPolicy");
    expect(ids).toEqual([scriptSandboxAccess.manage.id]);
    expect(ids).not.toContain(scriptPackagesAccess.manage.id);
  });
});
