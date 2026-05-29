# @checkstack/frontend

## 0.6.5

### Patch Changes

- @checkstack/dependency-frontend@0.4.6

## 0.6.4

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/announcement-frontend@0.3.5
  - @checkstack/catalog-frontend@0.10.5
  - @checkstack/dependency-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/about-frontend@0.2.21
  - @checkstack/command-frontend@0.2.40
  - @checkstack/signal-common@0.2.4
  - @checkstack/signal-frontend@0.1.4

## 0.6.3

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/catalog-frontend@0.10.4
  - @checkstack/about-frontend@0.2.20
  - @checkstack/announcement-frontend@0.3.4
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/command-frontend@0.2.39
  - @checkstack/dependency-frontend@0.4.4

## 0.6.2

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/about-frontend@0.2.19
  - @checkstack/announcement-frontend@0.3.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/catalog-frontend@0.10.3
  - @checkstack/command-frontend@0.2.38
  - @checkstack/dependency-frontend@0.4.3

## 0.6.1

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/about-frontend@0.2.18
  - @checkstack/announcement-frontend@0.3.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/catalog-frontend@0.10.2
  - @checkstack/command-frontend@0.2.37
  - @checkstack/dependency-frontend@0.4.2

## 0.6.0

### Minor Changes

- 7c97b43: Backfill missing package bumps for the `/rest` mount PR — these packages were
  modified in that change but were not declared in its changeset:

  - `@checkstack/api-docs-frontend`: schema renderer rewrite (`additionalProperties`,
    `$ref` resolution, `oneOf`/`anyOf`/`allOf`, nullable unions, `format`
    qualifiers) and the new path/query/header/cookie parameters table for GET
    endpoints.
  - `@checkstack/frontend`: Vite dev-server proxy for `/rest/*` so external REST
    clients pointing at the Vite port resolve to the backend.
  - `@checkstack/healthcheck-backend`: router handler now unpacks `input.systemId`
    after `getSystemConfigurations` was refactored from `.input(z.string())` to
    `.input(z.object({ systemId: z.string() }))`.

  No behavior change beyond what the original PR already shipped.

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/about-frontend@0.2.17
  - @checkstack/announcement-frontend@0.3.1
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/catalog-frontend@0.10.1
  - @checkstack/command-frontend@0.2.36
  - @checkstack/dependency-frontend@0.4.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/signal-common@0.2.3
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.5.1

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/catalog-frontend@0.10.0
  - @checkstack/dependency-frontend@0.4.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/announcement-frontend@0.3.0
  - @checkstack/about-frontend@0.2.16
  - @checkstack/command-frontend@0.2.35
  - @checkstack/signal-common@0.2.2
  - @checkstack/signal-frontend@0.1.2

## 0.5.0

### Minor Changes

