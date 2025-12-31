---
---
# Drizzle Schema Isolation

## The Problem

When using Drizzle with per-plugin database schemas (e.g., `plugin_catalog-backend`, `plugin_auth-backend`), Drizzle-kit generates migrations with hardcoded `"public".` schema references in foreign key constraints. This causes migrations to fail when run in isolated schemas.

Example problematic migration:
```sql
ALTER TABLE "systems_groups" 
  ADD CONSTRAINT "systems_groups_system_id_systems_id_fk" 
  FOREIGN KEY ("system_id") 
  REFERENCES "public"."systems"("id") 
  ON DELETE cascade;
```

## The Solution

The **backend core automatically fixes migrations at runtime** before executing them. When the `PluginManager` discovers migrations for any plugin, it:

1. Scans all `.sql` files in the plugin's `drizzle/` folder
2. Removes any hardcoded `"public".` schema references
3. Runs the fixed migrations in the plugin's isolated schema

This happens automatically for **all plugins** (local and remote) with zero configuration required.

### Implementation

The fix is implemented in `/packages/backend/src/utils/fix-migrations.ts` and is called automatically by the `PluginManager` before running any plugin migrations.

```typescript
// In PluginManager.loadPlugins()
if (fs.existsSync(migrationsFolder)) {
  // Automatic fix before migration
  fixMigrationsSchemaReferences(migrationsFolder);
  
  await migrate(pluginDb, { migrationsFolder });
}
```

### For Plugin Developers

**You don't need to do anything special!** Just:

1. Generate migrations normally: `bun run generate`
2. The backend will automatically fix them at runtime
3. No scripts to copy, no extra configuration needed

### Why This Approach?

✅ **Centralized**: Logic lives in one place (backend core)  
✅ **Automatic**: Works for all plugins without configuration  
✅ **Future-proof**: Works for remotely loaded plugins  
✅ **No duplication**: No need to copy scripts across plugins  
✅ **Safe**: Migrations are fixed before execution, preventing errors

### Alternative Approaches (Not Used)

1. **Use `pgSchema()` in table definitions**: Doesn't work because we need dynamic schemas per plugin
2. **Per-plugin fix scripts**: Requires duplication and maintenance
3. **Manual migration editing**: Error-prone and doesn't scale
4. **Custom migration runner**: Overly complex for this use case

## Technical Details

- Migration files are modified in-place before execution
- Only files with `"public".` references are modified
- The fix is idempotent (safe to run multiple times)
- Debug logs show which files were fixed

## Future Considerations

If Drizzle adds a configuration option like `schemaAgnostic: true` in the future, we can remove this runtime fix. Track Drizzle ORM issues for updates.
