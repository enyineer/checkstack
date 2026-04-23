import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import { resolveSecretsBySchema } from "./secret-resolver";

const mockSecretStore = {
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

describe("resolveSecretsBySchema", () => {
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
        description: "Contains ${{ secrets.DB_PASS }} but should NOT be resolved",
        password: "${{ secrets.DB_PASS }}",
      },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({
      description: "Contains ${{ secrets.DB_PASS }} but should NOT be resolved",
      password: "s3cret!",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("description");
    expect(warnings[0]).toContain("not marked as a secret field");
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
      connectionString:
        "postgres://admin:s3cret!@db.production.internal/mydb",
    });
  });

  it("resolves secrets in nested objects", async () => {
    const schema = z.object({
      connection: z.object({
        host: z.string(),
        password: configString({ "x-secret": true }),
      }),
    });

    const { resolved, warnings } = await resolveSecretsBySchema({
      value: {
        connection: { host: "db.internal", password: "${{ secrets.DB_PASS }}" },
      },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({
      connection: { host: "db.internal", password: "s3cret!" },
    });
    expect(warnings).toEqual([]);
  });

  it("resolves secrets in arrays of objects", async () => {
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

  it("handles optional secret fields", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }).optional(),
    });

    const { resolved } = await resolveSecretsBySchema({
      value: { password: "${{ secrets.DB_PASS }}" },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({ password: "s3cret!" });
  });

  it("handles default-wrapped secret fields", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }).default("fallback"),
    });

    const { resolved } = await resolveSecretsBySchema({
      value: { password: "${{ secrets.DB_PASS }}" },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({ password: "s3cret!" });
  });

  it("returns non-secret objects unchanged", async () => {
    const schema = z.object({
      host: z.string(),
      port: z.number(),
    });

    const { resolved, warnings } = await resolveSecretsBySchema({
      value: { host: "localhost", port: 5432 },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({ host: "localhost", port: 5432 });
    expect(warnings).toEqual([]);
  });

  it("handles null and undefined values gracefully", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }).optional(),
    });

    const { resolved } = await resolveSecretsBySchema({
      value: { password: undefined },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({ password: undefined });
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

  it("resolves templates with extra whitespace", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }),
    });

    const { resolved } = await resolveSecretsBySchema({
      value: { password: "${{  secrets.DB_PASS  }}" },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({ password: "s3cret!" });
  });

  it("preserves fields not in the schema (extra keys in value)", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }),
    });

    const { resolved } = await resolveSecretsBySchema({
      value: {
        password: "${{ secrets.DB_PASS }}",
        extraField: "should remain",
      },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({
      password: "s3cret!",
      extraField: "should remain",
    });
  });

  it("does not resolve secret templates in secret fields when no template is present", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }),
    });

    const { resolved } = await resolveSecretsBySchema({
      value: { password: "plain-password" },
      schema,
      secretStore: mockSecretStore,
    });

    expect(resolved).toEqual({ password: "plain-password" });
  });

  // ─── Warning tests ──────────────────────────────────────────────────────

  it("warns for template in nested non-secret field with correct path", async () => {
    const schema = z.object({
      connection: z.object({
        host: z.string(),
        password: configString({ "x-secret": true }),
      }),
    });

    const { resolved, warnings } = await resolveSecretsBySchema({
      value: {
        connection: {
          host: "${{ secrets.DB_HOST }}",
          password: "${{ secrets.DB_PASS }}",
        },
      },
      schema,
      secretStore: mockSecretStore,
    });

    // Password resolved, host left as-is
    expect(resolved).toEqual({
      connection: {
        host: "${{ secrets.DB_HOST }}",
        password: "s3cret!",
      },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("connection.host");
  });

  it("warns for template in array element non-secret field with index", async () => {
    const schema = z.object({
      items: z.array(
        z.object({
          label: z.string(),
          secret: configString({ "x-secret": true }),
        }),
      ),
    });

    const { warnings } = await resolveSecretsBySchema({
      value: {
        items: [
          { label: "${{ secrets.DB_PASS }}", secret: "${{ secrets.DB_PASS }}" },
        ],
      },
      schema,
      secretStore: mockSecretStore,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("items[0].label");
  });

  it("emits no warnings when all templates are in secret fields", async () => {
    const schema = z.object({
      password: configString({ "x-secret": true }),
      apiKey: configString({ "x-secret": true }),
    });

    const { warnings } = await resolveSecretsBySchema({
      value: {
        password: "${{ secrets.DB_PASS }}",
        apiKey: "${{ secrets.API_KEY }}",
      },
      schema,
      secretStore: mockSecretStore,
    });

    expect(warnings).toEqual([]);
  });
});
