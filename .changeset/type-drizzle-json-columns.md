---
"@checkstack/catalog-backend": patch
"@checkstack/backend": patch
---

refactor: type Drizzle JSON columns at the schema to remove boundary casts

The catalog `metadata` (systems/groups/environments) and `configuration`
(views) JSON columns now carry their concrete shape via `.$type<>()`
(`Record<string, unknown>` and `string[]` respectively), so the column type
flows naturally into the RPC contract output and the ~14 `as unknown as
Array<... & { metadata: ... }>` and `as Record<string, unknown> | null` reader
casts in the catalog router are gone. The plugin-system `source` column in
`@checkstack/backend` is typed as `PluginSource`, removing its read-site cast.

This is a type-only change: `.$type<>()` does not alter SQL, so no new
migration is generated and existing migrations are untouched.
