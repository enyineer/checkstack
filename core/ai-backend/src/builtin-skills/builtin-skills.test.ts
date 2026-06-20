import { describe, expect, it } from "bun:test";
import { AiSkillDefinitionInputSchema } from "@checkstack/ai-common";
import { AUTOMATION_BUILDING_INSTRUCTION } from "../chat/system-prompt";
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

  it("the automation-author skill folds in the full automation-building playbook", () => {
    // The detailed playbook lives in the skill (loads on demand) AND in the base
    // prompt when an automation tool is in scope; the skill must carry it so a
    // skill-led flow gets the guidance even with no automation tool resolved.
    const skill = builtinAiSkills.find((s) => s.id === "automation-author");
    expect(skill?.systemPrompt).toContain(AUTOMATION_BUILDING_INSTRUCTION);
  });

  for (const skill of builtinAiSkills) {
    it(`"${skill.id}" is structurally valid`, () => {
      expect(AiSkillDefinitionInputSchema.safeParse(skill).success).toBe(true);
    });
  }
});
