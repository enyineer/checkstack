import { describe, expect, test } from "bun:test";
import { secret, isSecretSchema, color, isColorSchema } from "./branded-types";
import { z } from "zod";

describe("Branded Types", () => {
  describe("secret()", () => {
    test("secret() creates a branded string schema", () => {
      const secretSchema = secret();
      const result = secretSchema.safeParse("my-secret-value");
      expect(result.success).toBe(true);
    });

    test("isSecretSchema detects secret schemas", () => {
      const secretSchema = secret();
      const regularSchema = z.string();

      expect(isSecretSchema(secretSchema)).toBe(true);
      expect(isSecretSchema(regularSchema)).toBe(false);
    });

    test("multiple secret() calls create distinct tracked schemas", () => {
      const secret1 = secret();
      const secret2 = secret();

      expect(isSecretSchema(secret1)).toBe(true);
      expect(isSecretSchema(secret2)).toBe(true);
      expect(secret1).not.toBe(secret2);
    });

    test("secret schema validates strings", () => {
      const secretSchema = secret();

      expect(secretSchema.safeParse("valid").success).toBe(true);
      expect(secretSchema.safeParse(123).success).toBe(false);
      expect(secretSchema.safeParse(null).success).toBe(false);
    });

    test("isSecretSchema unwraps optional schemas", () => {
      const secretSchema = secret();
      const optionalSecret = secretSchema.optional();
      expect(isSecretSchema(optionalSecret)).toBe(true);
    });
  });

  describe("color()", () => {
    test("color() creates a branded string schema", () => {
      const colorSchema = color();
      const result = colorSchema.safeParse("#ff0000");
      expect(result.success).toBe(true);
    });

    test("isColorSchema detects color schemas", () => {
      const colorSchema = color();
      const regularSchema = z.string();

      expect(isColorSchema(colorSchema)).toBe(true);
      expect(isColorSchema(regularSchema)).toBe(false);
    });

    test("multiple color() calls create distinct tracked schemas", () => {
      const color1 = color();
      const color2 = color();

      expect(isColorSchema(color1)).toBe(true);
      expect(isColorSchema(color2)).toBe(true);
      expect(color1).not.toBe(color2);
    });

    test("color schema validates hex colors", () => {
      const colorSchema = color();

      // Valid 6-digit hex
      expect(colorSchema.safeParse("#ff0000").success).toBe(true);
      expect(colorSchema.safeParse("#3b82f6").success).toBe(true);
      expect(colorSchema.safeParse("#FFFFFF").success).toBe(true);

      // Valid 3-digit hex
      expect(colorSchema.safeParse("#f00").success).toBe(true);
      expect(colorSchema.safeParse("#FFF").success).toBe(true);

      // Invalid formats
      expect(colorSchema.safeParse("ff0000").success).toBe(false); // Missing #
      expect(colorSchema.safeParse("#ff00").success).toBe(false); // 4 digits
      expect(colorSchema.safeParse("#ff00000").success).toBe(false); // 7 digits
      expect(colorSchema.safeParse("red").success).toBe(false); // Named color
      expect(colorSchema.safeParse(123).success).toBe(false);
      expect(colorSchema.safeParse(null).success).toBe(false);
    });

    test("isColorSchema unwraps optional schemas", () => {
      const colorSchema = color();
      const optionalColor = colorSchema.optional();
      expect(isColorSchema(optionalColor)).toBe(true);
    });

    test("color() with default value creates schema with default", () => {
      const colorSchema = color({ defaultValue: "#3b82f6" });
      const result = colorSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(String(result.data)).toBe("#3b82f6");
      }
    });

    test("isColorSchema unwraps default schemas", () => {
      const colorSchema = color({ defaultValue: "#3b82f6" });
      expect(isColorSchema(colorSchema)).toBe(true);
    });

    test("color() with default still validates explicit values", () => {
      const colorSchema = color({ defaultValue: "#3b82f6" });
      const result = colorSchema.safeParse("#ff0000");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(String(result.data)).toBe("#ff0000");
      }
    });
  });

  describe("branded types are distinct", () => {
    test("secret and color schemas are not confused", () => {
      const secretSchema = secret();
      const colorSchema = color();

      expect(isSecretSchema(secretSchema)).toBe(true);
      expect(isColorSchema(secretSchema)).toBe(false);

      expect(isColorSchema(colorSchema)).toBe(true);
      expect(isSecretSchema(colorSchema)).toBe(false);
    });
  });
});