- 50e5f5f: Add `bunx @checkstack/scripts dev` — a local Checkstack dev server for
  plugin authors that runs from the plugin's own repo without a monorepo
  checkout.

  Mechanics:

  - The dev command spawns `core/backend`'s production entry as a child
    process with three env vars wired in:
    - `CHECKSTACK_DEV_PLUGIN_PATH=<cwd>` — backend skips filesystem
      discovery and imports the plugin at this path as a manual plugin.
    - `CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS=<JSON array>` — additional
      backend plugins co-loaded as manual plugins. The dev command walks
      the plugin under dev's `package.json#dependencies` recursively to
      discover every `@checkstack/*-backend` package and pass their
      module paths through. Auto-includes
      `@checkstack/queue-memory-backend` +
      `@checkstack/cache-memory-backend` when no other queue/cache
      provider is in the dep graph, so `coreServices.queueManager` /
      `coreServices.cacheManager` always have a registered strategy on
      boot. Without this co-loading, plugins that depend on
      `healthcheck-backend`, `notification-backend`, etc. would hit
      unregistered services and the boot would deadlock.
    - `CHECKSTACK_DEV_AUTH=true` — backend registers a synthetic
      `AuthService` that auto-grants every registered access rule.
      Refused when `NODE_ENV=production` so accidental misuse is loud.
  - A file watcher under the plugin's `./src` triggers a full backend
    restart (debounced) on save. Bun's startup is sub-second for a single
    plugin, so the loop stays tight.
  - For frontend plugins (or bundle primaries with a `-frontend`
    sibling), the dev command additionally spawns a Vite dev server on
    port 5173 (configurable via `--frontend-port`). Vite serves
    `core/frontend`'s new `dev-main.tsx` shell — the same App.tsx,
    loadPlugins(), ThemeProvider, etc. that ship in production. The
    plugin module is mounted via a `virtual:checkstack-dev-plugin` alias
    Vite resolves at config time. React Fast Refresh works for component
    edits.
  - On boot, the dev command validates the plugin's `package.json`
    against the same `installPackageMetadataSchema` the runtime install
    pipeline uses, so missing required fields fail fast.

  Reuses 100% of the production boot code path — no parallel dev backend
  to drift from. New code surfaces:

  - `core/backend/src/services/dev-auth.ts` — the synthetic auth service.
    Inert unless `CHECKSTACK_DEV_AUTH=true`.
  - `core/scripts/src/commands/dev-server.ts` — the CLI command.
  - `core/scripts/src/commands/dev-deps-resolver.ts` — pure function that
    walks the plugin's deps and resolves the co-load set; covered by 8
    unit tests.
  - `core/scripts/src/commands/dev-frontend.ts` — Vite spawn helper.
  - `core/frontend/src/dev-main.tsx` — frontend dev-shell entry.

  `@checkstack/scripts` now depends on `@checkstack/backend`,
  `@checkstack/frontend`, `@checkstack/frontend-api`, `@checkstack/ui`,
  `vite`, and `@vitejs/plugin-react` so a `bunx` invocation pulls in
  everything needed for the dev server in one shot.

  Replaces the previous "three patterns" plugin-development guide with a
  single `bun run dev` workflow.

  A new ESLint rule branch in `no-extraneous-runtime-deps` ignores
  `virtual:` module specifiers (resolved by bundler aliases at runtime,
  not installed from npm).

  Scaffold templates updated for one-click compatibility — `bun run create`
  now produces plugin packages that pass the dev-server's
  `installPackageMetadataSchema` gate and ship `dev` / `pack` scripts plus
  `@checkstack/scripts` in devDependencies, so a freshly scaffolded plugin
  runs `bun run dev` without any further file edits. Required metadata
  (`description`, `author`, `license: "Elastic-2.0"`, `checkstack.pluginId`)
  is filled in by the scaffold; `@checkstack/scripts plugin-pack
--validate-only` accepts the rendered package.json directly. Templates
  also reformatted from one-line JSON-in-handlebars to readable
  multi-line.

  New scaffold tests in `core/scripts/src/templates.test.ts` render each
  template type and assert: dev-server validation passes, `dev` script
  present (backend/frontend), `pack` script present, `@checkstack/scripts`
  in devDependencies.

  In addition, the new `dev-internals.ts`, `dev-lifecycle.ts`,
  `dev-deps-resolver.ts`, and refactored `dev-frontend.ts` ship 58
  unit tests covering arg parsing, package.json validation, backend
  entry resolution, frontend-spawn decision, child env construction,
  the debounce watcher, the spawn → restart → shutdown lifecycle (with
  hard-kill SIGKILL fallback), the dev-auth service, and the bundle
  sibling resolver — all driven through injectable seams so no real
  process / Postgres / Vite is needed at test time.

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

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/about-frontend@0.2.15
  - @checkstack/catalog-frontend@0.9.1
  - @checkstack/common@0.8.0
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/announcement-frontend@0.2.16
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/command-frontend@0.2.34
  - @checkstack/dependency-frontend@0.3.5
  - @checkstack/frontend-api@0.4.2
  - @checkstack/signal-common@0.2.1

## 0.4.2

### Patch Changes

