# @checkstack/satellite-backend

## 0.3.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/gitops-backend@0.3.4
  - @checkstack/healthcheck-backend@1.1.3
  - @checkstack/queue-api@0.3.3
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/satellite-common@0.5.1

## 0.3.3

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/gitops-backend@0.3.3
  - @checkstack/healthcheck-backend@1.1.2
  - @checkstack/queue-api@0.3.2

## 0.3.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/gitops-backend@0.3.2
  - @checkstack/healthcheck-backend@1.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [7c97b43]
- Updated dependencies [9016526]
  - @checkstack/healthcheck-backend@1.1.0
  - @checkstack/common@0.10.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/satellite-common@0.5.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/signal-common@0.2.3
  - @checkstack/queue-api@0.3.1

## 0.3.0

### Minor Changes

- f6f9a5c: Add a GitOps `Satellite` kind plus a UI affordance for resetting tokens.

  GitOps owns satellite **metadata only** — `metadata.name`,
  `spec.region`, and `metadata.labels` (used as the satellite's runtime
  tags). The bcrypt token is intentionally never expressed in YAML; on
  first reconcile a satellite is created with a random token that is
  discarded, and operators must use the Satellites page to retrieve a
  working credential.

  To support that flow:

  - New service methods: `updateSatelliteMetadata`, `rotateSatelliteToken`,
    `getSatelliteByName`.
  - New RPC procs: `updateSatellite`, `rotateSatelliteToken`.
  - New `RotateSatelliteTokenDialog` and a "Reset token" key icon on the
    Satellites list. The dialog reuses the one-time-reveal layout from
    `CreateSatelliteDialog`.
  - The Satellites list shows a `GitOpsSourceBadge` next to managed
    satellites and disables the delete button while leaving the
    token-reset button enabled (so operators can always re-issue a
    credential without touching YAML).

  The satellite kind reconciler adopts pre-existing satellites by name on
  first sync, so this is safe to roll out against installations that
  already have manually-created satellites.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [f6f9a5c]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/satellite-common@0.4.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/healthcheck-backend@1.0.4
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 0.2.21

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

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/healthcheck-backend@1.0.3
  - @checkstack/queue-api@0.2.18
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/satellite-common@0.3.2
  - @checkstack/signal-common@0.2.1

## 0.2.20

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/healthcheck-backend@1.0.2
  - @checkstack/queue-api@0.2.17
  - @checkstack/common@0.7.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/satellite-common@0.3.1
  - @checkstack/signal-common@0.2.0

## 0.2.19

### Patch Changes

- Updated dependencies [2a749d3]
  - @checkstack/healthcheck-backend@1.0.1

## 0.2.18

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/healthcheck-backend@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/satellite-common@0.3.1
  - @checkstack/queue-api@0.2.16

## 0.2.17

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/satellite-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/healthcheck-backend@0.18.1
  - @checkstack/queue-api@0.2.15

## 0.2.16

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/healthcheck-backend@0.18.0
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/satellite-common@0.2.1
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.2.15

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/healthcheck-backend@0.17.1

## 0.2.14

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0

## 0.2.13

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.12

### Patch Changes

- @checkstack/healthcheck-backend@0.16.4

## 0.2.11

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3

## 0.2.10

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2

## 0.2.9

### Patch Changes

- @checkstack/healthcheck-backend@0.16.1

## 0.2.8

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0

## 0.2.7

### Patch Changes

- @checkstack/healthcheck-backend@0.15.1

## 0.2.6

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0

## 0.2.5

### Patch Changes

- @checkstack/healthcheck-backend@0.14.3

## 0.2.4

### Patch Changes

- @checkstack/healthcheck-backend@0.14.2

## 0.2.3

### Patch Changes

- @checkstack/healthcheck-backend@0.14.1

## 0.2.2

### Patch Changes

- Updated dependencies [6c40b5b]
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.1

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/satellite-common@0.2.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/queue-api@0.2.13
