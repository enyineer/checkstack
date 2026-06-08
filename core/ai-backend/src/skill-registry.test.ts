import { describe, expect, it } from "bun:test";
import type { PluginMetadata } from "@checkstack/common";
import type { AiSkillDefinitionInput } from "@checkstack/ai-common";
import { createAiSkillRegistry } from "./skill-registry";

const plugin = { pluginId: "demo" } as PluginMetadata;

function def(over: Partial<AiSkillDefinitionInput> = {}): AiSkillDefinitionInput {
  return {
    id: "summarize",
    name: "Summarize",
    description: "A demo skill",
    targets: ["chat"],
    systemPrompt: "Be concise.",
    ...over,
  };
}

describe("createAiSkillRegistry", () => {
  it("qualifies the id and stamps source=builtin + pluginId", () => {
    const registry = createAiSkillRegistry();
    registry.register(def(), plugin);
    const [skill] = registry.list();
    expect(skill.id).toBe("demo.summarize");
    expect(skill.source).toBe("builtin");
    expect(skill.pluginId).toBe("demo");
  });

  it("throws on a duplicate qualified id", () => {
    const registry = createAiSkillRegistry();
    registry.register(def(), plugin);
    expect(() => registry.register(def(), plugin)).toThrow(/already registered/);
  });

  it("rejects a structurally invalid skill at registration", () => {
    const registry = createAiSkillRegistry();
    // No targets -> schema requires at least one.
    expect(() => registry.register(def({ targets: [] }), plugin)).toThrow();
  });
});
