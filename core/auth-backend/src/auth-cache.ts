import type { CacheManager } from "@checkstack/cache-api";
import { createCachedScope, type CachedScope } from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";
import {
  AUTH_CACHE_PLUGIN_ID,
  ANONYMOUS_ACCESS_RULES_CACHE_KEY,
} from "@checkstack/auth-common";

/**
 * TTL for every auth read-path cache entry. With a distributed backend (Redis)
 * configured, cross-pod coherence comes from the SHARED store — an
 * `invalidate` is a `delete` every pod sees — so the TTL is only a natural
 * refresh / safety net, not the invalidation mechanism. On the default
 * in-memory backend the entries are per-pod (single-instance deployments only).
 */
const AUTH_CACHE_TTL_MS = 60_000;

/** `user-roles:<userId>` — the role ids a user holds. */
const USER_ROLES_PREFIX = "user-roles:";
/** `role-rules:<roleId>` — the access-rule ids a (non-admin) role grants. */
const ROLE_RULES_PREFIX = "role-rules:";

const userRolesKey = (userId: string): string =>
  `${USER_ROLES_PREFIX}${userId}`;
const roleRulesKey = (roleId: string): string =>
  `${ROLE_RULES_PREFIX}${roleId}`;

/**
 * The auth read-path cache — the single sanctioned reader AND invalidator of the
 * two hottest authorization lookups (`user -> role ids`, `role -> access-rule
 * ids`) plus the invalidator of the anonymous-access-rules entry `core/backend`
 * reads.
 *
 * It runs on the platform {@link CacheManager} under the shared
 * {@link AUTH_CACHE_PLUGIN_ID} scope, so with a distributed backend a mutation
 * on ANY pod evicts the affected entry on ALL pods (a user can be load-balanced
 * to any pod, so a stale entry anywhere is an authorization bug) — no
 * application-level broadcast is needed. Reads fail OPEN: a cache-backend outage
 * degrades to a direct DB load, never a failed request.
 *
 * Both resolvers are cache-first: on a hit no DB query runs at all, so the hot
 * authenticated read does not check out a database connection for the parts it
 * can serve from cache.
 */
export interface AuthCache {
  /**
   * A user's role ids, served from cache and loaded via `loadRoles` (the
   * `user_role` join) on a miss. A user with no roles caches as `[]`.
   */
  resolveUserRoles(args: {
    userId: string;
    loadRoles: () => Promise<string[]>;
  }): Promise<string[]>;

  /**
   * `roleId -> access-rule ids` for the given non-admin roles: cache hits are
   * served directly and only the misses are loaded, in ONE batched query via
   * `loadMisses` (which returns a `roleId -> rules` map for the ids it is
   * given). Every miss — including a role that returns no rules — is cached (as
   * `[]`) so it is not re-loaded next request.
   */
  resolveRoleAccessRules(args: {
    nonAdminRoleIds: string[];
    loadMisses: (missRoleIds: string[]) => Promise<Map<string, string[]>>;
  }): Promise<Map<string, string[]>>;

  /** Drop one user's cached roles, or (no argument) every user's. */
  invalidateUserRoles(userId?: string): Promise<void>;

  /** Drop one role's cached rules, or (no argument) every role's. */
  invalidateRoleAccessRules(roleId?: string): Promise<void>;

  /** Drop the cached anonymous access-rules entry `core/backend` reads. */
  invalidateAnonymousAccessRules(): Promise<void>;
}

/**
 * A no-op {@link AuthCache} that never caches and never invalidates. It exists
 * ONLY for tests and as the `createAuthRouter` default in test harnesses that do
 * not exercise the role/user caches — production ALWAYS wires the real
 * {@link createAuthCache}. `resolve*` always calls the loader (never a cache
 * hit), so behavior is identical to an uncached read; `invalidate*` is a no-op.
 */
export function createNoopAuthCache(): AuthCache {
  return {
    resolveUserRoles: ({ loadRoles }) => loadRoles(),
    // Mirror the real resolver's empty-set guard (no `inArray([])` query) so an
    // admin-only / no-roles user issues the same queries uncached as cached.
    resolveRoleAccessRules: ({ nonAdminRoleIds, loadMisses }) =>
      nonAdminRoleIds.length === 0
        ? Promise.resolve(new Map<string, string[]>())
        : loadMisses(nonAdminRoleIds),
    invalidateUserRoles: async () => {},
    invalidateRoleAccessRules: async () => {},
    invalidateAnonymousAccessRules: async () => {},
  };
}

export function createAuthCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): AuthCache {
  const scope: CachedScope = createCachedScope({
    cacheManager,
    pluginId: AUTH_CACHE_PLUGIN_ID,
    defaultTtlMs: AUTH_CACHE_TTL_MS,
    onError: (op, error) => {
      logger.warn(`auth cache ${op} failed: ${String(error)}`);
    },
  });

  const resolveUserRoles: AuthCache["resolveUserRoles"] = ({
    userId,
    loadRoles,
  }) => scope.wrap(userRolesKey(userId), loadRoles);

  const resolveRoleAccessRules: AuthCache["resolveRoleAccessRules"] = async ({
    nonAdminRoleIds,
    loadMisses,
  }) => {
    // Batched, EPOCH-GUARDED read-through: hits are served from cache and the
    // misses are loaded in ONE query via `loadMisses`, while `wrapManyBatched`
    // (like `scope.wrap`) refuses to write back a value whose key was
    // invalidated mid-load - so a concurrent role-rules revoke truly wins the
    // race and cannot be clobbered by an in-flight loader's stale write. Fail
    // open (a cache-backend outage degrades to a DB load) is handled inside
    // `wrapManyBatched`.
    const rules = await scope.wrapManyBatched(nonAdminRoleIds, {
      keyFor: roleRulesKey,
      load: async (missRoleIds) => {
        const fresh = await loadMisses(missRoleIds);
        // A role with no rules caches as [] so it is not re-loaded next request.
        return missRoleIds.map((roleId) => fresh.get(roleId) ?? []);
      },
    });

    const rulesByRole = new Map<string, string[]>();
    for (const [i, roleId] of nonAdminRoleIds.entries()) {
      rulesByRole.set(roleId, rules[i]!);
    }
    return rulesByRole;
  };

  return {
    resolveUserRoles,
    resolveRoleAccessRules,
    invalidateUserRoles: async (userId) => {
      await (userId === undefined
        ? scope.invalidatePrefix(USER_ROLES_PREFIX)
        : scope.invalidate(userRolesKey(userId)));
    },
    invalidateRoleAccessRules: async (roleId) => {
      await (roleId === undefined
        ? scope.invalidatePrefix(ROLE_RULES_PREFIX)
        : scope.invalidate(roleRulesKey(roleId)));
    },
    invalidateAnonymousAccessRules: () =>
      scope.invalidate(ANONYMOUS_ACCESS_RULES_CACHE_KEY),
  };
}
