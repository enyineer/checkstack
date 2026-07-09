/**
 * Shared cache coordinates for the auth read-path caches.
 *
 * These are the ONE contract that lets two packages read/invalidate the same
 * distributed cache entries without importing each other:
 *
 *  - `auth-backend` owns the writes (via `RoleMembershipStore`) and resolves the
 *    role/user caches on the hot authenticated read path.
 *  - `core/backend` reads the ANONYMOUS access rules on every public request
 *    (caching the RPC result) and must therefore agree on the exact scope +
 *    key `auth-backend` invalidates when the anonymous role is edited.
 *
 * Both build a scoped cache with {@link AUTH_CACHE_PLUGIN_ID}, so a `delete` on
 * one pod (or one package) is visible to the other through the shared cache
 * backend (Redis in a horizontally-scaled deployment). This replaces the old
 * `coreHooks.anonymousAccessRulesInvalidated` broadcast.
 */

/** Scope every auth read-path cache key lives under (see `createScopedCache`). */
export const AUTH_CACHE_PLUGIN_ID = "auth";

/**
 * Key (within {@link AUTH_CACHE_PLUGIN_ID}'s scope) of the resolved ANONYMOUS
 * role access-rule list. Written/read by `core/backend`'s
 * `getAnonymousAccessRules`; invalidated by `auth-backend` when the anonymous
 * role's rules change.
 */
export const ANONYMOUS_ACCESS_RULES_CACHE_KEY = "anonymous-access-rules";
