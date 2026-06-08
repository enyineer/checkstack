import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AiApi } from "@checkstack/ai-common";
import type { OptionsResolver } from "@checkstack/ui";
import { useConnectionOptionResolvers } from "./useConnectionOptionResolvers";

/**
 * The `x-options-resolver` name the `ai_analyze` action declares for its
 * `skillId` field. Resolved here (NOT through the connection bridge) because
 * skills are not connection-scoped: the connection bridge returns `[]` whenever
 * no `connectionId` is selected, which would wrongly empty the skill dropdown.
 */
const AI_SKILL_RESOLVER_NAME = "aiSkillOptions";

/**
 * Resolver map for an action editor's `x-options-resolver` config fields.
 *
 * Composes the connection-backed resolvers (connection picker + cascading
 * provider dropdowns) with non-connection resolvers that need their own data
 * source. Today the only non-connection resolver is `aiSkillOptions`, which
 * lists the AI skills targeting the `ai_analyze` action via `listSkills` -
 * independent of any selected connection.
 */
export function useActionOptionResolvers(
  connectionProviderId?: string,
): Record<string, OptionsResolver> {
  const connectionResolvers = useConnectionOptionResolvers(connectionProviderId);
  const aiClient = usePluginClient(AiApi);

  return React.useMemo(() => {
    const skillResolver: OptionsResolver = async () => {
      const { skills } = await aiClient.listSkills.call({ target: "ai_analyze" });
      return skills.map((skill) => ({
        value: skill.id,
        label: skill.name,
        description: skill.description,
      }));
    };

    return new Proxy<Record<string, OptionsResolver>>(
      {},
      {
        get: (_target, prop) => {
          if (prop === AI_SKILL_RESOLVER_NAME) return skillResolver;
          if (typeof prop !== "string") return;
          return connectionResolvers[prop];
        },
      },
    );
  }, [connectionResolvers, aiClient]);
}
