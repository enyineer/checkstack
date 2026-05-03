# @checkstack/tsconfig

## 0.0.7

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
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

## 0.0.6

### Patch Changes

- 302cd3f: build: switch typecheck to tsgo with project references (~4× cold, ~200× warm)

  The previous typecheck flow shelled out to `tsc --noEmit` once per workspace
  package via `scripts/typecheck.ts` (concurrency=4). With 117 packages and
  heavy cross-package imports, every invocation re-parsed all transitive
  workspace deps from source — same files type-checked dozens of times per
  run.

  The new flow:

  - A single `tsgo -b` invocation from the repo root, where tsgo is
    `@typescript/native-preview` (TypeScript 7 native port, currently in
    preview).
  - TypeScript project references between every package's tsconfig and its
    workspace deps. Each package is now type-checked exactly once per build,
    with results cached in per-package `.tsbuildinfo`.
  - `composite: true` is moved to `core/tsconfig/base.json` so all packages
    inherit it; `emitDeclarationOnly: true` + `outDir: "${configDir}/.tsbuild"`
    emit only declaration files into a gitignored per-package directory
    (Bun runs source TS directly at runtime, so the .d.ts emit is purely
    to satisfy the project-references contract).
  - Package-level `typecheck` scripts changed from `tsc --noEmit` → `tsgo -b`
    so workspace `--filter` flows still work.
  - `scripts/generate-tsconfig-references.ts` regenerates the references
    array on each package and the root solution `tsconfig.json`. Run via
    `bun run typecheck:references:generate` after adding/removing
    workspace deps.

  ### Measured impact

  |                          | Before | After |
  | ------------------------ | ------ | ----- |
  | Cold full-repo typecheck | 48s    | 12s   |
  | Warm/incremental         | 48s    | 0.25s |

  ### CI

  - New `typecheck:references:check` step on every PR — fails fast when
    someone added a workspace dep but forgot to refresh references. Pure
    text check, <1s.
  - Caches `**/.tsbuild` keyed on a strict hash of every `tsconfig.json`
    - `package.json` + `bun.lock`. Compressed cache size is ~4 MB
      (measured), so transfer overhead is sub-second; cache hit drops the
      typecheck step from ~12s to ~0.3s. The previous slow-cache experience
      in this repo was under the old per-package `tsc` layout; under
      tsgo+composite the metadata lives inside `.tsbuild/` and is much
      smaller.

  ### Plugin scaffolding

  Plugin templates (`backend`, `frontend`, `common`) ship with
  `"typecheck": "tsgo -b"` instead of `tsc --noEmit`. `bun run create`
  now invokes `typecheck:references:generate` automatically so the
  references graph is wired up to the new package without manual steps.

  ### Maintenance commands

  | Script                                  | When to run                                                                                           |
  | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
  | `bun run typecheck`                     | Always; default workflow                                                                              |
  | `bun run typecheck:references:generate` | After adding/removing a `@checkstack/*` workspace dep, or adding a new package (auto-run by `create`) |
  | `bun run typecheck:references:check`    | Dry-run; CI uses this                                                                                 |
  | `bun run typecheck:clean`               | Rare — diagnosing stale cache, post-major-upgrade                                                     |

  `typecheck` does not auto-run the generator (would mutate tsconfigs
  silently) or the cleaner (would defeat the warm cache). The
  `:check` step in CI catches drift instead.

  ### Operational notes

  - The shared `core/tsconfig/vite-env.d.ts` declares minimal Vite types
    (`ImportMeta.env`, `import.meta.glob`, CSS side-effect imports). It's
    pulled into every frontend package via `files` in
    `core/tsconfig/frontend.json` so we don't have to depend on `vite`
    workspace-wide.
  - Three real production-dep cycles in the package graph
    (`backend-api ↔ cache-api`, `backend-api ↔ queue-api`,
    `healthcheck-backend ↔ satellite-backend`) are pruned in the generator
    to keep the references graph acyclic. Affected packages still typecheck
    correctly via TS source-file resolution; the lost optimization is that
    those cycles re-parse together rather than being cached separately.

## 0.0.5

### Patch Changes

- 81f141a: Enable TypeScript incremental compilation for faster typecheck runs

## 0.0.4

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.

## 0.0.3

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
