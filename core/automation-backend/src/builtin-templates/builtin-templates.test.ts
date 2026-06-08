import { describe, expect, it } from "bun:test";
import {
  AutomationDefinitionSchema,
  AutomationTemplateInputSchema,
} from "@checkstack/automation-common";
import { builtinAutomationTemplates } from "./index";

describe("builtinAutomationTemplates", () => {
  it("ships a non-empty, diverse catalogue", () => {
    expect(builtinAutomationTemplates.length).toBeGreaterThanOrEqual(5);
    const categories = new Set(builtinAutomationTemplates.map((t) => t.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it("has a unique id per template", () => {
    const ids = builtinAutomationTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const template of builtinAutomationTemplates) {
    it(`"${template.id}" is a structurally valid template + definition`, () => {
      // The whole template input parses (id/name/description/category/icon).
      expect(AutomationTemplateInputSchema.safeParse(template).success).toBe(true);
      // The definition parses against the canonical automation schema. Semantic
      // validation against the LIVE registries happens at server startup
      // (validate-templates.ts); this guards structural drift in CI.
      const parsed = AutomationDefinitionSchema.safeParse(template.definition);
      if (!parsed.success) {
        throw new Error(
          `${template.id} definition invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`,
        );
      }
    });
  }
});
