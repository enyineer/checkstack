import { describe, it, expect } from "bun:test";
import { buildTestSecretEnv, secretTestPlaceholder } from "./test-secret-env";
import { secretEnvMappingSchema } from "./env-mapping";

describe("secretTestPlaceholder", () => {
  it("formats a stable named placeholder", () => {
    expect(secretTestPlaceholder("jira_token")).toBe("__SECRET_jira_token__");
  });
});

describe("buildTestSecretEnv", () => {
  it("uses placeholders by default and never resolves a real value", () => {
    const { env, maskValues } = buildTestSecretEnv({
      secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
    });
    expect(env).toEqual({ API_TOKEN: "__SECRET_jira_token__" });
    expect(maskValues).toEqual([]);
  });

  it("injects a user override and marks it for masking", () => {
    const { env, maskValues } = buildTestSecretEnv({
      secretEnv: { A: "${{ secrets.alpha }}", B: "${{ secrets.beta }}" },
      secretOverrides: { beta: "real-override" },
    });
    expect(env).toEqual({ A: "__SECRET_alpha__", B: "real-override" });
    expect(maskValues).toEqual(["real-override"]);
  });

  it("returns empty when no secretEnv is declared (least-privilege)", () => {
    expect(buildTestSecretEnv({})).toEqual({ env: {}, maskValues: [] });
    expect(buildTestSecretEnv({ secretOverrides: { x: "y" } })).toEqual({
      env: {},
      maskValues: [],
    });
  });

  it("handles inline interpolation by using the first referenced secret", () => {
    const { env } = buildTestSecretEnv({
      secretEnv: { CONN: "user:${{ secrets.pw }}@host" },
    });
    expect(env.CONN).toBe("__SECRET_pw__");
  });

  it("injects placeholders for a bare-name mapping once normalized", () => {
    // A `secretEnv` authored with a bare name (e.g. via YAML) is normalized
    // to a template by the schema, then yields a `__SECRET_<NAME>__`
    // placeholder in an override-less test (so `process.env.<env>` is set).
    const normalized = secretEnvMappingSchema.parse({ secret: "SECRET" });
    const noOverride = buildTestSecretEnv({ secretEnv: normalized });
    expect(noOverride.env).toEqual({ secret: "__SECRET_SECRET__" });
    expect(noOverride.maskValues).toEqual([]);

    // With an explicit override, the override is injected and masked.
    const withOverride = buildTestSecretEnv({
      secretEnv: normalized,
      secretOverrides: { SECRET: "test-value" },
    });
    expect(withOverride.env).toEqual({ secret: "test-value" });
    expect(withOverride.maskValues).toEqual(["test-value"]);
  });
});
