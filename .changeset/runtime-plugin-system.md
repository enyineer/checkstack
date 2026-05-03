---
"@checkstack/about-frontend": patch
"@checkstack/announcement-common": patch
"@checkstack/anomaly-backend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/auth-common": patch
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/cache-backend": patch
"@checkstack/cache-frontend": patch
"@checkstack/catalog-backend": patch
"@checkstack/catalog-common": patch
"@checkstack/catalog-frontend": patch
"@checkstack/command-common": patch
"@checkstack/common": minor
"@checkstack/dashboard-frontend": patch
"@checkstack/dependency-backend": patch
"@checkstack/dependency-common": patch
"@checkstack/drizzle-helper": patch
"@checkstack/frontend": minor
"@checkstack/gitops-backend": patch
"@checkstack/gitops-common": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-backend": patch
"@checkstack/incident-frontend": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/integration-common": patch
"@checkstack/maintenance-backend": patch
"@checkstack/maintenance-common": patch
"@checkstack/notification-backend": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-common": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/queue-api": patch
"@checkstack/queue-common": patch
"@checkstack/satellite-backend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/scripts": minor
"@checkstack/signal-backend": patch
"@checkstack/signal-frontend": patch
"@checkstack/slo-backend": patch
"@checkstack/slo-common": patch
"@checkstack/slo-frontend": patch
"@checkstack/test-utils-backend": patch
"@checkstack/test-utils-frontend": patch
"@checkstack/theme-common": patch
"@checkstack/tsconfig": patch
"@checkstack/ui": patch
"@checkstack/auth-github-backend": patch
"@checkstack/auth-saml-backend": patch
"@checkstack/cache-memory-common": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-rcon-common": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-ssh-common": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/integration-jira-common": patch
"@checkstack/integration-teams-backend": patch
"@checkstack/integration-webex-backend": patch
"@checkstack/integration-webhook-backend": patch
"@checkstack/notification-discord-backend": patch
"@checkstack/notification-pushover-backend": patch
"@checkstack/notification-smtp-backend": patch
"@checkstack/notification-telegram-backend": patch
"@checkstack/queue-bullmq-backend": patch
"@checkstack/queue-bullmq-common": patch
"@checkstack/queue-memory-common": patch
---

Runtime plugin system: install + uninstall plugins from npm, GitHub releases
(including private GitHub Enterprise instances), or tarball uploads at
runtime, with multi-package bundles, dependency-derived compatibility checks,
multi-instance coordination via a Postgres artifact store, and
single-coordinator destructive cleanup.

Highlights:

- New `PluginSource` discriminated union and `PluginInstaller` /
  `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
  GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
  GitHub Enterprise can install from `https://ghe.example.com/api/v3`
  instead of `api.github.com`.
- New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
  every plugin's `package.json` at install time. Required fields: `name`,
  `version`, `description`, `author`, `license`, `checkstack.type`,
  `checkstack.pluginId`. Optional: `checkstack.bundle`,
  `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
- New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
  `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
  `events` procedures.
- New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
  with per-row uninstall (typed-confirmation modal, schema/configs/cascade
  toggles), install page with NPM / Tarball Upload / GitHub Release tabs
  (Catalog tab disabled — coming soon), and an events page surfacing the
  install/uninstall audit log.
- New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
  per-package mode produces an npm-shaped tarball; `--bundle` mode produces
  an outer tarball containing every sibling declared in
  `package.json#checkstack.bundle`. Published to npm so external authors
  can `bunx` it directly without a workspace checkout.
- Compatibility derived from `package.json#dependencies` ranges
  (`semver.satisfies` against the platform's loaded `@checkstack/*`
  versions) — no separate `compatibility` field.
- Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
  install/uninstall; receiving instances do in-process register/unregister
  only. Destructive ops (drop schema, delete plugin_configs, delete
  artifacts, delete `plugins` rows) run exactly once on the originator.
- Fresh-instance bootstrap: `loadPlugins()` hydrates any
  `is_uninstallable=true` plugin missing from `node_modules` from the
  artifact store before normal Phase 1 register.
- New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
  (audit/error log). `plugins` extended with `version`, `metadata`,
  `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
  `version` from each plugin's `package.json` so the admin UI shows real
  versions instead of `—`.
- Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
  the install UI; access-gated by `pluginmanager.plugin.manage`.
- Plugin Manager menu link added to the user menu (main grid, alongside
  Profile / Notification Settings / etc.).

Cross-cutting changes:

- Backend request/response logging now flows through `rootLogger` (winston)
  instead of `hono/logger`. 5xx responses include the response body inline
  so swallowed early-return errors are visible in the log.
- The `/api/:pluginId/*` dispatcher now logs which core service is missing
  or which `pluginId` had no metadata when it 500s.
- New `registerCorePluginMetadata` on `PluginManager` for core routers
  (like the plugin manager itself) that need their metadata visible to the
  RPC dispatcher without going through the full plugin lifecycle.
- ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
  between `null` (writes a real SQL NULL) and `undefined` (skip the column
  on insert), so treating them as interchangeable produced latent bugs at
  the persistence boundary. The bulk of the patch-bumped packages above
  reflect lint-fix touches that landed when this rule was relaxed.
- Workspace-wide license normalization to `Elastic-2.0` (matches
  `LICENSE.md`). Every `package.json` in the workspace now declares the
  same SPDX identifier; the patch bumps capture this.

Plugin packages (every `plugins/*`): added a `pack` npm script
(`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
`pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
so install-time validation passes, stubbed any missing required metadata
fields (`description`, `author`, `license`), and added
`checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
jira, queue-bullmq, queue-memory, cache-memory).

Breaking changes:

- The legacy single-method `PluginInstaller` interface (`install(packageName)`)
  is removed. Callers must use `coreServices.pluginInstallerRegistry`.
- The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
  Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
  and `createPluginManagerRouter` in `core/backend`.
- `@checkstack/test-utils-backend` no longer exports
  `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
  it shimmed is gone).

Note: bumps are limited to `minor` (for packages with new public API
surface) and `patch` (for downstream consumers, license normalization,
and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
the legacy interface had no third-party consumers in the wild before this
runtime plugin system landed, and the contract surface is the same shape
modulo the rename.
