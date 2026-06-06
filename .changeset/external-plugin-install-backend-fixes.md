---
"@checkstack/backend": patch
---

Fix the runtime (installed) plugin path so an external plugin uploaded via the Plugin Manager actually installs and its backend loads. Five distinct defects, surfaced by a new full install E2E:

- **Plugin Manager access denied for admins.** The Plugin Manager's core access rules were registered *after* `loadPlugins`, so the auth full-sync never wrote them to the DB; and the hand-rolled `upload-tarball` route checked `accessRules.includes(rule)` without honoring the admin `"*"` wildcard. Rules now register before `loadPlugins`, and the route honors `"*"` (matching `openapi-router.ts`).
- **Bundle installs 404'd on intra-bundle deps.** A bundle's siblings were installed one tarball at a time, so a sibling that depends on another sibling failed to resolve against the registry. `installBundleFromArtifacts` now installs the whole bundle via a throwaway manifest using `file:` deps + `overrides`, resolving siblings locally and merging the result into the shared runtime dir.
- **Primary artifact was the outer bundle archive.** The tarball/github installers stored the outer `bundle.json` archive as the primary's artifact instead of the primary's own package tarball; they now store the inner package tarball.
- **Non-backend siblings loaded as backend plugins.** The install broadcast tried to load `common`/`frontend` siblings as backend plugins ("does not export a valid BackendPlugin"). Only `type: "backend"` packages now register as backend plugins (mirroring fresh-instance bootstrap).
- **Runtime backend never migrated or got a scoped DB.** `loadSinglePlugin` now runs the plugin's Drizzle migrations into its isolated schema and injects the plugin-scoped `database` into `init`, matching the full-system loader.

Note: the installed *frontend* half of a runtime plugin remains a known gap (the host only shares React/router with runtime plugins, and `plugin-pack` does not build frontends); tracked separately for a follow-up.
