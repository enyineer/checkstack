import { describe, it, expect } from "bun:test";
import { createVaultClient } from "./vault-client";
import { createVaultFake } from "./vault-fake";

const ADDRESS = "https://vault.example.com";

describe("VaultClient auth flows", () => {
  it("token auth: validates via self-lookup and uses the token directly", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "token",
        credential: "s.real-token",
      },
      fetchImpl,
    });
    const session = await client.login();
    expect(session.clientToken).toBe("s.real-token");
    expect(session.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("token auth: a bad token fails clearly", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "token",
        credential: "s.wrong",
      },
      fetchImpl,
    });
    await expect(client.login()).rejects.toThrow(/lookup failed/);
  });

  it("AppRole auth: role_id + secret_id mint a client token", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      approle: { roleId: "role-1", secretId: "secret-1" },
      mintedToken: "s.approle-token",
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "approle",
        role: "role-1",
        credential: "secret-1",
      },
      fetchImpl,
    });
    const session = await client.login();
    expect(session.clientToken).toBe("s.approle-token");
  });

  it("AppRole auth: wrong secret_id fails clearly", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      approle: { roleId: "role-1", secretId: "secret-1" },
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "approle",
        role: "role-1",
        credential: "WRONG",
      },
      fetchImpl,
    });
    await expect(client.login()).rejects.toThrow(/status 400/);
  });

  it("OIDC/JWT auth: role + jwt mint a client token", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      oidc: { role: "reader", jwt: "header.payload.sig" },
      mintedToken: "s.oidc-token",
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "oidc",
        role: "reader",
        credential: "header.payload.sig",
      },
      fetchImpl,
    });
    const session = await client.login();
    expect(session.clientToken).toBe("s.oidc-token");
  });
});

describe("VaultClient KV v2 read", () => {
  it("reads a secret data object at <mount>/data/<path>", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv: { "myapp/db": { password: "p@ss", user: "admin" } },
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "token",
        credential: "s.real-token",
      },
      fetchImpl,
    });
    const { clientToken } = await client.login();
    const data = await client.readKvV2({ clientToken, path: "myapp/db" });
    expect(data).toEqual({ password: "p@ss", user: "admin" });
  });

  it("throws a clear not-found for a missing path", async () => {
    const { fetchImpl } = createVaultFake({
      address: ADDRESS,
      validToken: "s.real-token",
      kv: {},
    });
    const client = createVaultClient({
      config: {
        address: ADDRESS,
        mount: "secret",
        authMethod: "token",
        credential: "s.real-token",
      },
      fetchImpl,
    });
    const { clientToken } = await client.login();
    await expect(
      client.readKvV2({ clientToken, path: "nope" }),
    ).rejects.toThrow(/not found/);
  });
});