- e7f346c: fix: suggest a `BASE_URL` value derived from the URL the user actually opened on the misconfiguration error screen, instead of always recommending `http://localhost:3000`. Makes the diagnostic actionable when the app is reached over a LAN IP, custom port, or proxied domain.
  - @checkstack/about-frontend@0.2.14
  - @checkstack/announcement-frontend@0.2.15
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/catalog-frontend@0.9.0
  - @checkstack/command-frontend@0.2.33
  - @checkstack/common@0.7.0
  - @checkstack/dependency-frontend@0.3.4
  - @checkstack/frontend-api@0.4.1
  - @checkstack/signal-common@0.2.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/ui@1.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/catalog-frontend@0.9.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0
  - @checkstack/command-frontend@0.2.33
  - @checkstack/dependency-frontend@0.3.4
  - @checkstack/about-frontend@0.2.14
  - @checkstack/announcement-frontend@0.2.15

## 0.4.0

### Minor Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/announcement-frontend@0.2.14
  - @checkstack/dependency-frontend@0.3.3
  - @checkstack/about-frontend@0.2.13
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/catalog-frontend@0.8.7
  - @checkstack/command-frontend@0.2.32
  - @checkstack/ui@1.6.1

## 0.3.24

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/dependency-frontend@0.3.2
  - @checkstack/about-frontend@0.2.12
  - @checkstack/announcement-frontend@0.2.13
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/catalog-frontend@0.8.6
  - @checkstack/command-frontend@0.2.31
  - @checkstack/frontend-api@0.3.11
  - @checkstack/signal-common@0.1.10
  - @checkstack/signal-frontend@0.0.16

## 0.3.23

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1
  - @checkstack/about-frontend@0.2.11
  - @checkstack/announcement-frontend@0.2.12
  - @checkstack/auth-frontend@0.5.29
  - @checkstack/catalog-frontend@0.8.5
  - @checkstack/command-frontend@0.2.30
  - @checkstack/dependency-frontend@0.3.1

## 0.3.22

### Patch Changes

- Updated dependencies [35463ef]
  - @checkstack/dependency-frontend@0.3.0

## 0.3.21

### Patch Changes

- @checkstack/catalog-frontend@0.8.4
- @checkstack/dependency-frontend@0.2.18

## 0.3.20

### Patch Changes

- @checkstack/catalog-frontend@0.8.3
- @checkstack/dependency-frontend@0.2.17

## 0.3.19

### Patch Changes

- Updated dependencies [a7b7081]
  - @checkstack/dependency-frontend@0.2.16
  - @checkstack/auth-frontend@0.5.28
  - @checkstack/catalog-frontend@0.8.2
  - @checkstack/announcement-frontend@0.2.11

## 0.3.18

### Patch Changes

- fdc9b2d: Fix vendor build output conflicting with Vite's publicDir

  The vendor build was outputting to `public/vendor/` which is inside Vite's `publicDir` (`public/`). This caused Vite to skip copying public directory contents (including `favicon.svg`) to the `dist/` folder during production builds, resulting in missing static assets in the Docker container.

  - Move vendor build output from `public/vendor/` to `dist/vendor/`
  - Set `emptyOutDir: false` on the main build to preserve the pre-built vendor bundles

## 0.3.17

### Patch Changes

- 3da7582: Fix favicon not loading in production container and add NotFound page

  - **Backend**: Fix static file serving so root-level files like `/favicon.svg` are served from the dist directory before the SPA fallback catches them
  - **UI**: Add `NotFound` component with stacked-checkmark logo, physics-inspired falling "4" animation, and low-power device fallback
  - **Frontend**: Add catch-all `*` route to display the NotFound page for unmatched routes, and add the Checkstack logo to the navbar
  - **Favicon**: Redesign with stacked checkmarks in the brand purple/indigo palette

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/about-frontend@0.2.10
  - @checkstack/announcement-frontend@0.2.10
  - @checkstack/auth-frontend@0.5.27
  - @checkstack/catalog-frontend@0.8.1
  - @checkstack/command-frontend@0.2.29
  - @checkstack/dependency-frontend@0.2.15

