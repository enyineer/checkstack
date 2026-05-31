/**
 * Platform-wide leak-guard suite.
 *
 * One focused, explicit place asserting the core guarantee end-to-end: a
 * secret VALUE never crosses any DTO / persisted-record / user-facing
 * surface, across every path the platform exposes. Individual path tests
 * live with their features; this suite is the cross-cutting regression net
 * that wires the real services together and proves the invariant holds.
 *
 * The single canonical secret value used throughout; if it appears in any
 * surface output below, the test fails.
 */
import { describe, it, expect } from "bun:test";
import { z, configString } from "@checkstack/backend-api";
import { createSecretBackendRegistry } from "./secret-backend-registry";
import { createActiveBackendStore } from "./active-backend";
import { createSecretResolverService } from "./resolver-service";
import { createSecretAdminService } from "./admin-service";
import { createInternalSecretsService } from "./internal-secrets-service";
import { createMaskingContext } from "./masking-context";
import type { SecretBackend } from "./secret-backend";
import type { SecretMetadata } from "@checkstack/secrets-common";

const SECRET = "gh_TOPSECRET_value_9999";

/** In-memory local-style backend (writable). */
function localBackend(seed: Record<string, string> = {}): SecretBackend {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    id: "local",
    get: async ({ name }) => store.get(name),
    set: async ({ name, value }) => {
      store.set(name, value);
    },
    delete: async ({ name }) => {
      store.delete(name);
    },
    list: async (): Promise<SecretMetadata[]> =>
      [...store.entries()].map(([name]) => ({
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

/** Fake read-through Vault-style backend (no set/delete). */
function vaultBackend(seed: Record<string, string>): SecretBackend {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    id: "vault",
    get: async ({ name }) => store.get(name),
    list: async (): Promise<SecretMetadata[]> =>
      [...store.keys()].map((name) => ({
        id: name,
        name,
        description: null,
        hasValue: true,
        backend: "vault",
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
  };
}

describe("leak guard: list / get DTO surfaces", () => {
  it("listSecrets metadata never contains the value (local backend)", async () => {
    const local = localBackend({ db_pass: SECRET });
    const admin = createSecretAdminService({
      getActiveBackend: async () => local,
      onChanged: async () => {},
    });
    const list = await admin.list();
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(list.every((m) => !("value" in m))).toBe(true);
  });

  it("listSecrets metadata never contains the value (Vault backend)", async () => {
    const admin = createSecretAdminService({
      getActiveBackend: async () => vaultBackend({ db_pass: SECRET }),
      onChanged: async () => {},
    });
    expect(JSON.stringify(await admin.list())).not.toContain(SECRET);
  });

  it("internal secrets are excluded from the user-facing list", async () => {
    const local = localBackend();
    const admin = createSecretAdminService({
      getActiveBackend: async () => local,
      onChanged: async () => {},
    });
    const internal = createInternalSecretsService({
      getLocalBackend: () => local,
    });
    await admin.setSecret({ name: "jira_token", value: "user-secret-aaa" });
    await internal.set({ parts: ["connection", "c1", "apiToken"], value: SECRET });
    const names = (await admin.list()).map((m) => m.name);
    expect(names).toContain("jira_token");
    expect(names.some((n) => n.startsWith("__internal__:"))).toBe(false);
  });
});

describe("leak guard: run output masking (central + satellite)", () => {
  // The same maskScriptRunOutput path backs the central action runner, the
  // satellite collector, and the automation step result. resolveForRun
  // yields the run-scoped masking context that redacts the value.
  it("a script run that echoes its injected secret is fully masked", async () => {
    const local = localBackend({ jira_token: SECRET });
    const resolver = createSecretResolverService({
      secretStore: createActiveBackendStore({
        backends: registryWith(local),
        getActiveBackendId: async () => "local",
      }),
    });
    const { env, masking } = await resolver.resolveForRun({
      secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
    });
    // The env carries the real value (it must, to inject into the run)...
    expect(env.API_TOKEN).toBe(SECRET);
    // ...but every output surface masked with the run context is redacted.
    const stdout = masking.maskText(`echo ${SECRET}`);
    const result = masking.maskDeep({ token: SECRET, nested: [SECRET] });
    expect(stdout).toBe("echo ****");
    expect(result).toEqual({ token: "****", nested: ["****"] });
    expect(JSON.stringify({ stdout, result })).not.toContain(SECRET);
  });

  it("an automation step result payload is masked deeply", async () => {
    const masking = createMaskingContext({ values: [SECRET] });
    const stepResult = masking.maskDeep({
      externalId: "x",
      detail: { auth: `Bearer ${SECRET}` },
      lines: [`logged ${SECRET}`],
    });
    expect(JSON.stringify(stepResult)).not.toContain(SECRET);
  });
});

describe("leak guard: Vault-backed resolution routes + masks", () => {
  it("resolving through the active Vault backend yields a masking context that redacts the value", async () => {
    const backends = createSecretBackendRegistry();
    backends.register(localBackend());
    backends.register(vaultBackend({ vault_secret: SECRET }));
    const resolver = createSecretResolverService({
      secretStore: createActiveBackendStore({
        backends,
        getActiveBackendId: async () => "vault", // active = vault
      }),
    });
    const { env, masking } = await resolver.resolveForRun({
      secretEnv: { TOKEN: "${{ secrets.vault_secret }}" },
    });
    expect(env.TOKEN).toBe(SECRET);
    expect(masking.maskText(`x=${SECRET}`)).toBe("x=****");
  });

  it("gitops/connection-style x-secret field resolves a ${{ secrets.NAME }} reference through the active Vault backend", async () => {
    // Mirrors how gitops descriptors and connection credentials resolve:
    // resolveBySchema walks x-secret fields and resolves the template
    // through whichever backend is active. With Vault active, a referenced
    // secret originating from Vault resolves through the ONE channel.
    const backends = createSecretBackendRegistry();
    backends.register(localBackend());
    backends.register(vaultBackend({ db_pass: SECRET }));
    const resolver = createSecretResolverService({
      secretStore: createActiveBackendStore({
        backends,
        getActiveBackendId: async () => "vault",
      }),
    });
    const schema = z.object({
      host: z.string(),
      // configString({ "x-secret": true }) marks this resolvable.
      password: configString({ "x-secret": true }),
    });
    const { resolved } = await resolver.resolveBySchema({
      value: { host: "db.internal", password: "${{ secrets.db_pass }}" },
      schema,
    });
    expect(resolved).toEqual({ host: "db.internal", password: SECRET });
  });
});

function registryWith(backend: SecretBackend) {
  const r = createSecretBackendRegistry();
  r.register(backend);
  return r;
}
