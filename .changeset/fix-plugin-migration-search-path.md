---
"@checkstack/backend": minor
---

Fix plugin migrations failing on upgrade with `type "..." does not exist`.

Plugin migrations are schema-agnostic and rely on `search_path` to resolve
unqualified names into the plugin's schema (e.g. `plugin_healthcheck`). The
loader set `search_path` at the session level on the shared admin pool and
then called Drizzle's `migrate()`. Because `migrate()` runs all pending
migrations inside its own transaction, a `pg.Pool` could service that
transaction on a different physical connection than the one the `SET` ran on,
so the migration SQL executed against `public` instead.

This was invisible on a fresh database (every object is created within that
one transaction, so unqualified references still resolve), but broke upgrades:
the healthcheck plugin's new `health_check_state_transitions` migration
references the pre-existing `health_check_status` enum, which an earlier
migration created in the plugin schema. On a different pooled connection that
enum is not on the `public` `search_path`, so startup failed with
`type "health_check_status" does not exist` and the pod crash-looped.

Migrations now run on a single pinned pool connection: the loader checks out
one dedicated client, sets `search_path` on it, and binds the migrator to that
same client, mirroring the connection-affinity pattern already used by the
advisory-lock service. Every migration statement now runs under the intended
schema.
