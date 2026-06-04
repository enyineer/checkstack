import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  configString,
  getConfigMeta,
  isTemplatableSchema,
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