## 0.3.16

### Patch Changes

- f8c8625: Added SVG favicon to frontend application

## 0.3.15

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/catalog-frontend@0.8.0
  - @checkstack/dependency-frontend@0.2.14

## 0.3.14

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-frontend@0.7.0
  - @checkstack/dependency-frontend@0.2.13
  - @checkstack/about-frontend@0.2.9
  - @checkstack/announcement-frontend@0.2.9
  - @checkstack/auth-frontend@0.5.26
  - @checkstack/command-frontend@0.2.28

## 0.3.13

### Patch Changes

- @checkstack/catalog-frontend@0.6.2
- @checkstack/dependency-frontend@0.2.12

## 0.3.12

### Patch Changes

- @checkstack/catalog-frontend@0.6.1
- @checkstack/dependency-frontend@0.2.11

## 0.3.11

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [4b0934d]
  - @checkstack/catalog-frontend@0.6.0
  - @checkstack/ui@1.3.6
  - @checkstack/about-frontend@0.2.8
  - @checkstack/announcement-frontend@0.2.8
  - @checkstack/auth-frontend@0.5.25
  - @checkstack/command-frontend@0.2.27
  - @checkstack/dependency-frontend@0.2.10

## 0.3.10

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/about-frontend@0.2.7
  - @checkstack/announcement-frontend@0.2.7
  - @checkstack/auth-frontend@0.5.24
  - @checkstack/catalog-frontend@0.5.14
  - @checkstack/command-frontend@0.2.26
  - @checkstack/dependency-frontend@0.2.9

## 0.3.9

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/about-frontend@0.2.6
  - @checkstack/announcement-frontend@0.2.6
  - @checkstack/auth-frontend@0.5.23
  - @checkstack/catalog-frontend@0.5.13
  - @checkstack/command-frontend@0.2.25
  - @checkstack/dependency-frontend@0.2.8

## 0.3.8

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/about-frontend@0.2.5
  - @checkstack/announcement-frontend@0.2.5
  - @checkstack/auth-frontend@0.5.22
  - @checkstack/catalog-frontend@0.5.12
  - @checkstack/command-frontend@0.2.24
  - @checkstack/dependency-frontend@0.2.7

## 0.3.7

### Patch Changes

- 0388000: Implemented a global performance-aware UI infrastructure that detects hardware capabilities (using heuristics and frame-budget benchmarks) to automatically disable expensive CSS animations, backdrop-blurs, and glassmorphism effects on low-power or non-hardware-accelerated devices.
- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/command-frontend@0.2.23
  - @checkstack/about-frontend@0.2.4
  - @checkstack/announcement-frontend@0.2.4
  - @checkstack/auth-frontend@0.5.21
  - @checkstack/catalog-frontend@0.5.11
  - @checkstack/dependency-frontend@0.2.6

## 0.3.6

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/about-frontend@0.2.3
  - @checkstack/announcement-frontend@0.2.3
  - @checkstack/auth-frontend@0.5.20
  - @checkstack/catalog-frontend@0.5.10
  - @checkstack/command-frontend@0.2.22
  - @checkstack/dependency-frontend@0.2.5

## 0.3.5

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/about-frontend@0.2.2
  - @checkstack/announcement-frontend@0.2.2
  - @checkstack/auth-frontend@0.5.19
  - @checkstack/catalog-frontend@0.5.9
  - @checkstack/command-frontend@0.2.21
  - @checkstack/dependency-frontend@0.2.4

## 0.3.4

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/about-frontend@0.2.1
  - @checkstack/announcement-frontend@0.2.1
  - @checkstack/catalog-frontend@0.5.8
  - @checkstack/dependency-frontend@0.2.3
  - @checkstack/frontend-api@0.3.9
  - @checkstack/command-frontend@0.2.20
  - @checkstack/signal-common@0.1.9
  - @checkstack/signal-frontend@0.0.15

## 0.3.3

### Patch Changes

