import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { configString } from "@checkstack/backend-api";
import { healthcheckSecretMarker } from "@checkstack/healthcheck-common";
import {
  hasUnresolvedConfigSecrets,
  applyConfigSecretValues,
} from "./config-secrets";

const schema = z.object({
  host: z.string(),
  password: configString({ "x-secret": true }).optional(),
  targets: z
    .array(
      z.object({
        name: z.string(),
        token: configString({ "x-secret": true }),
      }),
    )
    .optional(),
});

describe("hasUnresolvedConfigSecrets", () => {
  it("detects markers and references, ignores legacy literals", () => {
    expect(
      hasUnresolvedConfigSecrets({
        schema,
        config: { host: "h", password: healthcheckSecretMarker("password") },
      }),
    ).toBe(true);
    expect(
      hasUnresolvedConfigSecrets({
        schema,
        config: { host: "h", password: "${{ secrets.PW }}" },
      }),
    ).toBe(true);
    expect(
      hasUnresolvedConfigSecrets({
        schema,
        config: { host: "h", password: "legacy-literal" },
      }),
    ).toBe(false);
    expect(
      hasUnresolvedConfigSecrets({ schema, config: { host: "h" } }),
    ).toBe(false);
  });

  it("detects unresolved secrets inside arrays of objects", () => {
    expect(
      hasUnresolvedConfigSecrets({
        schema,
        config: {
          host: "h",
          targets: [{ name: "a", token: healthcheckSecretMarker("targets[0].token") }],
        },
      }),
    ).toBe(true);
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
