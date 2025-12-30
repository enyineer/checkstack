import { describe, test, expect } from "bun:test";
import { validateStrategySchema } from "./validate-schema";
import { z } from "zod";

describe("validateStrategySchema", () => {
  test("should pass for schema with all defaults", () => {
    const validSchema = z.object({
      enabled: z.boolean().default(false),
      url: z.string().default("https://example.com"),
      timeout: z.number().default(5000),
    });

    expect(() =>
      validateStrategySchema(validSchema, "test-strategy")
    ).not.toThrow();
  });

  test("should pass for schema with all optional fields", () => {
    const validSchema = z.object({
      enabled: z.boolean().default(false),
      url: z.string().optional(),
      timeout: z.number().optional(),
    });

    expect(() =>
      validateStrategySchema(validSchema, "test-strategy")
    ).not.toThrow();
  });

  test("should throw for schema with required fields without defaults", () => {
    const invalidSchema = z.object({
      enabled: z.boolean().default(false),
      url: z.string(), // Required, no default
      baseDN: z.string(), // Required, no default
    });

    expect(() =>
      validateStrategySchema(invalidSchema, "test-strategy")
    ).toThrow(
      /Strategy "test-strategy" has invalid configuration schema.*url, baseDN/
    );
  });

  test("should throw for nested objects with required fields", () => {
    const invalidSchema = z.object({
      enabled: z.boolean().default(false),
      settings: z.object({
        host: z.string(), // Required, no default
        port: z.number().default(443),
      }),
    });

    expect(() =>
      validateStrategySchema(invalidSchema, "test-strategy")
    ).toThrow(/settings/);
  });

  test("should include helpful error message", () => {
    const invalidSchema = z.object({
      url: z.string(),
    });

    try {
      validateStrategySchema(invalidSchema, "my-strategy");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("my-strategy");
      expect(message).toContain("url");
      expect(message).toContain("missing defaults");
      expect(message).toContain("optional or have default values");
    }
  });

  test("should pass for schema with only enabled field", () => {
    const validSchema = z.object({
      enabled: z.boolean().default(false),
    });

    expect(() =>
      validateStrategySchema(validSchema, "test-strategy")
    ).not.toThrow();
  });
});
