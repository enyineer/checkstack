---
"@checkstack/auth-backend": patch
---

Cut the per-request database round-trips in the auth backend's principal
enrichment. `enrichUser` runs on EVERY authenticated request and was the
hottest scoped-db path, yet it issued one `SET LOCAL search_path` transaction
per query and fanned an access-rule query out per role (N+1).

- `enrichUser` now resolves a user's access rules in ONE set-based `inArray`
  query for all non-admin roles (grouped per role in JS, mirroring
  `enrichApplicationPrincipal` / `resolveAllApplicationAccessRules`) instead of
  one query per role, and wraps its three sequential reads (roles -> access
  rules -> teams) in a single `withScopedTransaction`. A user with R roles now
  costs 2-3 queries under one `BEGIN`/`SET LOCAL`/`COMMIT` instead of `2 + R`
  standalone transactions. The resolved roles, merged access rules (deduped
  union in role-insertion order), and teams are unchanged.
- `enrichApplicationPrincipal` wraps its four sequential reads in one
  `withScopedTransaction` (4 standalone transactions -> 1).
- The opaque-OAuth-bearer branch (introspect -> user -> enrich -> access-rule
  catalog) runs entirely under a single scoped transaction, threading one `tx`
  into a shared `readEnrichedUser` read helper; `introspectOpaqueToken` now
  accepts a `ScopedQueryRunner` so it can run on that `tx`. This collapses
  ~7 standalone transactions on the MCP/OAuth call path into one.

No behavior change: the same users, roles, access rules, and teams are
resolved, only the query shape and connection churn change.
