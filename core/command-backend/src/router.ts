import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkstack/backend-api";
import {
  commandContract,
  filterByAccessRules,
  type SearchResult,
} from "@checkstack/command-common";
import { getSearchProviders } from "./registry";

/**
 * Creates the command router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
const os = implement(commandContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

/**
 * Extract access rules from the context user.
 * Only RealUser and ApplicationUser have access rules; ServiceUser doesn't.
 */
function getUserAccessRules(context: RpcContext): string[] {
  const user = context.user;
  if (!user) return [];
  if (user.type === "user" || user.type === "application") {
    return user.accessRules ?? [];
  }
  // ServiceUser has no accesss array - treated as having all access
  // but for search filtering, return empty (no filtering applied)
  return [];
}

export const createCommandRouter = () => {
  /**
   * Search across all registered search providers.
   * Results are aggregated from all providers, filtered by access rules,
   * and returned in priority order.
   */
  const search = os.search.handler(async ({ input, context }) => {
    const providers = getSearchProviders();
    const query = input.query.toLowerCase().trim();

    // Get user access rules for filtering
    const userAccessRules = getUserAccessRules(context);

    // Execute all provider searches in parallel
    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        try {
          const results = await provider.search(query, {
            userAccessRules: userAccessRules,
          });
          return results;
        } catch (error) {
          // Log but don't fail - one failing provider shouldn't break search
          console.error(`Search provider ${provider.id} failed:`, error);
          return [];
        }
      })
    );

    // Flatten and filter by access rules
    const allResults = providerResults.flat();
    return filterByAccessRules(allResults, userAccessRules);
  });

  /**
   * Get all registered commands for browsing.
   * Returns commands filtered by user access rules.
   */
  const getCommands = os.getCommands.handler(async ({ context }) => {
    const providers = getSearchProviders();
    const userAccessRules = getUserAccessRules(context);

    // Get all results with empty query (commands return all when query is empty)
    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        try {
          // Empty query = return all items
          const results = await provider.search("", {
            userAccessRules: userAccessRules,
          });
          // Filter to only commands for this endpoint
          return results.filter(
            (r): r is SearchResult & { type: "command" } => r.type === "command"
          );
        } catch (error) {
          console.error(`Search provider ${provider.id} failed:`, error);
          return [];
        }
      })
    );

    const allCommands = providerResults.flat();
    return filterByAccessRules(allCommands, userAccessRules);
  });

  return os.router({
    search,
    getCommands,
  });
};

export type CommandRouter = ReturnType<typeof createCommandRouter>;
