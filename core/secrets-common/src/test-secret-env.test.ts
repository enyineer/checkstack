import { describe, it, expect } from "bun:test";
import { buildTestSecretEnv, secretTestPlaceholder } from "./test-secret-env";

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
});
