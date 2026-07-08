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

  describe("resolveMany", () => {
    it("resolves the active backend id exactly once for the whole batch", async () => {
      const registry = createSecretBackendRegistry();
      registry.register(
        fakeBackend("local", { A: "a-val", B: "b-val", C: "c-val" }),
      );

      let idReads = 0;
      const store = createActiveBackendStore({
        backends: registry,
        getActiveBackendId: async () => {
          idReads++;
          return "local";
        },
      });

      const resolved = await store.resolveMany!(["A", "B", "C"]);
      expect(idReads).toBe(1);
      expect(resolved).toEqual(
        new Map([
          ["A", "a-val"],
          ["B", "b-val"],
          ["C", "c-val"],
        ]),
      );
    });

    it("de-dupes names and reads the active backend id once", async () => {
      const registry = createSecretBackendRegistry();
      let gets = 0;
      registry.register({
        id: "local",
        get: async ({ name }) => {
          gets++;
          return `val-${name}`;
        },
        list: async () => [],
      });

      let idReads = 0;
      const store = createActiveBackendStore({
        backends: registry,
        getActiveBackendId: async () => {
          idReads++;
          return "local";
        },
      });

      const resolved = await store.resolveMany!(["dup", "dup", "other"]);
      expect(idReads).toBe(1);
      expect(gets).toBe(2); // distinct names only
      expect(resolved).toEqual(
        new Map([
          ["dup", "val-dup"],
          ["other", "val-other"],
        ]),
      );
    });

    it("returns an empty map (and reads no backend id) for empty input", async () => {
      const registry = createSecretBackendRegistry();
      registry.register(fakeBackend("local", {}));

      let idReads = 0;
      const store = createActiveBackendStore({
        backends: registry,
        getActiveBackendId: async () => {
          idReads++;
          return "local";
        },
      });

      const resolved = await store.resolveMany!([]);
      expect(resolved.size).toBe(0);
      expect(idReads).toBe(0);
    });

    it("throws Secret not found on any absent name", async () => {
      const registry = createSecretBackendRegistry();
      registry.register(fakeBackend("local", { A: "a-val" }));
      const store = createActiveBackendStore({
        backends: registry,
        getActiveBackendId: async () => "local",
      });
      await expect(store.resolveMany!(["A", "missing"])).rejects.toThrow(
        "Secret not found: missing",
      );
    });
  });
});
