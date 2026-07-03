import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  configString,
  configSecret,
  getConfigMeta,
  getSecretId,
  isTemplatableSchema,
  validateSecretIds,
} from "./zod-config";

describe("getConfigMeta / unwrapSchema — multi-level wrapper unwrapping", () => {
  test("finds meta on a plain configString", () => {
    const field = configString({ "x-templatable": true });
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
  });

  test("finds meta through a single .optional() wrapper", () => {
    const field = configString({ "x-templatable": true }).optional();
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
  });

  test("finds meta through a single .default() wrapper", () => {
    const field = configString({ "x-templatable": true }).default("");
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
  });

  test("finds meta through a single .nullable() wrapper", () => {
    const field = configString({ "x-templatable": true }).nullable();
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
  });

  // Regression: the old single-pass unwrap stopped after one level and returned
  // `undefined` for a field wrapped in `.optional().default()` (two layers).
  test("finds meta through .optional().default() — two wrapper levels", () => {
    const field = configString({ "x-templatable": true }).optional().default("");
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
    expect(isTemplatableSchema(field)).toBe(true);
  });

  test("finds meta through .default().optional() — reversed two wrapper levels", () => {
    const field = configString({ "x-templatable": true }).default("").optional();
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
  });

  test("finds meta through .nullable().optional() — two wrapper levels", () => {
    const field = configString({ "x-secret": true }).nullable().optional();
    expect(getConfigMeta(field)?.["x-secret"]).toBe(true);
  });

  test("finds meta through three wrapper levels (.optional().nullable().default())", () => {
    const field = configString({ "x-templatable": true })
      .optional()
      .nullable()
      .default(null);
    expect(getConfigMeta(field)?.["x-templatable"]).toBe(true);
  });

  test("returns undefined for a plain z.string() with no registered meta", () => {
    const field = z.string().optional();
    expect(getConfigMeta(field)).toBeUndefined();
  });
});

describe("configSecret / getSecretId", () => {
  test("configSecret marks x-secret and carries a stable x-secret-id", () => {
    const field = configSecret({ id: "apiToken" });
    expect(getConfigMeta(field)?.["x-secret"]).toBe(true);
    expect(getSecretId(field)).toBe("apiToken");
  });

  test("a plain x-secret configString has no secret id", () => {
    const field = configString({ "x-secret": true });
    expect(getSecretId(field)).toBeUndefined();
  });
});

describe("validateSecretIds", () => {
  test("passes for a flat schema of configSecret fields", () => {
    const schema = z.object({
      host: z.string(),
      password: configSecret({ id: "password" }).optional(),
      token: configSecret({ id: "token" }),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).not.toThrow();
  });

  test("throws when an x-secret field has no x-secret-id", () => {
    const schema = z.object({
      password: configString({ "x-secret": true }),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /no x-secret-id/,
    );
  });

  test("throws on a duplicate x-secret-id within one object", () => {
    const schema = z.object({
      a: configSecret({ id: "dup" }),
      b: configSecret({ id: "dup" }),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /duplicate x-secret-id "dup"/,
    );
  });

  test("rejects an x-secret field nested inside an array (mis-keys at run time)", () => {
    const schema = z.object({
      targets: z.array(
        z.object({ token: configSecret({ id: "token" }) }),
      ),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /nested inside an array/,
    );
  });

  test("rejects an x-secret field nested inside a z.record (never extracted)", () => {
    const schema = z.object({
      creds: z.record(z.string(), configSecret({ id: "token" })),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /nested inside a record/,
    );
  });

  test("rejects an x-secret field nested inside a z.tuple", () => {
    const schema = z.object({
      pair: z.tuple([z.string(), configSecret({ id: "token" })]),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /nested inside a tuple/,
    );
  });

  test("rejects an x-secret field composed via z.intersection / .and() (never extracted)", () => {
    const schema = z
      .object({ host: z.string() })
      .and(z.object({ password: configSecret({ id: "password" }) }));
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /nested inside an intersection/,
    );
  });

  test("allows a NON-secret z.record alongside a top-level secret", () => {
    const schema = z.object({
      labels: z.record(z.string(), z.string()),
      apiToken: configSecret({ id: "apiToken" }),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).not.toThrow();
  });

  test("descends into arrays of objects to flag a missing id first", () => {
    // A missing-id error can surface before the array check depending on order;
    // either way an array-nested x-secret must NOT pass boot.
    const schema = z.object({
      targets: z.array(
        z.object({ token: configString({ "x-secret": true }) }),
      ),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow();
  });

  test("allows the SAME id across mutually-exclusive union branches", () => {
    // Only one branch is ever populated at run time, so reusing "secret" is
    // safe and must NOT be flagged as a duplicate.
    const schema = z.discriminatedUnion("type", [
      z.object({ type: z.literal("basic"), secret: configSecret({ id: "secret" }) }),
      z.object({ type: z.literal("token"), secret: configSecret({ id: "secret" }) }),
    ]);
    expect(() => validateSecretIds({ schema, label: "s" })).not.toThrow();
  });

  test("still flags an id colliding with an ancestor across a union", () => {
    const schema = z.object({
      shared: configSecret({ id: "x" }),
      variant: z.union([
        z.object({ inner: configSecret({ id: "x" }) }),
        z.object({ other: configSecret({ id: "y" }) }),
      ]),
    });
    expect(() => validateSecretIds({ schema, label: "s" })).toThrow(
      /duplicate x-secret-id "x"/,
    );
  });
});
