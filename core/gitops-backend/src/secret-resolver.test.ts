import { describe, it, expect } from "bun:test";
import { resolveSecrets } from "./secret-resolver";

const mockSecretStore = {
  resolve: async (name: string): Promise<string> => {
    const secrets: Record<string, string> = {
      "prod-db-password": "s3cret!",
      "api-key": "key-12345",
    };
    const value = secrets[name];
    if (!value) throw new Error(`Secret not found: ${name}`);
    return value;
  },
};

describe("resolveSecrets", () => {
  it("resolves a top-level secretRef", async () => {
    const spec = { password: { secretRef: "prod-db-password" } };
    const resolved = await resolveSecrets({
      spec,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({ password: "s3cret!" });
  });

  it("leaves plain strings untouched", async () => {
    const spec = { host: "localhost", port: 5432 };
    const resolved = await resolveSecrets({
      spec,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({ host: "localhost", port: 5432 });
  });

  it("resolves nested secretRefs", async () => {
    const spec = {
      connection: {
        host: "db.internal",
        password: { secretRef: "prod-db-password" },
      },
    };
    const resolved = await resolveSecrets({
      spec,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({
      connection: { host: "db.internal", password: "s3cret!" },
    });
  });

  it("resolves secretRefs in arrays", async () => {
    const spec = {
      credentials: [
        { name: "db", secret: { secretRef: "prod-db-password" } },
        { name: "api", secret: { secretRef: "api-key" } },
      ],
    };
    const resolved = await resolveSecrets({
      spec,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({
      credentials: [
        { name: "db", secret: "s3cret!" },
        { name: "api", secret: "key-12345" },
      ],
    });
  });

  it("throws when a referenced secret is not found", async () => {
    const spec = { password: { secretRef: "nonexistent" } };
    await expect(
      resolveSecrets({ spec, secretStore: mockSecretStore }),
    ).rejects.toThrow("Secret not found: nonexistent");
  });

  it("handles null and undefined values gracefully", async () => {
    const spec = { a: null, b: undefined, c: "value" };
    const resolved = await resolveSecrets({
      spec,
      secretStore: mockSecretStore,
    });
    expect(resolved.a).toBeNull();
    expect(resolved.c).toBe("value");
  });
});