- Updated dependencies [c0935d8]
  - @checkstack/dependency-frontend@0.2.2
  - @checkstack/about-frontend@0.2.0
  - @checkstack/announcement-frontend@0.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/catalog-frontend@0.5.7
  - @checkstack/command-frontend@0.2.19
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/signal-common@0.1.8
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.2.0

## 0.3.2

### Patch Changes

- @checkstack/dependency-frontend@0.2.1

## 0.3.1

### Patch Changes

- 3f36a64: Add System Dependencies plugin

  Introduces the system dependencies feature with three new core plugins and
  extends the catalog with a new SystemEditorSlot extension point.

  **New plugins:**

  - **dependency-common**: Shared Zod schemas, RPC contract with resource-level access control, signal definitions, and routes
  - **dependency-backend**: Drizzle schema, DependencyService with cycle detection, WarningEvaluationService with transitive impact matrix, RPC router with signal broadcasting, and per-user canvas node position persistence
  - **dependency-frontend**: DependencyBadge (dashboard), DependencyAlert (system details), DependencyEditor (system editor dialog), and interactive DependencyMapPage (React Flow canvas)

  **Catalog extensions:**

  - **catalog-common**: New `SystemEditorSlot` for plugin-injected sections in the system editor dialog
  - **catalog-frontend**: `SystemEditor` renders the slot after TeamAccessEditor for existing systems

  **Key capabilities:**

  - Directional dependency edges between systems (source depends on target)
  - Three impact types: informational, degraded, critical
  - Transitive multi-hop warning propagation with toggle switch
  - Cycle detection at creation time with graphical chain visualization
  - Health check-level dependency rules
  - Interactive dependency map with drag-to-connect, edge click editor, and auto-saving node positions
  - Inline editing of dependencies in both the system editor and the map canvas
  - Team-based resource-level access control on all mutation endpoints
  - Realtime signal-driven UI updates

- Updated dependencies [3f36a64]
  - @checkstack/dependency-frontend@0.2.0
  - @checkstack/catalog-frontend@0.5.7

## 0.3.0

### Minor Changes

- 3589199: Add About page with platform information, license, contact details, and version information

  - New `about-common` package with plugin metadata
  - New `about-frontend` package with the About page and user menu item
  - New `/api/about` backend endpoint exposing core version and loaded plugin versions
  - Accessible via "About Checkstack" in the user menu dropdown

### Patch Changes

- dee86ec: feat: add portal announcement system

  Introduces a complete announcement system for communicating with portal users:

  - **announcement-common**: Zod schemas for announcements (severity, visibility, display mode), oRPC contract with 6 procedures (public retrieval, user dismissal, admin CRUD), access rules, and `ANNOUNCEMENT_UPDATED` signal definition
  - **announcement-backend**: Drizzle schema with `announcements` and `announcement_dismissals` tables, router with temporal filtering, visibility control, per-user dismissal persistence, user cleanup hook, real-time signal broadcasting on create/update/delete, and command palette registration ("Create Announcement", "Manage Announcements" with `⇧⌘A` shortcut)
  - **announcement-frontend**: Admin management page with create/edit dialog, global banner component above the navbar (severity-colored, expandable markdown), dashboard cards with compact expand/collapse, admin menu link, and real-time WebSocket signal subscription for instant UI updates
  - **frontend**: Integrates AnnouncementBanner into App.tsx for global visibility

- Updated dependencies [3589199]
- Updated dependencies [dee86ec]
  - @checkstack/about-frontend@0.2.0
  - @checkstack/announcement-frontend@0.2.0

## 0.2.22

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/catalog-frontend@0.5.6
  - @checkstack/command-frontend@0.2.19

## 0.2.21

### Patch Changes

