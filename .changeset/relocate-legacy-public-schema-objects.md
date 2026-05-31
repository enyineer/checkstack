---
"@checkstack/backend": minor
---

Relocate plugin objects stranded in `public` into their plugin schema, and run
migrations under a strict plugin-only `search_path`.

Some databases predate per-plugin schema isolation and have a plugin's tables
and enums sitting in `public` while the `__drizzle_migrations` ledger lives in
the plugin schema. Runtime kept working because the scoped-db `search_path`
falls back to `public`, but migrations did not: a new migration referencing a
pre-existing object (e.g. the `health_check_status` enum) failed at startup with
`type "health_check_status" does not exist`, crash-looping the pod. The previous
pinned-connection fix made this deterministic by reliably targeting the
(empty-of-that-object) plugin schema.

The loader now, before running a plugin's migrations, MOVES any of that plugin's
objects still in `public` into `plugin_<id>` with fully-qualified
`ALTER ... SET SCHEMA` statements (by-OID, so columns, foreign keys, enum
references, and owned sequences keep working). The relocation is idempotent
(only moves objects that are in `public` and not already in the plugin schema)
and is driven by the union of every Drizzle snapshot the plugin ships, so a
table an early migration created and a later one drops is moved first and its
unqualified `DROP TABLE` still resolves.

With the stragglers relocated, migrations run under a strict
`search_path = "plugin_<id>"` (no `public` fallback). Combined with creating the
schema before the `SET`, unqualified `CREATE TABLE` / `CREATE TYPE` can only ever
land in the plugin schema, never silently in `public`.
