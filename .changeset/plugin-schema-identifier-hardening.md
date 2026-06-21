---
"@checkstack/common": patch
"@checkstack/drizzle-helper": patch
"@checkstack/backend": patch
---

fix(backend): quote and validate plugin schema identifiers in SQL

Plugin schema identifiers are no longer interpolated raw into SQL. `pluginId` is
now constrained to a safe charset (`pluginIdSchema` in `@checkstack/common`),
`getPluginSchemaName` asserts that charset before producing a schema name, and
the `SET LOCAL search_path` and `DROP SCHEMA` statements use `sql.identifier`
(properly quoted and escaped) instead of string interpolation.

This is defense in depth within an already-trusted boundary (installing a plugin
is arbitrary code execution): no behavior changes for valid ids, but a
malformed or hostile `pluginId` can no longer break out of a quoted identifier.
