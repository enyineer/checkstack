---
"@checkstack/backend-api": minor
---

Add `SafeDatabase` type to prevent Drizzle relational query API usage at compile-time

- Added `SafeDatabase<S>` type that omits the `query` field from Drizzle's `NodePgDatabase`
- Updated `DatabaseDeps` to use `SafeDatabase` for all plugin database injection
- Updated `RpcContext.db` and `coreServices.database` to use the safe type
- Updated test utilities to use `SafeDatabase`

This change prevents accidental usage of the relational query API (`db.query`) which is blocked at runtime by the scoped database proxy.
