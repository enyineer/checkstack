import { describe, it, expect } from "bun:test";
import type { SecretMetadata } from "@checkstack/secrets-common";
import { createVaultBackend } from "./vault-backend";
import { createVaultFake } from "./vault-fake";
import type { VaultIndexStore, SecretIndexRow } from "./index-store";
import { toSecretMetadata } from "./index-store";
import type { VaultConfigStore, StoredVaultConfig } from "./vault-config-store";

const ADDRESS = "https://vault.example.com";

/** In-memory index store. */
function fakeIndexStore(
  rows: Array<Pick<SecretIndexRow, "name" | "vaultPath" | "vaultKey">>,
): VaultIndexStore {
  const full: SecretIndexRow[] = rows.map((r, i) => ({
    id: `id-${i}`,
    name: r.name,
    vaultPath: r.vaultPath,
    vaultKey: r.vaultKey,
    description: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  return {
    lookup: async (name) => full.find((r) => r.name === name),
    list: async (): Promise<SecretMetadata[]> => full.map(toSecretMetadata),
    upsert: async () => {},
    remove: async () => {},
  };
}

/** In-memory config store seeded with a config. */
function fakeConfigStore(initial?: StoredVaultConfig): VaultConfigStore {
  let cfg = initial;
  return {
    load: async () => cfg,
    loadRedacted: async () => {
      if (!cfg) return undefined;
      const { credential: _omit, ...rest } = cfg;
      return rest;
    },
    save: async (c) => {
      cfg = c;
    },
  };
}

const tokenConfig: StoredVaultConfig = {
  address: ADDRESS,
  mount: "secret",
  authMethod: "token",
  credential: "s.real-token",
};

describe("VaultBackend.get", () => {
  it("resolves a value via the index → KV v2 read", async () => {
    const { fetchImpl, kvReadCount } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv: { "myapp/db": { password: "p@ssw0rd", user: "admin" } },
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([
        { name: "db_pass", vaultPath: "myapp/db", vaultKey: "password" },
      ]),
      configStore: fakeConfigStore(tokenConfig),
      fetchImpl,
    });

    expect(await backend.get({ name: "db_pass" })).toBe("p@ssw0rd");
    expect(kvReadCount()).toBe(1);
  });

  it("returns undefined for a name not in the index", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv: {},
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([]),
      configStore: fakeConfigStore(tokenConfig),
      fetchImpl,
    });
    expect(await backend.get({ name: "absent" })).toBeUndefined();
  });

  it("caches a resolved value (no second KV read before TTL)", async () => {
    let t = 0;
    const { fetchImpl, kvReadCount } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv: { "myapp/db": { password: "v1" } },
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([
        { name: "db_pass", vaultPath: "myapp/db", vaultKey: "password" },
      ]),
      configStore: fakeConfigStore(tokenConfig),
      fetchImpl,
      valueTtlMs: 1000,
      now: () => t,
    });

    expect(await backend.get({ name: "db_pass" })).toBe("v1");
    t = 500; // within TTL
    expect(await backend.get({ name: "db_pass" })).toBe("v1");
    expect(kvReadCount()).toBe(1); // cache hit, no second read
  });

  it("re-reads after the TTL expires (values rotate)", async () => {
    let t = 0;
    const kv = { "myapp/db": { password: "v1" } as Record<string, unknown> };
    const { fetchImpl, kvReadCount } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv,
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([
        { name: "db_pass", vaultPath: "myapp/db", vaultKey: "password" },
      ]),
      configStore: fakeConfigStore(tokenConfig),
      fetchImpl,
      valueTtlMs: 1000,
      now: () => t,
    });

    expect(await backend.get({ name: "db_pass" })).toBe("v1");
    // Rotate the value in Vault and advance past the TTL.
    kv["myapp/db"] = { password: "v2" };
    t = 1000;
    expect(await backend.get({ name: "db_pass" })).toBe("v2");
    expect(kvReadCount()).toBe(2);
  });
});

describe("VaultBackend.list (no-value-leak)", () => {
  it("returns index metadata only, never values", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv: { "myapp/db": { password: "should-never-appear" } },
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([
        { name: "db_pass", vaultPath: "myapp/db", vaultKey: "password" },
      ]),
      configStore: fakeConfigStore(tokenConfig),
      fetchImpl,
    });
    const meta = await backend.list();
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("db_pass");
    expect(meta[0].backend).toBe("vault");
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("should-never-appear");
    expect("value" in meta[0]).toBe(false);
  });
});

describe("VaultBackend.test", () => {
  it("reports ok on valid auth", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([]),
      configStore: fakeConfigStore(tokenConfig),
      fetchImpl,
    });
    expect(await backend.test!()).toEqual({
      ok: true,
      message: "Vault authentication succeeded.",
    });
  });

  it("reports a clear failure on bad auth", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([]),
      configStore: fakeConfigStore({ ...tokenConfig, credential: "WRONG" }),
      fetchImpl,
    });
    const result = await backend.test!();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/lookup failed/);
  });

  it("reports failure when not configured", async () => {
    const { fetchImpl } = createVaultFake({ address: ADDRESS });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([]),
      configStore: fakeConfigStore(undefined),
      fetchImpl,
    });
    const result = await backend.test!();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured/);
  });
});

describe("VaultBackend.configure / getConfigMeta", () => {
  it("persists config, keeps the credential write-only, and reports hasCredential", async () => {
    const store = fakeConfigStore(undefined);
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([]),
      configStore: store,
      fetchImpl: createVaultFake({ address: ADDRESS }).fetchImpl,
    });

    await backend.configure!({
      address: ADDRESS,
      mount: "secret",
      authMethod: "approle",
      role: "role-1",
      credential: "secret-1",
    });

    const meta = await backend.getConfigMeta!();
    expect(meta).toEqual({
      address: ADDRESS,
      mount: "secret",
      authMethod: "approle",
      role: "role-1",
      authMount: undefined,
      namespace: undefined,
      hasCredential: true,
    });
    // The metadata must never carry the credential.
    expect(JSON.stringify(meta)).not.toContain("secret-1");
  });

  it("keeps the existing credential when omitted on update", async () => {
    const store = fakeConfigStore({
      address: ADDRESS,
      mount: "secret",
      authMethod: "token",
      credential: "s.keep-me",
    });
    const backend = createVaultBackend({
      indexStore: fakeIndexStore([]),
      configStore: store,
      fetchImpl: createVaultFake({ address: ADDRESS }).fetchImpl,
    });
    await backend.configure!({
      address: ADDRESS,
      mount: "kv",
      authMethod: "token",
      // no credential -> keep existing
    });
    const stored = await store.load();
    expect(stored?.credential).toBe("s.keep-me");
    expect(stored?.mount).toBe("kv");
  });
});
