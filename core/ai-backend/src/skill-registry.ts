import type { PluginMetadata } from "@checkstack/common";
import {
  AiSkillSchema,
  type AiSkill,
  type AiSkillDefinitionInput,
} from "@checkstack/ai-common";

/**
 * In-memory registry of BUILTIN skills contributed by core + plugins through
 * `aiSkillExtensionPoint`. Deterministic + rebuilt identically on every pod
 * (derived code, no shared-state concern). User-authored skills live in the
 * `ai_skill` table, not here; the resolver merges the two.
 */
export interface AiSkillRegistry {
  register(skill: AiSkillDefinitionInput, pluginMetadata: PluginMetadata): void;
  list(): AiSkill[];
}

export function createAiSkillRegistry(): AiSkillRegistry {
  const skills = new Map<string, AiSkill>();

  return {
    register(skill, pluginMetadata) {
      const qualifiedId = `${pluginMetadata.pluginId}.${skill.id}`;
      if (skills.has(qualifiedId)) {
        throw new Error(
          `AI skill ${qualifiedId} already registered — likely a duplicate registration in ${pluginMetadata.pluginId}.`,
        );
      }
      // Parse to normalize + stamp source/pluginId, and to reject a malformed
      // builtin at registration time.
      const normalized = AiSkillSchema.parse({
        ...skill,
        id: qualifiedId,
        source: "builtin",
        pluginId: pluginMetadata.pluginId,
      });
      skills.set(qualifiedId, normalized);
    },

    list() {
      return [...skills.values()];
    },
  };
}
