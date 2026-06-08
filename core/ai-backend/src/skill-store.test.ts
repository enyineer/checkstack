import { describe, expect, it } from "bun:test";
import { AiSkillSchema } from "@checkstack/ai-common";
import type { AiSkillRow } from "./schema";
import { rowToSkill } from "./skill-store";

function row(over: Partial<AiSkillRow> = {}): AiSkillRow {
  return {
    id: "s1",
    ownerId: "user-1",
    name: "My skill",
    description: "Does a thing",
    targets: ["chat"],
    systemPrompt: null,
    promptTemplate: null,
    suggestedOutputFields: null,
    tags: null,
    createdAt: new Date("2026-06-08T00:00:00Z"),
    updatedAt: new Date("2026-06-08T00:00:00Z"),
    ...over,
  };
}

describe("rowToSkill", () => {
  it("maps a row with NULL optional columns to a schema-valid skill (regression: listSkills 500)", () => {
    const skill = rowToSkill(row());
    // Null DB columns must become undefined, not null — the schema fields are
    // optional but not nullable, so a null here fails output validation.
    expect(skill.suggestedOutputFields).toBeUndefined();
    expect(skill.systemPrompt).toBeUndefined();
    expect(skill.tags).toBeUndefined();
    expect(skill.source).toBe("user");
    // The whole thing must round-trip through the wire schema.
    expect(AiSkillSchema.safeParse(skill).success).toBe(true);
  });

  it("preserves populated optional columns", () => {
    const skill = rowToSkill(
      row({
        systemPrompt: "be concise",
        suggestedOutputFields: [
          { key: "sev", type: "string", description: "severity" },
        ],
        tags: ["ops"],
      }),
    );
    expect(skill.systemPrompt).toBe("be concise");
    expect(skill.suggestedOutputFields).toHaveLength(1);
    expect(AiSkillSchema.safeParse(skill).success).toBe(true);
  });
});
