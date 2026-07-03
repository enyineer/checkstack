import { describe, expect, it } from "bun:test";
import { healthcheckSecretMarker } from "@checkstack/healthcheck-common";
import {
  hasUnresolvedConfigSecrets,
  assertConfigSecretsResolved,
  applyConfigSecretValues,
} from "./config-secrets";

describe("hasUnresolvedConfigSecrets (schema-free)", () => {
  it("detects markers and references, ignores legacy literals", () => {
    expect(
      hasUnresolvedConfigSecrets({
        config: { host: "h", password: healthcheckSecretMarker("password") },
      }),
    ).toBe(true);
    expect(
      hasUnresolvedConfigSecrets({
        config: { host: "h", password: "${{ secrets.PW }}" },
      }),
    ).toBe(true);
    expect(
      hasUnresolvedConfigSecrets({
        config: { host: "h", password: "legacy-literal" },
      }),
    ).toBe(false);
    expect(hasUnresolvedConfigSecrets({ config: { host: "h" } })).toBe(false);
  });

  it("detects unresolved secrets inside arrays of objects", () => {
    expect(
      hasUnresolvedConfigSecrets({
        config: {
          host: "h",
          targets: [{ name: "a", token: healthcheckSecretMarker("token") }],
        },
      }),
    ).toBe(true);
  });

  it("IGNORES ${{ secrets.* }} references inside a secretEnv mapping (separate run-secrets channel)", () => {
    // secretEnv references are resolved via the run-secrets channel and stay in
    // the config verbatim; they must not be seen as unresolved config secrets,
    // or the fail-closed assert throws on every satellite collector with a
    // secretEnv. Regression for the review's confirmed HIGH finding.
    expect(
      hasUnresolvedConfigSecrets({
        config: {
          script: "echo hi",
          secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
        },
      }),
    ).toBe(false);
  });

  it("still detects a real config secret alongside a secretEnv mapping", () => {
    expect(
      hasUnresolvedConfigSecrets({
        config: {
          password: healthcheckSecretMarker("password"),
          secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
        },
      }),
    ).toBe(true);
  });

  it("detects a secret nested inside a union branch (schema-free, no walk gap)", () => {
    // The schema-walk detector missed union-nested secrets; the raw scan cannot.
    expect(
      hasUnresolvedConfigSecrets({
        config: {
          auth: { type: "basic", password: healthcheckSecretMarker("password") },
        },
      }),
    ).toBe(true);
  });
});

describe("assertConfigSecretsResolved (fail-closed)", () => {
  it("throws when an unresolved marker remains after resolution", () => {
    expect(() =>
      assertConfigSecretsResolved({
        config: { password: healthcheckSecretMarker("password") },
        label: "test",
      }),
    ).toThrow(/could not be resolved/);
  });

  it("passes for a fully resolved config (and legacy literals)", () => {
    expect(() =>
      assertConfigSecretsResolved({
        config: { host: "h", password: "resolved", legacy: "literal" },
        label: "test",
      }),
    ).not.toThrow();
  });

  it("does NOT throw on a resolved config that keeps a secretEnv mapping", () => {
    expect(() =>
      assertConfigSecretsResolved({
        config: {
          script: "echo hi",
          secretEnv: { API_TOKEN: "${{ secrets.jira_token }}" },
        },
        label: "test",
      }),
    ).not.toThrow();
  });
});

describe("applyConfigSecretValues", () => {
  it("applies flat and array paths without touching the original", () => {
    const config = {
      host: "h",
      password: healthcheckSecretMarker("password"),
      targets: [
        { name: "a", token: healthcheckSecretMarker("targets[0].token") },
      ],
    };
    const applied = applyConfigSecretValues({
      config,
      values: { password: "pw-value", "targets[0].token": "tok-value" },
    });

    expect(applied.password).toBe("pw-value");
    expect(
      (applied.targets as Array<{ token: string }>)[0].token,
    ).toBe("tok-value");
    // The persisted assignment object must stay untouched.
    expect(config.password).toBe(healthcheckSecretMarker("password"));
    expect(config.targets[0].token).toBe(
      healthcheckSecretMarker("targets[0].token"),
    );
  });

  it("skips stale paths instead of fabricating structure", () => {
    const applied = applyConfigSecretValues({
      config: { host: "h" },
      values: { "nested.password": "x", "targets[3].token": "y" },
    });
    expect(applied).toEqual({ host: "h" });
  });
});
