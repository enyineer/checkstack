---
"@checkstack/backend-api": minor
"@checkstack/auth-common": minor
"@checkstack/auth-backend": minor
"@checkstack/backend": minor
---

perf(auth): cache the authenticated read path on the shared distributed cache

`readEnrichedUser` ran three joins on EVERY authenticated request - user -> roles,
role -> access rules, and (for guests) the anonymous role's rules - which were
among the highest-call-count queries in production even though the underlying
mappings change only on rare admin edits. These are now served read-through from
the **platform `CacheManager`** (the same shared cache every plugin uses):

- `user -> role ids` and `role -> access-rule ids` (`auth-backend/src/auth-cache.ts`)
- anonymous role -> effective rules (read in `core/backend`'s
  `getAnonymousAccessRules`, under auth-backend's cache scope)

Cross-pod correctness comes from the SHARED backend, not from an application
broadcast: with a distributed provider (Redis) an invalidation is a `delete`
every pod sees immediately, so a user load-balanced to any pod always gets an
up-to-date authorization decision. On the default in-memory backend the caches
are per-pod and therefore single-instance-only (the Infrastructure Cache UI now
warns about this). The 60s TTL is only a natural-refresh safety net. User role
membership itself is still resolved live per request; only the rarely-changing
derived mappings are cached.

The reads happen CACHE-FIRST, OUTSIDE any database transaction: `enrichUser` no
longer wraps its lookups in `withScopedTransaction`, so on a cache hit it issues
NO query for roles/rules and never holds a pooled DB connection across the cache
round-trip - only the always-uncached team read touches the DB.

The invalidation is enforced by design, not by convention: all writes to the
`role` / `role_access_rule` / `user_role` tables go through a single
`RoleMembershipStore` that now takes the shared cache as a required constructor
argument and welds each write to its `delete`, so the two cannot drift. The
`checkstack/no-direct-role-membership-writes` lint rule (error) still forbids raw
`insert`/`update`/`delete` on those tables anywhere else in `auth-backend`.

Invalidation completeness (from an adversarial review):

- `RoleMembershipStore.removeAccessRuleMappings` (plugin-deregister cleanup) now
  also evicts the anonymous-access-rules entry, since a removed rule may have
  been granted to the anonymous role.
- `access-rule-sync`'s boot `fullSync` now evicts the affected shared entries
  when a default-rule change actually mutates a non-admin role's grants - a later
  pod's boot / a redeploy runs it against a cache the cluster already warmed, so
  the old "runs against a cold cache" assumption no longer holds under the shared
  cache. An idempotent no-change sync evicts nothing.
- The batched `role -> access-rule ids` read now runs through
  `CachedScope.wrapManyBatched`, so it carries the same epoch guard as the
  single-key path: a role-rules revoke racing an in-flight load can no longer be
  clobbered by the loader's stale write.

BREAKING CHANGE: the internal cache-invalidation hooks
`authHooks.roleAccessRulesInvalidated`, `authHooks.userRolesInvalidated`, and
`coreHooks.anonymousAccessRulesInvalidated` are removed, along with their
per-pod broadcast subscribers. They existed only to keep the old per-pod caches
coherent; the shared cache makes them redundant. These were internal signals,
never a plugin-facing extension contract. `@checkstack/auth-common` now exports
`AUTH_CACHE_PLUGIN_ID` and `ANONYMOUS_ACCESS_RULES_CACHE_KEY` so `core/backend`
and `auth-backend` agree on the shared scope + key for the anonymous entry.
