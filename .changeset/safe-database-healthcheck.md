---
"@checkstack/healthcheck-backend": patch
---

Fix 500 error on `getDetailedAggregatedHistory` and update to SafeDatabase type

- Fixed runtime error caused by usage of Drizzle relational query API (`db.query`) in `getAggregatedHistory`
- Replaced `db.query.healthCheckConfigurations.findFirst()` with standard `db.select()` query
- Updated all database type declarations from `NodePgDatabase` to `SafeDatabase`
