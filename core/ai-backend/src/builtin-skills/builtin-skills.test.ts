import { describe, expect, it } from "bun:test";
import { AiSkillDefinitionInputSchema } from "@checkstack/ai-common";
import { builtinAiSkills } from "./index";

describe("builtinAiSkills", () => {
  it("ships skills for both surfaces", () => {
    expect(builtinAiSkills.length).toBeGreaterThanOrEqual(4);
    const targets = new Set(builtinAiSkills.flatMap((s) => s.targets));
    expect(targets.has("chat")).toBe(true);
    expect(targets.has("ai_analyze")).toBe(true);
  });

  it("has a unique id per skill", () => {
    const ids = builtinAiSkills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const skill of builtinAiSkills) {
    it(`"${skill.id}" is structurally valid`, () => {
      expect(AiSkillDefinitionInputSchema.safeParse(skill).success).toBe(true);
    });
  }
});
