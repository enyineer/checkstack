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

  it("rejects bad env names or non-template values", () => {
    expect(
      secretEnvMappingSchema.safeParse({ "bad name": "${{ secrets.x }}" })
        .success,
    ).toBe(false);
    expect(
      secretEnvMappingSchema.safeParse({ TOKEN: "not-a-template" }).success,
    ).toBe(false);
  });
});
