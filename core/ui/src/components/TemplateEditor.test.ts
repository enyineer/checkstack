import { describe, expect, it } from "bun:test";
import { detectTemplateContext } from "./TemplateEditor";

describe("detectTemplateContext", () => {
  describe("mustache syntax ({{}})", () => {
    it("should detect context when cursor is immediately after {{", () => {
      const result = detectTemplateContext("Hello {{", 8, "mustache");
      expect(result).toEqual({
        isInTemplate: true,
        query: "",
        startPos: 6,
      });
    });

    it("should detect context with partial query", () => {
      const result = detectTemplateContext("Hello {{pay", 11, "mustache");
      expect(result).toEqual({
        isInTemplate: true,
        query: "pay",
        startPos: 6,
      });
    });

    it("should detect context with full path being typed", () => {
      const result = detectTemplateContext(
        "Hello {{payload.title",
        21,
        "mustache"
      );
      expect(result).toEqual({
        isInTemplate: true,
        query: "payload.title",
        startPos: 6,
      });
    });

    it("should not detect context when template is closed", () => {
      const result = detectTemplateContext(
        "Hello {{name}} world",
        20,
        "mustache"
      );
      expect(result).toEqual({
        isInTemplate: false,
        query: "",
        startPos: -1,
      });
    });

    it("should not detect context when cursor is before {{", () => {
      const result = detectTemplateContext("Hello {{name}}", 3, "mustache");
      expect(result).toEqual({
        isInTemplate: false,
        query: "",
        startPos: -1,
      });
    });

    it("should detect context in second template when first is closed", () => {
      const result = detectTemplateContext(
        "{{first}} and {{second",
        22,
        "mustache"
      );
      expect(result).toEqual({
        isInTemplate: true,
        query: "second",
        startPos: 14,
      });
    });

    it("should not detect context when query contains newline", () => {
      const result = detectTemplateContext("Hello {{\nworld", 14, "mustache");
      expect(result).toEqual({
        isInTemplate: false,
        query: "",
        startPos: -1,
      });
    });

    it("should handle empty string", () => {
      const result = detectTemplateContext("", 0, "mustache");
      expect(result).toEqual({
        isInTemplate: false,
        query: "",
        startPos: -1,
      });
    });

    it("should handle text without any templates", () => {
      const result = detectTemplateContext("Hello world", 11, "mustache");
      expect(result).toEqual({
        isInTemplate: false,
        query: "",
        startPos: -1,
      });
    });
  });

  describe("dollar syntax (${})", () => {
    it("should detect context when cursor is immediately after ${", () => {
      const result = detectTemplateContext("Hello ${", 8, "dollar");
      expect(result).toEqual({
        isInTemplate: true,
        query: "",
        startPos: 6,
      });
    });

    it("should detect context with partial query", () => {
      const result = detectTemplateContext("Hello ${user", 12, "dollar");
      expect(result).toEqual({
        isInTemplate: true,
        query: "user",
        startPos: 6,
      });
    });

    it("should not detect context when template is closed", () => {
      const result = detectTemplateContext("Hello ${name} world", 19, "dollar");
      expect(result).toEqual({
        isInTemplate: false,
        query: "",
        startPos: -1,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle nested braces correctly", () => {
      const result = detectTemplateContext("{{outer.{{inner", 15, "mustache");
      // Should find the last {{ which is at position 8
      expect(result.isInTemplate).toBe(true);
      expect(result.startPos).toBe(8);
      expect(result.query).toBe("inner");
    });

    it("should handle cursor at start of template", () => {
      const result = detectTemplateContext("{{", 2, "mustache");
      expect(result).toEqual({
        isInTemplate: true,
        query: "",
        startPos: 0,
      });
    });

    it("should detect context after multiple closed templates", () => {
      const result = detectTemplateContext("{{a}} {{b}} {{c", 15, "mustache");
      expect(result).toEqual({
        isInTemplate: true,
        query: "c",
        startPos: 12,
      });
    });
  });
});
