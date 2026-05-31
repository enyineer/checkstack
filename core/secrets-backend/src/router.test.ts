import { describe, it, expect } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import { createSecretsRouter } from "./router";
import { createSecretBackendRegistry } from "./secret-backend-registry";
import type { SecretBackend } from "./secret-backend";

const mockUser = {
  type: "user" as const,
  id: "test-user",
  accessRules: ["*"],
  roles: ["admin"],
};

/** Fully writable backend (local): implements both `set` and `delete`. */
function localBackend(): SecretBackend {
  return {
    id: "local",
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  };
}

/** Read-through backend (vault): implements neither `set` nor `delete`. */
function vaultBackend(): SecretBackend {
  return {
    id: "vault",
    get: async () => undefined,
    list: async () => [],
  };
}

function makeRouter(active: string, backends: SecretBackend[]) {
  const registry = createSecretBackendRegistry();
  for (const b of backends) registry.register(b);
  return createSecretsRouter({
    backends: registry,
    getActiveBackendId: async () => active,
    setActiveBackendId: async () => {},
    emitChanged: async () => {},
  });
}

describe("getBackendConfig — writable capability flag", () => {
  it("reports writable: true when the local backend is active", async () => {
    const router = makeRouter("local", [localBackend(), vaultBackend()]);
    const context = createMockRpcContext({ user: mockUser });

    const dto = await call(router.getBackendConfig, undefined, { context });

    expect(dto.activeBackend).toBe("local");
    expect(dto.writable).toBe(true);
  });

  it("reports writable: false when a read-through (Vault) backend is active", async () => {
    const router = makeRouter("vault", [localBackend(), vaultBackend()]);
    const context = createMockRpcContext({ user: mockUser });

    const dto = await call(router.getBackendConfig, undefined, { context });

    expect(dto.activeBackend).toBe("vault");
    expect(dto.writable).toBe(false);
  });

  it("reports writable: false when the active backend is unresolved", async () => {
    // Active id points at a backend that is not registered.
    const router = makeRouter("missing", [localBackend()]);
    const context = createMockRpcContext({ user: mockUser });

    const dto = await call(router.getBackendConfig, undefined, { context });

    expect(dto.writable).toBe(false);
  });
});
