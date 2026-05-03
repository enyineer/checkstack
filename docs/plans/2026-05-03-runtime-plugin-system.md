# Runtime Plugin System

> **Status**: Phases 1–3 + 5 shipped (typecheck + lint clean) · Phase 4 (plugin-pack CLI + GitHub Actions example + dogfood) deferred · Phase 7 (tests + docs + changesets) deferred · UI ships with the installed-plugins list only — install + events pages deferred
> **Date**: 2026-05-03 (initial design + first implementation pass)
> **Scope**: Runtime install/uninstall of plugins from npm / tarball / GitHub release / catalog (stub), with metadata validation, dependency-derived compatibility checks, multi-package bundles, multi-instance coordination via Postgres-backed artifact store, single-coordinator destructive cleanup, and dedicated `pluginmanager-*` admin UI.

## Goals

1. Plugins installable at runtime from four sources: **npm** (incl. custom registry), **tarball upload** (filesystem analogue), **GitHub release**, **catalog** (stub for v1).
2. Plugins installable & uninstallable AT RUNTIME without breaking backend or frontend on any instance, including freshly spun-up instances.
3. Plugin install / uninstall events surface a strong typed-confirmation security warning explaining that plugins run with full platform access.
4. Plugins clean up their resources on uninstall (schemas + configs) — destructive cleanup runs on exactly one instance (the originator).
5. Compatibility against the running platform's `@checkstack/*` package versions is **derived from the plugin's `package.json#dependencies` ranges** — no separate `compatibility` field.
6. A single user-facing plugin may consist of multiple npm packages (backend + frontend + common) — installed/uninstalled as an atomic bundle.
7. New `@checkstack/scripts plugin-pack` CLI (runnable via `bunx`) is the single packing tool for both internal monorepo plugins (dogfood) and external plugin authors. Per-package mode for npm publish; `--bundle` mode for GitHub release tarball.

## Non-Goals (v1)

- True sandboxing of plugin code (process-level isolation). Sandboxing requires breaking shared in-process service refs that the plugin system is designed around. v1 ships with `--ignore-scripts`-by-default and strong typed-confirmation as the security control.
- Automatic recovery from a partially-failed install (originator died mid-flight). v1 surfaces the partial state in the audit/events page; operator manually retries.
- Catalog backend / marketplace. UI shows a "Coming Soon" tab; backend installer throws `NotImplementedError`.
- S3 / external object storage for tarballs. v1 stores in Postgres (`bytea`); abstracted so an S3 backend can drop in later.

## Source-of-Truth Decisions (locked in via Q&A)

