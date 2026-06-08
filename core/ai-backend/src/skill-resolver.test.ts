import { describe, expect, it } from "bun:test";
import type { AiSkill } from "@checkstack/ai-common";
import { createAiSkillResolver } from "./skill-resolver";
import type { AiSkillRegistry } from "./skill-registry";
import type { AiSkillStore } from "./skill-store";

function skill(over: Partial<AiSkill>): AiSkill {
  return {
    id: "x",
    name: "X",
    description: "d",
    targets: ["chat"],
    source: "builtin",
    ...over,
  };
}

function fakes(builtins: AiSkill[], users: AiSkill[]) {
  const registry = { list: () => builtins } as unknown as AiSkillRegistry;
  const store = {
    list: async () => users,
    findById: async (id: string) => users.find((s) => s.id === id),
  } as unknown as AiSkillStore;
  return { registry, store };
}

describe("createAiSkillResolver", () => {
  it("merges builtin + user skills", async () => {
    const { registry, store } = fakes(
      [skill({ id: "builtin.a", source: "builtin" })],
      [skill({ id: "user-1", source: "user", ownerId: "me" })],
    );
    const resolver = createAiSkillResolver({ registry, store });
    const all = await resolver.list();
    expect(all.map((s) => s.id).sort()).toEqual(["builtin.a", "user-1"]);
  });

  it("filters by target surface", async () => {
    const { registry, store } = fakes(
      [
        skill({ id: "chat-only", targets: ["chat"] }),
        skill({ id: "analyze-only", targets: ["ai_analyze"] }),
        skill({ id: "both", targets: ["chat", "ai_analyze"] }),
      ],
      [],
    );
    const resolver = createAiSkillResolver({ registry, store });
    const chat = await resolver.list("chat");
    expect(chat.map((s) => s.id).sort()).toEqual(["both", "chat-only"]);
    const analyze = await resolver.list("ai_analyze");
    expect(analyze.map((s) => s.id).sort()).toEqual(["analyze-only", "both"]);
  });

  it("resolves a builtin before hitting the store, and a user skill by id", async () => {
    const { registry, store } = fakes(
      [skill({ id: "builtin.a", source: "builtin" })],
      [skill({ id: "user-1", source: "user" })],
    );
    const resolver = createAiSkillResolver({ registry, store });
    expect((await resolver.resolve("builtin.a"))?.source).toBe("builtin");
    expect((await resolver.resolve("user-1"))?.source).toBe("user");
    expect(await resolver.resolve("missing")).toBeUndefined();
  });
});
