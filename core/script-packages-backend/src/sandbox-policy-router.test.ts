import { describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import {
  createMockRpcContext,
  resolveDefaultSandboxProfile,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { scriptSandboxAccess } from "@checkstack/script-packages-common";
import type { SandboxPolicy } from "@checkstack/common";
import { createScriptPackagesRouter } from "./router";
import type { SandboxPolicyService } from "./sandbox-policy";
import * as schema from "./schema";

/**
 * Router-level permission-gating test: a real `getSandboxPolicy` /
 * `setSandboxPolicy` call through `autoAuthMiddleware` must be REJECTED for a
 * user lacking `script-packages.script-sandbox.manage`, and accepted for one
 * who holds it. This proves the admin gate end-to-end (not just the contract
 * meta).
 */

const QUALIFIED = `script-packages.${scriptSandboxAccess.manage.id}`;

function buildRouter(service: SandboxPolicyService) {
  // Only the sandbox-policy deps are exercised; the rest are unused stubs.
  const unused = () => {
    throw new Error("not used in this test");
  };
  return createScriptPackagesRouter({
    db: {} as unknown as SafeDatabase<typeof schema>,
    blobStores: { ids: () => [], has: () => false } as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
    triggerInstall: unused as never,
    triggerMigration: unused as never,
    triggerBlobGc: unused as never,
    triggerAudit: unused as never,
    registryToken: {} as never,
    sandboxPolicy: service,
    onSandboxPolicyChanged: async () => {},
  });
}

function stubService(): SandboxPolicyService & { written: SandboxPolicy[] } {
  const written: SandboxPolicy[] = [];
  return {
    written,
    read: async () => resolveDefaultSandboxProfile(),
    write: async () => {
      const resolved = resolveDefaultSandboxProfile();
      written.push(resolved);
      return resolved;
    },
  };
}

describe("getSandboxPolicy / setSandboxPolicy permission gating", () => {
  it("REJECTS read for a user without the dedicated permission", async () => {
    const router = buildRouter(stubService());
    const ctx = createMockRpcContext({
      pluginMetadata: { pluginId: "script-packages" },
      user: { type: "user", id: "u1", accessRules: [] },
    });
    expect(
      call(router.getSandboxPolicy, undefined, { context: ctx }),
    ).rejects.toThrow();
  });

  it("REJECTS write for a user without the dedicated permission", async () => {
    const router = buildRouter(stubService());
    const ctx = createMockRpcContext({
      pluginMetadata: { pluginId: "script-packages" },
      // Holds the OTHER script-packages permission but NOT script-sandbox.manage.
      user: {
        type: "user",
        id: "u1",
        accessRules: ["script-packages.script-packages.manage"],
      },
    });
    expect(
      call(router.setSandboxPolicy, { enabled: false }, { context: ctx }),
    ).rejects.toThrow();
  });

  it("ALLOWS read+write for a user holding the dedicated permission", async () => {
    const service = stubService();
    const router = buildRouter(service);
    const ctx = createMockRpcContext({
      pluginMetadata: { pluginId: "script-packages" },
      user: { type: "user", id: "admin", accessRules: [QUALIFIED] },
    });

    const policy = await call(router.getSandboxPolicy, undefined, {
      context: ctx,
    });
    expect(policy.enabled).toBe(true);

    const written = await call(
      router.setSandboxPolicy,
      { network: { mode: "deny" } },
      { context: ctx },
    );
    expect(written).toBeDefined();
    expect(service.written.length).toBe(1);
  });
});
