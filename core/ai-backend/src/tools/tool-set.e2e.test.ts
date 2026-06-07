import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import { aiAccess, pluginMetadata as aiPluginMetadata } from "@checkstack/ai-common";
import { qualifyAccessRuleId } from "@checkstack/common";
import { createAiToolRegistry } from "../tool-registry";
import type { AiToolRegistry } from "../tool-registry";
import { createAiToolResolver } from "../resolver";
import { buildCompositeTools } from "./composite-tools";

const CHAT_READ_RULE = qualifyAccessRuleId(aiPluginMetadata, aiAccess.chatUse);

/**
 * ai-backend's OWN platform tools, built from the SAME shared `buildCompositeTools`
 * factory the plugin init uses. After the decouple, these are the genuinely
 * cross-plugin / platform read tools (docs grounding + URL probe) - all gated by
 * the broad `ai.chat.read` surface. Plugin-specific tools (propose/update/delete,
 * capability catalogs, script-context) and projected read tools are owned by and
 * registered FROM their plugins via the extension points, and are covered by
 * those plugins' OWN tests - ai-backend neither builds nor imports them.
 */
function buildOwnRegistry(): AiToolRegistry {
  const registry = createAiToolRegistry();
  for (const tool of buildCompositeTools()) {
    const name = tool.name.includes(".") ? tool.name : `ai.${tool.name}`;
    registry.register({ ...tool, name });
  }
  return registry;
}

/** An admin-equivalent principal (the `*` escape) - sees every tool. */
const adminPrincipal: AuthUser = {
  type: "user",
  id: "admin",
  accessRules: ["*"],
};

describe("ai-backend's own platform tool set", () => {
  test("docs + probe tools are registered and qualified", () => {
    const registry = buildOwnRegistry();
    const names = registry.getTools().map((t) => t.name);
    for (const expected of ["ai_searchDocs", "ai_getDoc", "ai_probeUrl"]) {
      expect(names).toContain(expected);
    }
  });

  test("admin resolves every registered tool", () => {
    const registry = buildOwnRegistry();
    const resolver = createAiToolResolver({ registry });
    expect(resolver.resolveTools(adminPrincipal)).toHaveLength(
      registry.getTools().length,
    );
  });

  test("every own tool is a read tool gated by the broad chat-read surface", () => {
    // ai-backend's own tools are all platform read tools (docs + probe). A
    // service-client fan-out read tool would need an in-execute re-check; these
    // touch only bundled docs or an outbound fetch, so chat-read is the gate.
    const registry = buildOwnRegistry();
    for (const tool of registry.getTools()) {
      expect(tool.effect).toBe("read");
      expect(tool.requiredAccessRules).toContain(CHAT_READ_RULE);
    }
  });
});
