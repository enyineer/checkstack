import { z } from "zod";
import {
  createClientDefinition,
  definePluginMetadata,
  proc,
} from "@checkstack/common";

// =============================================================================
// PLUGIN METADATA
// =============================================================================

export const pluginMetadata = definePluginMetadata({
  pluginId: "command",
});

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * Schema for a search result displayed in the command palette.
 */
export const SearchResultSchema = z.object({
  id: z.string(),
  type: z.enum(["entity", "command"]),
  title: z.string(),
  subtitle: z.string().optional(),
  /** Icon name (resolved by frontend) */
  iconName: z.string().optional(),
  category: z.string(),
  /** Route to navigate to when the result is selected */
  route: z.string().optional(),
  /** For commands: keyboard shortcuts */
  shortcuts: z.array(z.string()).optional(),
  /** Access rule IDs required to see this result */
  requiredAccessRules: z.array(z.string()).optional(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Schema for a registered command.
 * Commands are searchable and can have global keyboard shortcuts.
 */
export const CommandSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  /** Cross-platform keyboard shortcuts, e.g. ["meta+shift+i", "ctrl+shift+i"] */
  shortcuts: z.array(z.string()).optional(),
  category: z.string(),
  /** Icon name (resolved by frontend) */
  iconName: z.string().optional(),
  /** Route to navigate to when the command is executed */
  route: z.string(),
  /** Access rule IDs required to see/execute this command */
  requiredAccessRules: z.array(z.string()).optional(),
});

export type Command = z.infer<typeof CommandSchema>;

// =============================================================================
// RPC CONTRACT
// =============================================================================

/**
 * Command palette RPC contract.
 * Provides search functionality across all registered providers.
 */
export const commandContract = {
  /**
   * Search across all registered search providers.
   * Returns results filtered by user access rules.
   */
  search: proc({
    operationType: "query",
    userType: "public",
    access: [],
  })
    .input(z.object({ query: z.string() }))
    .output(z.array(SearchResultSchema)),

  /**
   * Get all registered commands (for browsing without a query).
   * Returns commands filtered by user access rules.
   */
  getCommands: proc({
    operationType: "query",
    userType: "public",
    access: [],
  }).output(z.array(SearchResultSchema)),
};

export type CommandContract = typeof commandContract;

/**
 * Client definition for type-safe forPlugin usage.
 * Use: `const client = rpcApi.forPlugin(CommandApi);`
 */
export const CommandApi = createClientDefinition(
  commandContract,
  pluginMetadata
);

// =============================================================================
// ACCESS RULE UTILITIES (shared between frontend and backend)
// =============================================================================

/**
 * Filter items by user access rules.
 * Items without requiredAccessRules are always included.
 * Users with the wildcard "*" access rule can see all items.
 */
export function filterByAccessRules<
  T extends { requiredAccessRules?: string[] }
>(items: T[], userAccessRules: string[]): T[] {
  // Wildcard access rule means access to everything
  const hasWildcard = userAccessRules.includes("*");

  return items.filter((item) => {
    // No access rules required - always visible
    if (!item.requiredAccessRules || item.requiredAccessRules.length === 0) {
      return true;
    }
    // Wildcard user can see everything
    if (hasWildcard) {
      return true;
    }
    // Check if user has all required access rules
    return item.requiredAccessRules.every((rule) =>
      userAccessRules.includes(rule)
    );
  });
}