- e01945b: Reduce excessive /api/auth/get-session requests

  - Enable better-auth's `cookieCache` on the server (5-minute TTL) so repeated session
    checks verify a signed cookie instead of querying the database. Compatible with
    horizontal scaling since validation uses the shared `BETTER_AUTH_SECRET`.

  - Introduce a `SessionProvider` React context that fetches the session exactly once
    at the top of the component tree. All 7+ components that previously called
    `useSession()` independently now read from this shared context — eliminating
    duplicate HTTP requests on every page load.

  - Remove the `useAuthClient()` hook which created per-component better-auth client
    instances via `useMemo`, causing separate nanostore atoms and independent fetches.
    All imperative usages (signIn, signUp, resetPassword, etc.) now use the singleton
    `getAuthClientLazy()` instead.

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16
  - @checkstack/catalog-frontend@0.5.5

## 0.2.20

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15
  - @checkstack/catalog-frontend@0.5.4
  - @checkstack/command-frontend@0.2.18

## 0.2.19

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-frontend@0.5.3
  - @checkstack/command-frontend@0.2.17

## 0.2.18

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-frontend@0.5.2
  - @checkstack/command-frontend@0.2.16
  - @checkstack/common@0.6.4
  - @checkstack/frontend-api@0.3.8
  - @checkstack/signal-common@0.1.8
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3

## 0.2.17

### Patch Changes