- Sources: discriminated `PluginSource` union, polymorphic installer per source.
- Tarball storage: Postgres `plugin_artifacts.tarball BYTEA`, abstracted via `PluginArtifactStore`. Hard cap 50MB; dedupe by `contentHash` (sha256).
- GitHub releases use a fixed convention: a single `.tgz` asset packed by the `plugin-pack` CLI. Building never happens at install time — always before release.
- Compatibility: `semver.satisfies(loadedVersion, declaredRange)` for every `@checkstack/*` entry in plugin's `dependencies`. Missing deps must be in the same install bundle, otherwise install fails. No separate compatibility field.
- Bundles: primary package declares `checkstack.bundle: string[]` of sibling package names. Atomic install/uninstall. New `bundle_id` column on `plugins` groups siblings.
- Multi-instance coordination: existing `pluginInstallationRequested` / `pluginDeregistrationRequested` broadcast hooks. **Originator owns destructive cleanup.** Receiving instances only do in-process register/unregister.
- Plugin install scripts: `bun install --ignore-scripts` by default. Opt-in via `package.json#checkstack.allowInstallScripts: true` (surfaces in install warning).
- Plugin metadata required at install time (validated via Zod): `name`, `version`, `description`, `author`, `license` (standard package.json fields) + `checkstack.type`, `checkstack.pluginId`. Optional: `checkstack.bundle`, `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
- Tarball cleanup: deleted from `plugin_artifacts` on uninstall.
- Audit/error events: `plugin_install_events` table; UI surfaces them in the admin "Events" page.
- Build CLI: lives in `@checkstack/scripts`; published to npm so external authors can `bunx @checkstack/scripts plugin-pack`. Per-package `.tgz` for npm publish; `--bundle` mode produces an outer bundle tarball for GitHub release / tarball upload.

## Schema Changes

### `plugins` (extended)
Existing columns: `id, name, path, isUninstallable, config, enabled, type`.
New columns:
- `version TEXT NOT NULL DEFAULT ''`
- `metadata JSONB NOT NULL DEFAULT '{}'` — full validated install-time metadata snapshot
- `source JSONB` — the `PluginSource` used to install (NULL for monorepo-local rows)
- `bundle_id UUID` — groups sibling rows from a bundle install
- `is_primary BOOLEAN NOT NULL DEFAULT FALSE` — true on the primary row of a bundle

### `plugin_artifacts` (new)
```
id UUID PRIMARY KEY
plugin_name TEXT NOT NULL
version TEXT NOT NULL
bundle_id UUID
tarball BYTEA NOT NULL
content_hash TEXT NOT NULL
size_bytes INTEGER NOT NULL
created_at TIMESTAMP NOT NULL DEFAULT NOW()
UNIQUE (plugin_name, version)
INDEX (content_hash)
```

### `plugin_install_events` (new)
```
id UUID PRIMARY KEY
plugin_name TEXT
bundle_id UUID
action TEXT NOT NULL          -- "install" | "uninstall"
phase TEXT NOT NULL            -- "validate" | "persist" | "broadcast" | "in-process-load" | "in-process-unload" | "destructive-cleanup" | "audit"
status TEXT NOT NULL           -- "started" | "succeeded" | "failed"
source JSONB
error TEXT
instance_id TEXT NOT NULL
user_id TEXT
created_at TIMESTAMP NOT NULL DEFAULT NOW()
INDEX (plugin_name, created_at)
INDEX (status, created_at)
```

## Phases

### Phase 1 — Foundations
1. Extend `PluginMetadata` types and add `installPackageMetadataSchema` (Zod) in `core/common`.
2. Add `PluginSource` discriminated union + refactor `PluginInstaller` interface in `core/backend-api`.
3. Schema additions (above) + Drizzle migration.
4. Move `pluginAdminContract` → `pluginmanager-common` as `pluginManagerContract`. New procedures: `previewInstall`, `install`, `previewUninstall`, `uninstall`, `list`, `events`. Old contract deleted (Phase 6).

### Phase 2 — Source installers + artifact store
1. New shared utilities: `extractPackageJsonFromTarball`, `unpackTarballToDir`.
2. Per-source installers under `core/backend/src/services/plugin-installers/`: `npm.ts`, `tarball.ts`, `github.ts`, `catalog.ts` (stub). All implement `PluginInstaller`.
3. `plugin-bundle-resolver.ts` — given a primary `FetchedTarball`, returns the full sibling set.
4. `compatibility-checker.ts` — `coreVersions` map built at boot from every loaded `@checkstack/*` package's `package.json#version`. Verifies plugin's declared `dependencies` ranges via `semver.satisfies`. Bundle-internal deps are resolved within the same install.
5. `plugin-artifact-store.ts` (Postgres bytea backend, abstracted).
6. New core service refs: `pluginInstallerRegistry`, `pluginArtifactStore`.

### Phase 3 — Runtime install/uninstall flow
1. `loadSinglePlugin` refactor: bundle-aware (handles `bundleId`), source-aware (re-fetches tarball from `plugin_artifacts` if missing locally).
2. Originator install flow: `previewInstall` → typed confirmation → `install` does single-coordinator persistence (DB transaction inserts `plugin_artifacts` + `plugins` rows, then broadcasts).
3. Fresh-instance bootstrap: at `loadPlugins()` boot, after `syncPluginsToDatabase`, hydrate any `isUninstallable=true` plugin missing from `node_modules` by pulling from `plugin_artifacts` and running `bun install ./tarball.tgz --no-save --ignore-scripts`.
4. Uninstall split:
   - `deregisterPluginInProcess(pluginId)` — every instance via broadcast, in-memory teardown only.
   - `deletePluginData({ pluginIds, bundleId, deleteSchema, deleteConfigs })` — originator only, after broadcast acked. Drops schema, deletes plugin_configs, deletes plugin_artifacts, deletes plugins rows.
   - Migrate any current cleanup handlers that perform destructive ops to the originator-only path.
5. Audit/event persistence at every step (originator full lifecycle + receiving instances' in-process steps).

### Phase 4 — `@checkstack/scripts plugin-pack` CLI
1. CLI added to `core/scripts`. `bin` entry exposes `plugin-pack` and `plugin-validate` for `bunx`.
2. Per-package mode (default): validates metadata + lints + typechecks + `bun pm pack`. Resolves `workspace:*` deps to concrete versions. Produces `<name>-<version>.tgz`.
3. `--bundle` mode: from a primary package directory, packs every sibling listed in `checkstack.bundle`, wraps them with a `bundle.json` manifest in an outer `<name>-<version>-bundle.tgz`. **Used for GitHub release / tarball upload only — not for npm.**
4. Example `.github/workflows/plugin-release.yml` in `docs/examples/`.
5. Update `package.json` for `@checkstack/scripts` to publish to npm via existing changesets release flow.

### Phase 5 — Frontend admin UI
1. New `core/pluginmanager-common` (contract + access rules + types).
2. New `core/pluginmanager-backend` (router + access rule registration).
3. New `core/pluginmanager-frontend`:
   - Installed plugins page (uninstall via typed confirmation modal).
   - Install page with NPM / Tarball Upload / GitHub URL tabs + Catalog (Coming Soon).
   - Events page (audit/error log surfacing).
4. Reuses existing `usePluginLifecycle` hook for live registry mutation on broadcast.
5. Uses `usePerformance` for animations.

### Phase 6 — Cleanup
1. Delete `core/backend-api/src/plugin-admin-contract.ts`.
2. Delete `core/backend/src/plugin-manager/plugin-admin-router.ts`.
3. Replace usages with new `pluginmanager-*` packages.

### Phase 7 — Dogfood + tests + docs + changesets
1. Refactor every `plugins/*` package to use the new `plugin-pack` CLI. Multi-package plugins (e.g. `notification-telegram-*`, `healthcheck-rcon-*`, `cache-memory-*`, `queue-bullmq-*`, etc.) declare `checkstack.bundle` on the primary package.
2. Unit tests for installers, compatibility checker, bundle resolver, artifact store.
3. Integration tests for full install flow (originator + receiving instances) and uninstall flow (single-coordinator destructive cleanup).
4. E2E test (Playwright) for install/uninstall UI + typed confirmation modal.
5. Docs: `architecture/plugin-distribution.md`, update `architecture/plugin-system.md`, new `getting-started/authoring-plugins.md`.
6. Changesets per affected package.

## Critical files

### New
- `core/pluginmanager-common/`
- `core/pluginmanager-backend/`
- `core/pluginmanager-frontend/`
- `core/backend/src/services/plugin-installers/{npm,tarball,github,catalog,index}.ts`
- `core/backend/src/services/plugin-artifact-store.ts`
- `core/backend/src/services/plugin-bundle-resolver.ts`
- `core/backend/src/services/compatibility-checker.ts`
- `core/scripts/src/plugin-pack/`
- New Drizzle migration under `core/backend/drizzle/`
- `docs/architecture/plugin-distribution.md`
- `docs/getting-started/authoring-plugins.md`
- `docs/examples/plugin-release-workflow.yml`

### Modified
- `core/common/src/plugin-metadata.ts`
- `core/backend-api/src/types.ts`, `core-services.ts`, `plugin-system.ts`
- `core/backend/src/schema.ts`
- `core/backend/src/plugin-manager.ts`, `plugin-manager/plugin-loader.ts`, `plugin-manager/api-router.ts`, `plugin-manager/core-services.ts`
- `core/backend/src/services/plugin-installer.ts` (npm installer subclass)
- `core/backend/src/utils/plugin-discovery.ts`
- `core/scripts/package.json`
- Every `plugins/*/package.json` (add pack script + bundle declarations)

### Deleted
- `core/backend-api/src/plugin-admin-contract.ts`
- `core/backend/src/plugin-manager/plugin-admin-router.ts`
