import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  secretEnvValueSchema,
  secretEnvMappingSchema,
  normalizeSecretEnvValue,
  toSecretTemplate,
} from "./env-mapping";

// The value schema is a plain union (NO transform — it must stay
// JSON-Schema-representable for the plugin config UI). It ACCEPTS both a
// canonical template and a bare secret name, returning the value unchanged;
// normalization to the canonical template is done separately by
// `normalizeSecretEnvValue` at the consumption boundary.
describe("secretEnvValueSchema", () => {
  it("accepts a canonical template unchanged", () => {
    expect(secretEnvValueSchema.parse("${{ secrets.jira_token }}")).toBe(
      "${{ secrets.jira_token }}",
    );
    expect(secretEnvValueSchema.parse("${{secrets.x}}")).toBe("${{secrets.x}}");
  });

  it("accepts a bare secret name unchanged (no transform on parse)", () => {
    expect(secretEnvValueSchema.parse("SECRET")).toBe("SECRET");
    expect(secretEnvValueSchema.parse("jira_token")).toBe("jira_token");
    // Hyphens are allowed in secret names.
    expect(secretEnvValueSchema.parse("my-secret")).toBe("my-secret");
  });

  it("is representable in JSON Schema (no transform — guards plugin load)", () => {
    // The plugin manager renders config schemas to JSON Schema at load time;
    // a zod `.transform()` here throws "Transforms cannot be represented in
    // JSON Schema" and crashes plugin load. Assert generation succeeds.
    expect(() => z.toJSONSchema(secretEnvValueSchema)).not.toThrow();
    expect(() => z.toJSONSchema(secretEnvMappingSchema)).not.toThrow();
  });

  it("rejects an invalid secret name", () => {
    expect(() => secretEnvValueSchema.parse("1secret")).toThrow();
    expect(() => secretEnvValueSchema.parse("not a name")).toThrow();
    expect(() => secretEnvValueSchema.parse("")).toThrow();
  });

  it("accepts existing partial-template (inline) interpolation", () => {
    expect(secretEnvValueSchema.parse("u:${{ secrets.pw }}@host")).toBe(
      "u:${{ secrets.pw }}@host",
    );
  });

  it("rejects a value with no secret reference and no valid bare name", () => {
    expect(() => secretEnvValueSchema.parse("${{ env.FOO }}")).toThrow();
  });
});

describe("normalizeSecretEnvValue", () => {
  it("wraps a bare secret name in the canonical template", () => {
    expect(normalizeSecretEnvValue("SECRET")).toBe("${{ secrets.SECRET }}");
    expect(normalizeSecretEnvValue("my-secret")).toBe(
      "${{ secrets.my-secret }}",
    );
  });

  it("leaves a template (or any value containing one) unchanged", () => {
    expect(normalizeSecretEnvValue("${{ secrets.jira_token }}")).toBe(
      "${{ secrets.jira_token }}",
    );
    expect(normalizeSecretEnvValue("u:${{ secrets.pw }}@host")).toBe(
      "u:${{ secrets.pw }}@host",
    );
  });
});

describe("secretEnvMappingSchema", () => {
  it("accepts a bare-name value (unchanged on parse)", () => {
    expect(secretEnvMappingSchema.parse({ secret: "SECRET" })).toEqual({
      secret: "SECRET",
    });
  });

  it("accepts a mix of template and bare-name values unchanged", () => {
    expect(
      secretEnvMappingSchema.parse({
        API_TOKEN: "${{ secrets.jira_token }}",
        DB: "db_pass",
      }),
    ).toEqual({
      API_TOKEN: "${{ secrets.jira_token }}",
      DB: "db_pass",
    });
  });

  it("rejects an invalid env-var key", () => {
    expect(() =>
      secretEnvMappingSchema.parse({ "1BAD": "SECRET" }),
    ).toThrow();
  });
});

describe("toSecretTemplate", () => {
  it("wraps a name in the canonical template", () => {
    expect(toSecretTemplate("api")).toBe("${{ secrets.api }}");
  });
});