- 0603d39: Fix onboarding flow not appearing on fresh Docker deployments (issue #79)

  The `.env.example` had `BASE_URL` defaulting to `http://localhost:5173`
  (the Vite dev server port). Users copying this file verbatim for a Docker
  deployment would get a frontend that silently made all API calls to the
  wrong origin, causing empty state and extreme sluggishness.

  **Changes:**

  - `.env.example`: Adds clear comments explaining the value must match the
    container's exposed port.
  - `frontend-api` (`RuntimeConfigProvider`): Removes the silent fallback when
    `/api/config` returns an unreachable baseUrl — instead propagates the error
    so it can be surfaced.
  - `frontend` (`App.tsx`): Renders an actionable error screen when the backend
    config cannot be loaded, showing the exact `BASE_URL` fix and the
    `docker compose` command to recover.
  - `docs/getting-started/docker.md`: Adds a dedicated troubleshooting section
    for this exact misconfiguration.

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-frontend@0.5.1
  - @checkstack/command-frontend@0.2.15
  - @checkstack/ui@1.1.2

## 0.2.16

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/catalog-frontend@0.5.0
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/command-frontend@0.2.14
  - @checkstack/frontend-api@0.3.6
  - @checkstack/signal-common@0.1.7
  - @checkstack/signal-frontend@0.0.13

## 0.2.15

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10
  - @checkstack/catalog-frontend@0.4.2
  - @checkstack/command-frontend@0.2.13

## 0.2.14

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/catalog-frontend@0.4.1
  - @checkstack/command-frontend@0.2.12
  - @checkstack/frontend-api@0.3.5
  - @checkstack/signal-common@0.1.6
  - @checkstack/signal-frontend@0.0.12

## 0.2.13

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-frontend@0.4.0
  - @checkstack/ui@0.5.3
  - @checkstack/auth-frontend@0.5.8
  - @checkstack/command-frontend@0.2.11

## 0.2.12

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-frontend@0.3.11
  - @checkstack/command-frontend@0.2.10
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/signal-common@0.1.5
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.2.11

### Patch Changes

- deec10c: Fix production crash when opening health check accordion and enable sourcemaps

  - Fixed TypeError in `HealthCheckLatencyChart` where recharts Tooltip content function was returning `undefined` instead of `null`, causing "can't access property 'value', o is undefined" error
  - Enabled production sourcemaps in Vite config for better debugging of production errors

## 0.2.10

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1
  - @checkstack/auth-frontend@0.5.6
  - @checkstack/catalog-frontend@0.3.10
  - @checkstack/command-frontend@0.2.9

## 0.2.9

### Patch Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

- Updated dependencies [223081d]
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/catalog-frontend@0.3.9
  - @checkstack/command-frontend@0.2.8

## 0.2.8

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-frontend@0.3.8
  - @checkstack/command-frontend@0.2.7
  - @checkstack/frontend-api@0.3.3
  - @checkstack/signal-common@0.1.4
  - @checkstack/signal-frontend@0.0.10

## 0.2.7

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3
  - @checkstack/catalog-frontend@0.3.7
  - @checkstack/command-frontend@0.2.6

## 0.2.6

### Patch Changes

- 8a87cd4: Fixed query retry behavior for 401/403 errors

  API calls that return 401 (Unauthorized) or 403 (Forbidden) errors are no longer retried, as these are definitive auth responses that won't succeed on retry. This prevents unnecessary loading states and network requests.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/catalog-frontend@0.3.6
  - @checkstack/command-frontend@0.2.5
  - @checkstack/frontend-api@0.3.2
  - @checkstack/signal-common@0.1.3
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/catalog-frontend@0.3.5
  - @checkstack/command-frontend@0.2.4
  - @checkstack/frontend-api@0.3.1
  - @checkstack/signal-common@0.1.2
  - @checkstack/signal-frontend@0.0.8

## 0.2.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/catalog-frontend@0.3.4
  - @checkstack/command-frontend@0.2.3

## 0.2.3

### Patch Changes

- f6464a2: Fix theme toggle showing incorrect state when system theme is used

  - Added `resolvedTheme` property to `ThemeProvider` that returns the actual computed theme ("light" or "dark"), resolving "system" to the user's OS preference
  - Updated `NavbarThemeToggle` and `ThemeToggleMenuItem` to use `resolvedTheme` instead of `theme` for determining toggle state
  - Changed default theme from "light" to "system" so non-logged-in users respect their OS color scheme preference

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/catalog-frontend@0.3.3
  - @checkstack/command-frontend@0.2.2

## 0.2.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/catalog-frontend@0.3.2

## 0.2.1

### Patch Changes

- 4eed42d: Fix "No QueryClient set" error in containerized builds

  **Problem**: The containerized application was throwing "No QueryClient set, use QueryClientProvider to set one" errors during plugin registration. This didn't happen in dev mode.

  **Root Cause**: The `@tanstack/react-query` package was being bundled separately in different workspace packages, causing multiple React Query contexts. The `QueryClientProvider` from the main app wasn't visible to plugin code due to this module duplication.

  **Changes**:

  - `@checkstack/frontend-api`: Export `useQueryClient` from the centralized React Query import, ensuring all packages use the same context
  - `@checkstack/dashboard-frontend`: Import `useQueryClient` from `@checkstack/frontend-api` instead of directly from `@tanstack/react-query`, and remove the direct dependency
  - `@checkstack/frontend`: Add `@tanstack/react-query` to Vite's `resolve.dedupe` as a safety net

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-frontend@0.3.1
  - @checkstack/command-frontend@0.2.1
  - @checkstack/ui@0.2.2

## 0.2.0

### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-frontend@0.3.0
  - @checkstack/command-frontend@0.2.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-common@0.1.1
  - @checkstack/signal-frontend@0.0.7

## 0.1.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-frontend@0.2.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/command-frontend@0.0.5
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/signal-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-frontend@0.0.4
  - @checkstack/command-frontend@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/signal-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/signal-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.4

### Patch Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/signal-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1
  - @checkstack/catalog-frontend@0.0.5

## 0.1.2

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-frontend@0.0.4

## 0.1.1

### Patch Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3
  - @checkstack/ui@0.1.1

## 0.1.0

### Minor Changes

- b55fae6: Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

  ## New Packages

  - **@checkstack/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
  - **@checkstack/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
  - **@checkstack/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

  ## Changes

  - **@checkstack/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
  - **@checkstack/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

  ## Usage

  Backend plugins can emit signals:

  ```typescript
  import { coreServices } from "@checkstack/backend-api";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  const signalService = context.signalService;
  await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
  ```

  Frontend components subscribe to signals:

  ```tsx
  import { useSignal } from "@checkstack/signal-frontend";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  useSignal(NOTIFICATION_RECEIVED, (payload) => {
    // Handle realtime notification
  });
  ```

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/frontend-api@0.0.2
