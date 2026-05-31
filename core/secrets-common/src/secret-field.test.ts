import { describe, it, expect } from "bun:test";
import {
  secretNameSchema,
  secretTemplateSchema,
  collectSecretNames,
} from "./secret-field";
import { secretEnvMappingSchema } from "./env-mapping";

describe("secretNameSchema", () => {
  it("accepts valid names", () => {
    for (const name of ["jira_token", "API-KEY", "a", "Db1"]) {
      expect(secretNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("rejects names not starting with a letter or with bad chars", () => {
    for (const name of ["1token", "_x", "has space", "dot.name", ""]) {
      expect(secretNameSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe("secretTemplateSchema", () => {
  it("accepts a ${{ secrets.NAME }} reference", () => {
    expect(secretTemplateSchema.safeParse("${{ secrets.DB_PASS }}").success).toBe(
      true,
    );
    expect(
      secretTemplateSchema.safeParse("prefix-${{ secrets.X }}-suffix").success,
    ).toBe(true);
  });

  it("rejects strings without a reference", () => {
    expect(secretTemplateSchema.safeParse("plain").success).toBe(false);
  });
});

describe("collectSecretNames", () => {
  it("collects unique names from a nested value tree", () => {
    const names = collectSecretNames({
      value: {
        a: "${{ secrets.ONE }}",
        b: ["x", "${{ secrets.TWO }}"],
        c: { d: "u:${{ secrets.ONE }}@${{ secrets.THREE }}" },
      },
    });
    expect([...names].sort()).toEqual(["ONE", "THREE", "TWO"]);
  });
});

describe("secretEnvMappingSchema", () => {
  it("accepts env→template maps", () => {
    const res = secretEnvMappingSchema.safeParse({
      API_TOKEN: "${{ secrets.jira_token }}",
      _PRIVATE: "${{ secrets.x }}",
    });
    expect(res.success).toBe(true);
  });

  it("rejects bad env names", () => {
    expect(
      secretEnvMappingSchema.safeParse({ "bad name": "${{ secrets.x }}" })
        .success,
    ).toBe(false);
  });

  it("tolerates a bare secret name (accepted unchanged; normalized at use)", () => {
    // A bare name (e.g. authored via YAML shorthand or legacy data) is now
    // accepted. The schema is a plain union with NO transform (so it stays
    // representable in JSON Schema for the plugin config UI); the bare name is
    // normalized to `${{ secrets.NAME }}` later, at the consumption boundary
    // (`normalizeSecretEnvValue`), not on parse.
    const res = secretEnvMappingSchema.safeParse({ TOKEN: "not-a-template" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ TOKEN: "not-a-template" });
    }
  });

  it("rejects a value that is neither a template nor a valid secret name", () => {
    // Spaces / leading digit are not a valid bare name and not a template.
    expect(
      secretEnvMappingSchema.safeParse({ TOKEN: "not a template" }).success,
    ).toBe(false);
    expect(
      secretEnvMappingSchema.safeParse({ TOKEN: "1bad" }).success,
    ).toBe(false);
  });
});
