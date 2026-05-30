import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import { resolveSecretsBySchema, type SecretStore } from "./secret-resolver";

const mockSecretStore: SecretStore = {
  resolve: async (name: string): Promise<string> => {
    const secrets: Record<string, string> = {
      DB_PASS: "s3cret!",
      API_KEY: "key-12345",
      DB_USER: "admin",
      DB_HOST: "db.production.internal",
    };
    const value = secrets[name];
    if (!value) throw new Error(`Secret not found: ${name}`);
    return value;
  },
};

describe("resolveSecretsBySchema (promoted from gitops)", () => {
  it("resolves a field marked with x-secret", async () => {
    const schema = z.object({
      host: z.string(),
      password: configString({ "x-secret": true }),
    });
    const { resolved, warnings } = await resolveSecretsBySchema({
      value: { host: "localhost", password: "${{ secrets.DB_PASS }}" },
      schema,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({ host: "localhost", password: "s3cret!" });
    expect(warnings).toEqual([]);
  });

  it("leaves non-secret fields untouched and emits warnings", async () => {
    const schema = z.object({
      description: z.string(),
      password: configString({ "x-secret": true }),
    });
    const { resolved, warnings } = await resolveSecretsBySchema({
      value: {
        description: "Contains ${{ secrets.DB_PASS }} but should NOT resolve",
        password: "${{ secrets.DB_PASS }}",
      },
      schema,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({
      description: "Contains ${{ secrets.DB_PASS }} but should NOT resolve",
      password: "s3cret!",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("description");
  });

  it("resolves inline interpolation in secret fields", async () => {
    const schema = z.object({
      connectionString: configString({ "x-secret": true }),
    });
    const { resolved } = await resolveSecretsBySchema({
      value: {
        connectionString:
          "postgres://${{ secrets.DB_USER }}:${{ secrets.DB_PASS }}@${{ secrets.DB_HOST }}/mydb",
      },
      schema,
      secretStore: mockSecretStore,
    });
    expect(resolved).toEqual({
      connectionString: "postgres://admin:s3cret!@db.production.internal/mydb",
    });
  });

  it("resolves secrets in nested objects and arrays", async () => {
    const schema = z.object({
      credentials: z.array(
        z.object({
          name: z.string(),
          secret: configString({ "x-secret": true }),
        }),
      ),
    });
    const { resolved } = await resolveSecretsBySchema({
      value: {
        credentials: [
          { name: "db", secret: "${{ secrets.DB_PASS }}" },
          { name: "api", secret: "${{ secrets.API_KEY }}" },
        ],
      },
      schema,
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
    const schema = z.object({
      password: configString({ "x-secret": true }),
    });
    await expect(
      resolveSecretsBySchema({
        value: { password: "${{ secrets.NONEXISTENT }}" },
        schema,
        secretStore: mockSecretStore,
      }),
    ).rejects.toThrow("Secret not found: NONEXISTENT");
  });
});
