import { describe, it, expect } from "bun:test";
import { createSecretBackendRegistry } from "./secret-backend-registry";
import { createActiveBackendStore } from "./active-backend";
import type { SecretBackend } from "./secret-backend";

function fakeBackend(id: string, values: Record<string, string>): SecretBackend {
  return {
    id,
    get: async ({ name }) => values[name],
    list: async () => [],
  };
}

describe("createActiveBackendStore", () => {
  it("resolves through whichever backend is active, and re-routes on switch", async () => {
    const registry = createSecretBackendRegistry();
    registry.register(fakeBackend("local", { db_pass: "local-value" }));
    registry.register(fakeBackend("vault", { db_pass: "vault-value" }));

    let active = "local";
    const store = createActiveBackendStore({
      backends: registry,
      getActiveBackendId: async () => active,
    });

    expect(await store.resolve("db_pass")).toBe("local-value");

    // Switch the active backend to vault — resolution re-routes with no
    // other change (the Phase-4 acceptance: active_backend=vault routes
    // resolution through Vault).
    active = "vault";
    expect(await store.resolve("db_pass")).toBe("vault-value");
  });

  it("throws a clear error when the active backend lacks the secret", async () => {
    const registry = createSecretBackendRegistry();
    registry.register(fakeBackend("vault", {}));
    const store = createActiveBackendStore({
      backends: registry,
      getActiveBackendId: async () => "vault",
    });
    await expect(store.resolve("absent")).rejects.toThrow(
      "Secret not found: absent",
    );
  });
});
