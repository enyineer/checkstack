---
"@checkstack/backend": patch
---

Update plugin loader to use SafeDatabase type

- Updated `PluginLoaderDeps.db` type from `NodePgDatabase` to `SafeDatabase`
- Added type cast for drizzle `migrate()` function which still requires `NodePgDatabase`
