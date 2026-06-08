import { access } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Access rules for the AI platform plugin.
 *
 * These rule IDs share a single vocabulary with OAuth scopes (Phase 2) and the
 * `autoAuthMiddleware` access-rule checks: a tool that requires `ai.tools-manage`
 * is gated by exactly the same string the middleware enforces, so the surfaced
 * tool set can never widen what the principal could already do in the UI.
 */
export const aiAccess = {
  /**
   * Use the in-app AI chat (Phase 4). Qualified id: `ai.chat.read`.
   * The `access()` factory only supports `read` / `manage` levels, so the
   * domain is carried by the resource segment.
   */
  chatUse: access("chat", "read", "Use the in-app AI chat", {
    pluginId: pluginMetadata.pluginId,
  }),
  /** Manage AI tool projections + introspect the registered tool set. Qualified id: `ai.tools.manage`. */
  toolsManage: access("tools", "manage", "Manage AI tool projections", {
    pluginId: pluginMetadata.pluginId,
  }),
  /** Manage MCP clients and Dynamic Client Registration settings (Phase 2). Qualified id: `ai.mcp.manage`. */
  mcpManage: access("mcp", "manage", "Manage MCP clients and DCR settings", {
    pluginId: pluginMetadata.pluginId,
  }),
  /**
   * Recall saved assistant memories. Qualified id: `ai.memory.read`. Gates the
   * `searchMemory` tool and the memory list RPC; entity-level gating for the
   * `system` tier rides on top via the per-system access resolver.
   */
  memoryRead: access("memory", "read", "Recall saved AI memories", {
    pluginId: pluginMetadata.pluginId,
  }),
  /**
   * Save / delete assistant memories. Qualified id: `ai.memory.manage`. Gates the
   * `saveMemory` (mutate) and `deleteMemory` (destructive) tools and the delete
   * RPC. System-scoped writes additionally require access to the system.
   */
  memoryManage: access("memory", "manage", "Save and delete AI memories", {
    pluginId: pluginMetadata.pluginId,
  }),
  /**
   * Use (list + apply) AI skills - reusable prompt templates. Qualified id:
   * `ai.skill.read`. Default-on, admin-revocable. Gates `listSkills` and the
   * skill pickers.
   */
  skillRead: access("skill", "read", "Use AI skills (reusable prompts)", {
    pluginId: pluginMetadata.pluginId,
  }),
  /**
   * Author (publish) a new GLOBAL AI skill. Qualified id:
   * `ai.skill-create.manage` - the verb rides the resource segment because the
   * `access()` factory only models `read`/`manage`. Default-on, admin-revocable
   * so an admin can stop new-skill creation without affecting use/editing.
   */
  skillCreate: access("skill-create", "manage", "Create global AI skills", {
    pluginId: pluginMetadata.pluginId,
  }),
  /**
   * Edit / delete an AI skill. Qualified id: `ai.skill.manage`. Default-on,
   * admin-revocable. The handler additionally restricts edit/delete to the
   * skill's author (with an admin/privileged override for moderation); builtin
   * skills are never editable.
   */
  skillManage: access("skill", "manage", "Edit and delete AI skills", {
    pluginId: pluginMetadata.pluginId,
  }),
};

/**
 * All AI access rules for registration with the plugin system.
 */
export const aiAccessRules = [
  aiAccess.chatUse,
  aiAccess.toolsManage,
  aiAccess.mcpManage,
  aiAccess.memoryRead,
  aiAccess.memoryManage,
  aiAccess.skillRead,
  aiAccess.skillCreate,
  aiAccess.skillManage,
];
