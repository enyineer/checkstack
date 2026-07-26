import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
  type Logger,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
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
  .use(correlationMiddleware)
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

/**
 * Resolve which of the `manageCapability` types declared by the candidate items
 * the caller can actually create/manage through a TEAM grant.
 *
 * Without this the palette filters on global rules only, so a team-scoped user
 * (a create-capability grant, no global `*.manage`) loses the very commands they
 * are allowed to run. Only the DISTINCT declared types are probed - a handful per
 * request - and `includeCreator` matches the `typeScoped` middleware, so a team
 * member who may CREATE the type qualifies before owning an instance.
 * Fails CLOSED: an auth error yields no team types, leaving global-rule gating.
 */
async function resolveManageableTypes({
  context,
  items,
  logger,
}: {
  context: RpcContext;
  items: SearchResult[];
  logger: Logger;
}): Promise<Set<string>> {
  const user = context.user;
  if (!user || (user.type !== "user" && user.type !== "application")) {
    return new Set();
  }

  const declared = new Set<string>();
  for (const item of items) {
    const capability = item.manageCapability;
    if (!capability) continue;
    declared.add(capability.objectType);
    if (capability.parentType) declared.add(capability.parentType);
  }
  if (declared.size === 0) return new Set();

  const granted = await Promise.all(
    [...declared].map(async (objectType) => {
      try {
        const { hasGrant } = await context.auth.hasAnyTypeGrant({
          userId: user.id,
          userType: user.type as "user" | "application",
          objectType,
          action: "manage",
          includeCreator: true,
        });
        return hasGrant ? objectType : null;
      } catch (error) {
        logger.debug(
          `command palette: type-grant probe failed for ${objectType}: ${extractErrorMessage(error)}`,
        );
        return null;
      }
    }),
  );

  return new Set(granted.filter((t): t is string => t !== null));
}

export const createCommandRouter = ({ logger }: { logger: Logger }) => {
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
          logger.error(
            `Search provider ${provider.id} failed: ${extractErrorMessage(error)}`,
          );
          return [];
        }
      })
    );

    // Flatten, then filter by the global rules OR a team grant on a declared
    // manageCapability type (so team-scoped users keep their commands).
    const allResults = providerResults.flat();
    const manageableTypes = await resolveManageableTypes({
      context,
      items: allResults,
      logger,
    });
    return filterByAccessRules(allResults, userAccessRules, manageableTypes);
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
          logger.error(
            `Search provider ${provider.id} failed: ${extractErrorMessage(error)}`,
          );
          return [];
        }
      })
    );

    const allCommands = providerResults.flat();
    const manageableTypes = await resolveManageableTypes({
      context,
      items: allCommands,
      logger,
    });
    return filterByAccessRules(allCommands, userAccessRules, manageableTypes);
  });

  return os.router({
    search,
    getCommands,
  });
};

export type CommandRouter = ReturnType<typeof createCommandRouter>;
