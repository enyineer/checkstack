import { createServiceRef } from "@checkstack/backend-api";
import type { AiSkill, AiSkillTarget } from "@checkstack/ai-common";
import type { AiSkillRegistry } from "./skill-registry";
import type { AiSkillStore } from "./skill-store";

/**
 * Merges the two skill sources - builtin (code) + user (DB) - into one
 * catalogue, and resolves a single skill by id. This is the read surface the
 * RPC handlers, chat service, and `ai_analyze` action use.
 */
export interface AiSkillResolver {
  /** All skills (builtin + user), optionally filtered to a target surface. */
  list(target?: AiSkillTarget): Promise<AiSkill[]>;
  /** Resolve one skill by id (builtin or user), or undefined. */
  resolve(id: string): Promise<AiSkill | undefined>;
}

export function createAiSkillResolver({
  registry,
  store,
}: {
  registry: AiSkillRegistry;
  store: AiSkillStore;
}): AiSkillResolver {
  return {
    async list(target) {
      const all = [...registry.list(), ...(await store.list())];
      if (!target) return all;
      return all.filter((skill) => skill.targets.includes(target));
    },

    async resolve(id) {
      const builtin = registry.list().find((s) => s.id === id);
      if (builtin) return builtin;
      return store.findById(id);
    },
  };
}

/**
 * Service ref so another plugin (e.g. automation-backend's `ai_analyze` action
 * and its `aiSkillOptions` resolver) can read the merged skill catalogue
 * without importing ai-backend internals.
 */
export const aiSkillResolverRef = createServiceRef<AiSkillResolver>(
  "ai.skillResolver",
);
