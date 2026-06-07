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
};

/**
 * All AI access rules for registration with the plugin system.
 */
export const aiAccessRules = [
  aiAccess.chatUse,
  aiAccess.toolsManage,
  aiAccess.mcpManage,
];
