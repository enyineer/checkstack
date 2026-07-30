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
  /**
   * Team-capability gate. When present, a caller who lacks the global
   * `requiredAccessRules` is STILL shown this item if a team of theirs can
   * create/manage `objectType` (or its `parentType`). Keeps team-scoped users
   * from losing commands they are authorized to run - see `filterByAccessRules`.
   */
  manageCapability: z
    .object({ objectType: z.string(), parentType: z.string().optional() })
    .optional(),
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
  /**
   * Team-capability gate. When present, a caller who lacks the global
   * `requiredAccessRules` is STILL shown this item if a team of theirs can
   * create/manage `objectType` (or its `parentType`). Keeps team-scoped users
   * from losing commands they are authorized to run - see `filterByAccessRules`.
   */
  manageCapability: z
    .object({ objectType: z.string(), parentType: z.string().optional() })
    .optional(),
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
 * Filter items by what the caller may actually do.
 *
 * An item is visible when it declares no `requiredAccessRules`, when the caller
 * holds the wildcard `*`, when the caller holds EVERY required global rule, OR -
 * crucially - when the item declares a `manageCapability` whose type the caller
 * can manage through a TEAM grant.
 *
 * That last arm is why this is not a plain global-rule check: a team-scoped user
 * (e.g. a team with a create-capability grant for `incident.incident`) holds no
 * global `incident.incident.manage` rule, so a global-only filter hid "Create
 * Incident" from exactly the people allowed to run it. This mirrors the
 * `manageCapability` gate routes/nav already use (see `.claude/rules/rlac.md`).
 *
 * `manageableTypes` is the set of qualified resource types the caller can
 * create/manage via a team grant; pass an empty set to reduce to pure global-rule
 * gating.
 */
export function filterByAccessRules<
  T extends {
    requiredAccessRules?: string[];
    manageCapability?: { objectType: string; parentType?: string };
  }
>(
  items: T[],
  userAccessRules: string[],
  manageableTypes: ReadonlySet<string> = new Set()
): T[] {
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
    // Global path: the caller holds every required rule outright.
    if (
      item.requiredAccessRules.every((rule) => userAccessRules.includes(rule))
    ) {
      return true;
    }
    // Team path: a grant on the declared type (or its parent) authorizes it.
    const capability = item.manageCapability;
    if (!capability) return false;
    return (
      manageableTypes.has(capability.objectType) ||
      (capability.parentType !== undefined &&
        manageableTypes.has(capability.parentType))
    );
  });
}
