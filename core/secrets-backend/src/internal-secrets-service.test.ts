import { describe, it, expect } from "bun:test";
import { internalSecretName } from "@checkstack/secrets-common";
import { createInternalSecretsService } from "./internal-secrets-service";
import { createSecretAdminService } from "./admin-service";
import type { SecretBackend } from "./secret-backend";

/** In-memory local-style backend (writable). */
function memoryBackend(): SecretBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    id: "local",
    store,
    get: async ({ name }) => store.get(name),
    set: async ({ name, value }) => {
      store.set(name, value);
    },
    delete: async ({ name }) => {
      store.delete(name);
    },
    list: async () =>
      [...store.keys()].map((name) => ({
        id: name,
        name,
        description: null,
        hasValue: true,
        backend: "local",
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
  };
}

describe("InternalSecretsService", () => {
  it("round-trips an internal secret on the local backend under the reserved prefix", async () => {
    const local = memoryBackend();
    const internal = createInternalSecretsService({
      getLocalBackend: () => local,
    });

    await internal.set({
      parts: ["script-packages", "registry-auth-token"],
      value: "npm_token_value",
    });
    expect(
      await internal.get({ parts: ["script-packages", "registry-auth-token"] }),
    ).toBe("npm_token_value");
    // Stored under the reserved internal name.
    expect(
      local.store.get(
        internalSecretName("script-packages", "registry-auth-token"),
      ),
    ).toBe("npm_token_value");
  });

  it("delete is idempotent", async () => {
    const internal = createInternalSecretsService({
      getLocalBackend: memoryBackend,
    });
    await internal.delete({ parts: ["x", "y"] });
    expect(await internal.get({ parts: ["x", "y"] })).toBeUndefined();
  });
});

describe("admin list hides internal secrets", () => {
  it("excludes reserved internal names from the user-facing list", async () => {
    const local = memoryBackend();
    const internal = createInternalSecretsService({
      getLocalBackend: () => local,
    });
    const admin = createSecretAdminService({
      getActiveBackend: async () => local,
      onChanged: async () => {},
    });

    // A user-managed secret + an internal one.
    await admin.setSecret({ name: "jira_token", value: "user-value" });
    await internal.set({ parts: ["connection", "c1", "apiToken"], value: "v" });

    const listed = await admin.list();
    const names = listed.map((m) => m.name);
    expect(names).toContain("jira_token");
    expect(names.some((n) => n.startsWith("__internal__:"))).toBe(false);
  });
});
