# @checkstack/backend

## 0.10.0

### Minor Changes

- 9016526: Add a `/rest/:pluginId/*` HTTP mount that serves every plugin's oRPC contract
  through the REST/OpenAPI shape described by `/api/openapi.json`. Queries are
  `GET` with query parameters, mutations are `POST` with the input as the raw
  JSON body. The existing `/api/:pluginId/*` mount continues to serve oRPC's
  native wire protocol unchanged, so existing clients are not affected.

  The OpenAPI spec at `/api/openapi.json` now reflects the real mount: every
  `paths` entry is prefixed with `/rest` instead of `/api`.

  Also fixes a SPA-fallback bug: the backend's `/api-docs` route previously
  returned 404 on production deployments because the static-file middleware
  skipped any path starting with `/api`, capturing `/api-docs` along with real
  API routes. The skip now requires a trailing slash (`/api/`, `/rest/`).

  Required access rules are now visible in the API Docs UI. The OpenAPI spec
  generator was reading a non-existent `accessRules` field on procedure
  metadata; the real field is `access: AccessRule[]`. Each procedure's access
  rules are now flattened to fully-qualified IDs (e.g. `catalog.system.read`)
  and emitted under `x-orpc-meta.accessRules`, which the existing
  `Required Access Rules` section in the docs UI already knew how to render.

  The API Docs schema renderer now handles record types (zod `z.record`),
  `$ref`s into `components.schemas`, `oneOf`/`anyOf`/`allOf`, nullable union
  types (`type: ["string", "null"]`), and `format` qualifiers. Previously
  record outputs like `{ statuses: object }` masked the actual value type;
  they now render as `{ [key]: <ResolvedType> { ... } }` with the inner
  schema expanded, capped at 12 levels with cycle detection.

  **REST method conventions.** `proc()` now defaults to `GET` for queries and
  `POST` for mutations on the `/rest` mount, using bracket-notation query
  params (`?filter[status]=active&ids[0]=a`) for GET inputs. Existing
  procedures were updated to follow REST semantics:

  - `update*` mutations → `PATCH`
  - `delete*` / `remove*` mutations → `DELETE`
  - `getBulk*` queries and any query taking a large array input → `POST`
    (because `@orpc/openapi@1.13.x` has no GET→POST URL-length fallback)

  GET endpoints require an `object` input — bare scalars like
  `.input(z.string())` are not valid on GET. `getSystemConfigurations` was
  refactored from `.input(z.string())` to `.input(z.object({ systemId: ... }))`
  to fit the GET shape; the only call-site update was the in-process router
  unpacking `input.systemId` instead of passing `input` directly.

  The API Docs UI now renders query parameters (path/query/header/cookie) in a
  dedicated table for GET endpoints, and the fetch example shows them in the
  URL with `<required>` / `<optional>` placeholders.

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/auth-common@0.7.0
  - @checkstack/api-docs-common@0.1.13
  - @checkstack/backend-api@0.15.2
  - @checkstack/pluginmanager-common@0.2.2
  - @checkstack/signal-backend@0.2.5
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1

## 0.9.1

### Patch Changes

- aa89bc5: Replace the bespoke `registerInfrastructureTab()` registry with a standard
  slot-extension contract (`InfrastructureTabsSlot` from
  `@checkstack/infrastructure-common`). Plugins now contribute infrastructure
  tabs via `createSlotExtension`, depending only on the slot owner.

  The slot system in `@checkstack/frontend-api` gains a second type parameter
  on `createSlot<TContext, TMetadata>` so extensions can declare typed static
  metadata at registration time (label, icon, access rules, ordering for the
  infrastructure tab bar). A new `useSlotExtensions(slot)` hook returns typed
  extensions and subscribes to plugin lifecycle changes.

  Each tab body now stacks a **Runtime** sub-section (live state, read-only)
  on top of a **Configuration** sub-section (settings, gated by `canUpdate`).

  **Queue runtime panel.** Surfaces aggregated counts (pending / processing /
  completed / failed) plus three sub-tabs of recent jobs: **Active**, **Recent
  failed** (with the failure message), and **Recent completed** (with
  duration). Job payloads are deliberately not surfaced — they may carry
  secrets and need a separate manage-access gate to be shown.

  To support this, `Queue<T>` gains a required `listJobs(opts)` method
  returning `JobSummary[]` (no payloads), and `QueueStats` gains a
  `scope: "instance" | "cluster"` field. The in-memory queue keeps rolling
  ring buffers (200 entries) for completed/failed history and tracks active
  jobs by id; BullMQ uses native `getJobs`. `QueueManager.listJobs` aggregates
  across queues and sorts (most-recent-first for terminal states, FIFO for
  active/waiting/delayed).

  **Cache runtime panel.** Lists the top N entries by size (or by recency) so
  operators can debug a cache filling up. Values are deliberately omitted —
  PII / secret risk. Backends opt in via an optional `listEntries?` method on
  `CacheProvider`; non-supporting backends return `{ supported: false }` and
  the UI renders a "not supported by this backend" hint. The in-memory cache
  implements it using its existing per-entry byte tracking.

  `CacheStats` also gains `scope: "instance" | "cluster"`.

  **Multi-instance scope warning.** A new `<InstanceScopeBanner>` component in
  `@checkstack/ui` renders a yellow banner above any runtime panel whose
  backend reports `scope: "instance"` — i.e. in-memory queue or cache running
  in a horizontally scaled deployment. The banner explains the metrics are
  local to the responding replica and recommends switching to a clustered
  backend (Redis-backed queue / cache) for cluster-wide visibility.

  **Bug fix — stable cache provider proxy.** `CacheManagerImpl.getProvider()`
  now returns a single stable proxy that delegates to whatever provider is
  currently active. Previously, consumers of `createCachedScope` (and any
  direct `cacheManager.getProvider()` caller) captured the active provider
  reference at plugin-init time. After any `setActiveBackend` call — including
  saving the same memory config in the new Cache tab, which reconstructs the
  in-memory cache — those scopes wrote to an orphaned old provider while the
  runtime panel read stats from the new (empty) one, making the runtime panel
  appear to report 0 keys. With the proxy, all consumers share a single stable
  identity and writes always land in the active provider.

  **Bytes tracking on the in-memory cache.** `InMemoryCache.getStats().sizeBytes`
  now returns a running approximation (UTF-8 bytes of the key plus
  `v8.serialize(value).byteLength`, with a JSON fallback) that's kept in sync
  across all eviction paths. Treat the number as a sanity gauge; it doesn't
  include `Map` per-entry overhead.

  **Pagination.** Both `Queue<T>.listJobs` and `CacheProvider.listEntries?`
  are offset-paginated. Inputs gain an `offset: number`; outputs change to
  `{ items, total: number | null, hasMore: boolean }`. `total` is nullable
  so backends that can't compute it cheaply still paginate via `hasMore`.
  The UI uses the existing `<Pagination>` component with a 25-row default
  page size. `QueueManager.listJobs` aggregates by over-fetching
  `[0, offset+limit)` per queue, merge-sorting, then slicing the window —
  optimal for the single-queue case, acceptable for the multi-queue case
  within the UI's reasonable page-depth bounds. BullMQ uses native offset
  ranges via `getJobs(types, start, end)` plus `getJobCounts` for `total`.

  **Pending tab.** The Queue runtime panel exposes a virtual `"pending"`
  state (waiting ∪ delayed, FIFO). It's now the default sub-tab, since
  "what's queued up?" is the most common question. Per-row state is shown
  when viewing the combined list.

  **Recurring schedules visible under Pending.** Cron- and interval-based
  recurring jobs (e.g. healthchecks) are surfaced under Pending/Delayed
  between fires, with a `nextRunAt` countdown column and a "(recurring)"
  label. `JobSummary` gains optional `nextRunAt: Date` and `recurring:
boolean` fields. The in-memory queue synthesises these rows from its
  `recurringJobs` registry; BullMQ already materialises the next fire of
  each scheduler as a delayed job and we now surface its trigger time and
  the `repeatJobKey`-derived `recurring` flag.

  **Bug fix — drop hook emits with no listeners.** `EventBus.emit` no
  longer enqueues a job when zero listeners (distributed or instance-local)
  are registered for the hook. Previously, hooks like
  `core.plugin.initialized` — emitted on every plugin init but subscribed
  to by nothing in the core repo — accumulated one waiting job per emit
  forever. The in-memory queue's `processNext` short-circuits when there
  are zero consumer groups, so its post-loop cleanup never ran for these
  orphaned jobs. The fix drops the emit at the source and logs a debug
  line. Note: in distributed deployments using a Redis-backed queue, this
  means a subscriber on another replica won't receive an event if no
  replica that emits it has a local listener. Plugins needing cross-process
  delivery must register their listener on every replica that should
  receive the hook.

  **Breaking notes (treated as minor under beta semantics)**:

  - `@checkstack/infrastructure-common` removes `registerInfrastructureTab`
    and `getInfrastructureTabs`; former callers must register an extension
    into `InfrastructureTabsSlot`.
  - `@checkstack/queue-api`'s `Queue<T>` interface requires the new
    `listJobs(opts)` method returning `ListJobsResult` (paginated). Both
    bundled queue backends (memory, BullMQ) are updated; out-of-tree
    implementations will need to add it.
  - `QueueStats` and `CacheStats` add a required `scope` field.
  - `CacheProvider.listEntries?` (when implemented) now returns
    `ListEntriesResult` instead of `CacheEntrySummary[]`.
  - `JobState` adds a `"pending"` variant.

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/api-docs-common@0.1.12
  - @checkstack/auth-common@0.6.6
  - @checkstack/backend-api@0.15.1
  - @checkstack/pluginmanager-common@0.2.1
  - @checkstack/signal-backend@0.2.4
  - @checkstack/signal-common@0.2.2

## 0.9.0

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
  - @checkstack/auth-common@0.6.5
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/drizzle-helper@0.0.5
  - @checkstack/pluginmanager-common@0.2.0
  - @checkstack/queue-api@0.2.18
  - @checkstack/signal-backend@0.2.3
  - @checkstack/api-docs-common@0.1.11
  - @checkstack/cache-api@0.2.4
  - @checkstack/signal-common@0.2.1

## 0.8.2

### Patch Changes

- 302cd3f: fix: resilient startup routing + /health and /ready endpoints

  Three fixes that together eliminate startup-race errors during boot and
  hot-reload, plus a new readiness API for plugins.

  1. **TrieRouter swap (root cause).** Hono's default `SmartRouter` freezes
     its matcher on the first request — any later `app.add()` throws
     `MESSAGE_MATCHER_IS_ALREADY_BUILT`. Plugins register routes during
     `init()` (and at runtime via `loadSinglePlugin`), so an early request
     during boot would silently lock the matcher with only the module-load
     routes, and every later route registration would fail. The backend
     now uses `TrieRouter`, which is incremental — routes can be added at
     any time, including after thousands of requests have been served.
     This also future-proofs runtime plugin install.

  2. **Init gating + fail-loud.** Non-bypass requests now `await` an
     `initPromise` (with a 30s timeout that returns 503 + Retry-After) so
     no traffic reaches Hono before plugins finish registering routes.
     Init failures crash the process via `process.exit(1)` so docker/k8s
     restart cleanly instead of silently serving a half-initialized
     backend.

  3. **`/assets/*` fall-through.** The production frontend asset handler
     now calls `next()` instead of `c.notFound()` on miss, so
     plugin-asset routes registered later (`/assets/plugins/:pluginName/*`)
     actually get a chance to match.

  ### New: platform endpoints under `/.checkstack/*`

  - `GET /.checkstack/health` — liveness, always 200 once the process is up.
  - `GET /.checkstack/ready` — readiness, 503 until init completes and all
    critical probes pass; 200 otherwise. Returns `{ ready, checks: [...] }`
    with per-probe status, message/error and duration.

  The leading `.checkstack/` prefix namespaces platform-level endpoints
  away from plugin `/api/*`, runtime frontend assets, and the SPA wildcard,
  leaving room for additional operator endpoints in the future.

  ### New: plugin readiness API

  Plugins can contribute readiness probes via the new
  `coreServices.readinessRegistry` service:

  ```ts
  registerInit({
    deps: { readiness: coreServices.readinessRegistry },
    async init({ readiness }) {
      readiness.register({
        name: "queue.connected",
        critical: true,
        check: async () => ({
          ok: pool.isConnected(),
          message: pool.isConnected() ? undefined : "queue pool not connected",
        }),
      });
    },
  });
  ```

  Probes run in parallel, throwing probes are reported as `ok: false`,
  and non-critical probes don't block readiness.

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/queue-api@0.2.17
  - @checkstack/signal-backend@0.2.2
  - @checkstack/api-docs-common@0.1.10
  - @checkstack/auth-common@0.6.4
  - @checkstack/common@0.7.0
  - @checkstack/drizzle-helper@0.0.4
  - @checkstack/signal-common@0.2.0

## 0.8.1

### Patch Changes

- 2a749d3: fix: run afterPluginsReady in topological order; merge daily rollups on conflict

  Two resilience fixes for the dependency chain:

  1. **Plugin loader**: Phase 3 (`afterPluginsReady`) now iterates plugins
     in the same topologically-sorted order as Phase 2 (`init`). Previously
     it iterated `pendingInits` in registration order, which raced
     subscription-spec dependencies — catalog's afterPluginsReady registers
     `catalog.system` and `catalog.group` notification targets, and emitting
     plugins (incident, maintenance, …) call `registerSubscriptionSpec`
     against those targets in their own afterPluginsReady. With registration
     order, an emitter could run before catalog and hit
     `Target type catalog.group is not registered`. Sorted order encodes
     the dependency via `spec.target.ownerPlugin`, so the emitter now
     always runs after the target owner.

  2. **Healthcheck retention job**: the daily rollup now upserts
     `health_check_aggregates` with `ON CONFLICT DO UPDATE` instead of a
     plain insert. Previously, late-arriving hourly aggregates (e.g. from
     a satellite that was offline when the prior rollup ran) would crash
     the rollup with a unique-constraint violation on
     `(configuration_id, system_id, bucket_start, bucket_size, source_id)`.
     The merge sums counts and folds min/max/p95 into the existing daily
     row.

## 0.8.0

### Minor Changes

- 32d52c6: feat: notification target pattern + per-spec subscriptions

  Replaces the all-or-nothing catalog system/group notification model with a
  platform-level target pattern. Each notification-emitting plugin declares
  _subscription specs_ against typed _target_ objects exported from the
  target's owning plugin (catalog ships `catalogSystemTarget` and
  `catalogGroupTarget`). Notification-backend handles every per-resource
  group lifecycle, parent-edge inheritance, and legacy-subscription seeding
  — plugins never author groupId helpers, lifecycle hooks, or migration
  code again.

  **Plugin-author surface area is now ~12 lines per emitter:**

  ```ts
  // <plugin>-common
  const { defineSubscription } = createSubscriptionFactory(pluginMetadata);
  export const fooSystemSubscription = defineSubscription({
    localId: "system",
    target: catalogSystemTarget,
    display: { title: "Foo Alerts", description: "...", iconName: "Bell" },
  });

  // <plugin>-backend register()
  env.registerSubscriptionSpecs([fooSystemSubscription]);
  //   ^ feeds the plugin loader's dependency sorter — each spec's
  //     target.ownerPlugin becomes an implicit init-order dep, so this
  //     plugin automatically waits for catalog (the target owner) to
  //     finish init + afterPluginsReady before its own runs.

  // <plugin>-backend afterPluginsReady
  await notificationClient.registerSubscriptionSpec(
    specToRegistration(fooSystemSubscription)
  );
  // dispatch
  await notificationClient.notifyForSubscription({
    specId: fooSystemSubscription.specId,
    resourceKeys: [systemId],
    title,
    body,
    importance,
    action,
    collapseKey,
    subjects,
  });

  // <plugin>-frontend
  createNotificationSubscriptionExtension({ spec: fooSystemSubscription });
  ```

  **Migrated plugins**: anomaly, incident, maintenance, healthcheck,
  dependency. Each lost its bespoke `notification-groups.ts`,
  `bootstrap*NotificationGroups`, `ensure*Group`, and inheritance walk —
  all of that is now centralized in notification-backend's
  `subscription-engine`.

  **Plugin loader change** (`@checkstack/backend-api`,
  `@checkstack/backend`): the register-time API gains
  `env.registerSubscriptionSpecs([...specs])`. The dependency sorter
  walks `spec.target.ownerPlugin` for every declared spec and adds the
  target owner as an init-order dependency of the emitting plugin. This
  guarantees that catalog (the owner of the platform's `system` and
  `group` targets) completes init + afterPluginsReady before any
  emitting plugin tries to register its specs against the notification
  service — no string-prefix heuristics, no manual `dependsOnPlugins`
  list, no stub rows. Plugins that fail to declare their specs at
  register time get a clear `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
  error from the dispatcher.

  **Removed** (no backwards compat):

  - `catalogClient.notifySystemSubscribers` and
    `catalogClient.notifyManySystemSubscribers`
  - `notificationClient.notifyUsers` and `notificationClient.notifyGroups`
    as direct dispatch primitives — replaced by spec-bound
    `notifyForSubscription`
  - catalog's `bootstrapNotificationGroups` (replaced by
    `bootstrapNotificationTargets`)

  **Enforcement**: the dispatcher rejects calls referencing unregistered
  specIds, specs owned by other plugins, or resourceKeys that haven't been
  pushed via `upsertNotificationResource`. Display metadata for any
  groupId is recoverable via the spec registry, so audit lists render
  correct labels even when an emitter's frontend isn't loaded.

  **Per-field anomaly mute** keeps working — it now lives inside the
  generic SubscriptionRow's optional `SubControls` panel
  (`AnomalyFieldMuteList`), exposed through the catalog system detail
  page's notifications card.

  The catalog system detail page renders a "Notifications" card hosting
  `SystemNotificationSubscriptionsSlot`. The matching group surface is
  not yet rendered — group-level subscriptions are wired end-to-end on
  the backend; a follow-up will add the host UI.

  **Migration of existing subscribers**: target types declare a
  `legacyGroupIdTemplate`; on first registration of each spec,
  notification-backend reads subscribers from the legacy
  `catalog.system.<id>` / `catalog.group.<id>` groups and seeds the new
  spec groups exactly once per (spec × resource) pair, tracked in
  `subscription_migrations`. Anomaly stays opt-in (its target also
  declares the template, but the user-explicit nature of the original
  opt-in flow means the seeding produces the same set of subscribers
  they already had).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-api@0.2.2
  - @checkstack/queue-api@0.2.16
  - @checkstack/signal-backend@0.2.1

## 0.7.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/signal-backend@0.2.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/queue-api@0.2.15

## 0.7.0

### Minor Changes

- 8d1ef12: ## Infrastructure Configuration Shell & Cache System

  ### New Packages

  - **`@checkstack/cache-api`**: Core cache abstractions — `CacheProvider` interface, `createScopedCache` factory for plugin key isolation, `CachePlugin`/`CacheManager` lifecycle interfaces.
  - **`@checkstack/cache-common`**: Shared cache types, RPC contract (`getPlugins`, `getConfiguration`, `updateConfiguration`), access rules, and plugin metadata.
  - **`@checkstack/cache-backend`**: Cache settings RPC router — exposes plugin discovery, configuration read/write endpoints with access-gated authorization.
  - **`@checkstack/cache-frontend`**: Cache configuration tab component for the Infrastructure Settings page.
  - **`@checkstack/infrastructure-common`**: Infrastructure tab registry, routes, and shared types for the IDE-style configuration shell.
  - **`@checkstack/infrastructure-frontend`**: Infrastructure Settings page with vertical tab bar, per-tab access control, and user menu integration.

  ### Modified Packages

  - **`@checkstack/backend-api`**: Added `cachePluginRegistry` and `cacheManager` to `RpcContext` and `coreServices`.
  - **`@checkstack/backend`**: Registered cache services in boot sequence, added cache config loading, extended dependency sorter for cache plugin ordering.
  - **`@checkstack/queue-frontend`**: Refactored from standalone `/queue/config` route to an infrastructure tab. Queue settings now live inside the Infrastructure Settings page.

  ### Architecture

  The former monolithic Queue Config page is replaced by a pluggable Infrastructure Settings shell (`/infrastructure/config`). Plugins register configuration tabs via `registerInfrastructureTab()` with their own access rules, icons, and components. The shell evaluates per-tab access and only renders tabs the user can see.

### Patch Changes

- 8d1ef12: ## Per-entity caching with single-flight + safe invalidation across the dashboard hot paths

  ### `@checkstack/cache-api`

  - **Breaking** for backend implementors: `CacheProvider` now requires `deleteByPrefix(prefix: string): Promise<number>` for family-level invalidation. The in-memory provider implements it; downstream providers (Redis, etc.) must add it before upgrading.
  - `createScopedCache` forwards `deleteByPrefix` and keeps prefixes scoped to the calling plugin.

  ### `@checkstack/cache-utils` (new package)

  High-level read-through caching helpers built on `CacheProvider`:

  - `createCachedScope({ cacheManager, pluginId })` returns a scope with `wrap`, `wrapMany`, `invalidate`, and `invalidatePrefix`.
  - **Single-flight**: concurrent cache misses for the same key share one loader.
  - **Per-entity bulk caching** via `wrapMany` so list/bulk RPCs cache by id rather than by the full input shape — overlapping callers share entries and invalidation stays exact.
  - **Race-safe invalidation** via per-key epoch counters: a loader started before a mutation cannot repopulate the cache with stale data after the mutation invalidates it. The mutation invariant is `db.write → cache.invalidate (await) → signals.emit`.
  - Cache failures fall through to the loader so a cache outage cannot break reads.

  ### `@checkstack/backend`

  - The internal null `CacheProvider` (used when no cache backend is configured) now implements the new `deleteByPrefix` method as a no-op. Patch bump only — no behavior change for existing callers.

  ### `@checkstack/healthcheck-backend`

  - `getSystemHealthStatus` and `getBulkSystemHealthStatus` now read through a per-system cache (`healthcheck:status:<systemId>`), eliminating N database queries per dashboard refresh for unchanged systems.
  - Mutation paths (configuration CRUD, system associations, satellite ingest, queue-driven check runs, system/satellite removal hooks) invalidate affected keys before broadcasting their signals so frontend refetches always observe fresh data.

  ### `@checkstack/incident-backend`

  - `listIncidents`, `getIncident`, `getIncidentsForSystem`, and `getBulkIncidentsForSystems` now read through a scoped cache:
    - per-incident at `incident:<id>`
    - per-system at `system:<systemId>`
    - per-filter-shape at `list:<stable-stringify(filters)>` for the few list shapes the dashboard polls
  - Mutations (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident`) invalidate the incident, every affected system, and every cached list before broadcasting `INCIDENT_UPDATED`.
  - The catalog `systemDeleted` cleanup hook drops that system's cached entries.

  ### `@checkstack/maintenance-backend`

  - `listMaintenances`, `getMaintenance`, `getMaintenancesForSystem`, and `getBulkMaintenancesForSystems` use the same per-entity / per-system / per-filter-shape pattern as incidents.
  - Mutations (`createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`, `deleteMaintenance`) invalidate before broadcasting `MAINTENANCE_UPDATED`.

  ### `@checkstack/catalog-backend`

  - Topology reads (`getEntities`, `getSystems`, `getSystem`, `getGroups`, `getSystemGroupIds`) cache under the `entity:` family (25s TTL).
  - Views (`getViews`) and per-system contacts (`getSystemContacts`) cache in their own families.
  - System / group / membership mutations drop the entire `entity:` family (every reader joins the same tables); view and contact mutations drop only their respective scopes.

  ### `@checkstack/slo-backend`

  - `listObjectives`, `getObjective`, `getObjectivesForSystem`, and `getBulkObjectivesForSystems` cache results including the expensive `engine.computeStatus` output.
  - Per-entity caching for the bulk handler so dashboards with overlapping system sets share entries.
  - Mutations (`createObjective`, `updateObjective`, `deleteObjective`) invalidate before broadcasting `SLO_STATUS_CHANGED`.

  ### `@checkstack/anomaly-backend`

  - New `router-cache.ts` adds a cache scope distinct from the existing detector baseline cache, keyed by stable filter hash.
  - `getAnomalies` and `getAnomalyBaselines` cache through this scope (15s TTL).
  - The detector invalidates the router cache before broadcasting `ANOMALY_STATE_CHANGED` on every state transition (suspicious/anomaly/recovered).
  - Config mutations also invalidate.

  ### `@checkstack/notification-backend`

  - `getUnreadCount`, `getNotifications`, and `getSubscriptions` cache per-user.
  - `markAsRead`, `deleteNotification`, `notifyUsers`, and `notifyGroups` invalidate every affected user's cache before sending realtime signals to that user.
  - `subscribe` and `unsubscribe` invalidate the user's subscription cache.

  ### `@checkstack/announcement-backend`

  - `getActiveAnnouncements` caches per-user (or anonymous) and per-`includeDismissed` flag (45s TTL — admin-driven, slowly changing).
  - `listAllAnnouncements` caches under a single key.
  - `dismissAnnouncement` only drops that user's cache; `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` drop every user's cache before broadcasting `ANNOUNCEMENT_UPDATED`.
  - The auth `userDeleted` cleanup hook drops that user's cached entries.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/api-docs-common@0.1.10
  - @checkstack/auth-common@0.6.3
  - @checkstack/signal-backend@0.1.20
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.6.6

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2

## 0.6.5

### Patch Changes

- 35a91e5: Fix truncated static file responses in production container

  Hono's `c.body()` wasn't fully consuming Bun's `ReadableStream` from `file.stream()`, causing truncated responses (e.g. 129B instead of 1098B for the favicon). Switched to reading the file as `ArrayBuffer` before passing to `c.body()`, ensuring the full content is delivered.

## 0.6.4

### Patch Changes

- a713e0f: Fix static file Content-Length header stripped by Hono middleware

  Hono's CORS middleware wraps raw `Response` objects and strips Bun's auto-generated headers. Switched to using `c.body()` + `c.header()` so Content-Type and Content-Length survive the middleware pipeline. Extracted a shared `serveFile` helper for all static file routes.

## 0.6.3

### Patch Changes

- 3da7582: Fix favicon not loading in production container and add NotFound page

  - **Backend**: Fix static file serving so root-level files like `/favicon.svg` are served from the dist directory before the SPA fallback catches them
  - **UI**: Add `NotFound` component with stacked-checkmark logo, physics-inspired falling "4" animation, and low-power device fallback
  - **Frontend**: Add catch-all `*` route to display the NotFound page for unmatched routes, and add the Checkstack logo to the navbar
  - **Favicon**: Redesign with stacked checkmarks in the brand purple/indigo palette

## 0.6.2

### Patch Changes

- 53a64c1: Fix Docker build by whitelisting LICENSE.md in .dockerignore
- 53a64c1: Update license to Elastic License with revised terms (copyright 2026). The license is now bundled inside both the main and satellite container images.

## 0.6.1

### Patch Changes

- e111f4a: Update license to Elastic License with revised terms (copyright 2026). The license is now bundled inside both the main and satellite container images.

## 0.6.0

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
  - @checkstack/backend-api@0.12.0
  - @checkstack/queue-api@0.2.13
  - @checkstack/signal-backend@0.1.19

## 0.5.3

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/api-docs-common@0.1.9
  - @checkstack/auth-common@0.6.1
  - @checkstack/signal-backend@0.1.18
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.5.2

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/queue-api@0.2.11
  - @checkstack/signal-backend@0.1.17

## 0.5.1

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/queue-api@0.2.10
- @checkstack/signal-backend@0.1.16

## 0.5.0

### Minor Changes

- 3589199: Add About page with platform information, license, contact details, and version information

  - New `about-common` package with plugin metadata
  - New `about-frontend` package with the About page and user menu item
  - New `/api/about` backend endpoint exposing core version and loaded plugin versions
  - Accessible via "About Checkstack" in the user menu dropdown

## 0.4.17

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/queue-api@0.2.9
  - @checkstack/signal-backend@0.1.15

## 0.4.16

### Patch Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.
- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-common@0.6.0
  - @checkstack/queue-api@0.2.8
  - @checkstack/signal-backend@0.1.14

## 0.4.15

### Patch Changes

- 4d59cc7: Prune devDependencies and development-only source folders (like `core/scripts` and `test-utils-*`) from the production Docker image to reduce size and improve security.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
  - @checkstack/api-docs-common@0.1.8
  - @checkstack/auth-common@0.5.7
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/drizzle-helper@0.0.4
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-backend@0.1.13
  - @checkstack/signal-common@0.1.8

## 0.4.14

### Patch Changes

- 0ebbe56: Security Vulnerability Remediation completed:
  - Refactored core authorization to Fail-Closed architecture with secure defaults.
  - Implemented `assertTeamManagementAccess` to resolve BOLA in Teams Management.
  - Protected internal S2S capabilities via explicit wildcard `serviceScope` definitions.
  - Disarmed OS Command Injection in DiskCollector via strict regex validation and bash escaping.
  - Re-architected inline script processing executing scripts in sandboxed Web Worker contexts.
  - Isolated subprocess environment scopes in PingStrategy limiting variable leakage.
  - Enforced strict token/API Key parsing with URLSearchParams checking.
  - Explicitly fail-fast on missing DATABASE_URL configuration across independent backend clusters.
  - Activated strict HTTP Security Headers (HSTS, CSP, X-Frame-Options) across the API automatically.
- Updated dependencies [0ebbe56]
  - @checkstack/auth-common@0.5.6
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/queue-api@0.2.6
  - @checkstack/signal-backend@0.1.12
  - @checkstack/api-docs-common@0.1.7
  - @checkstack/signal-common@0.1.7

## 0.4.13

### Patch Changes

- 869b4ab: ## Health Check Execution Improvements

  ### Breaking Changes (backend-api)

  - `HealthCheckStrategy.createClient()` now accepts `unknown` instead of `TConfig` due to TypeScript contravariance constraints. Implementations should use `this.config.validate(config)` to narrow the type.

  ### Features

  - **Platform-level hard timeout**: The executor now wraps the entire health check execution (connection + all collectors) in a single timeout, ensuring checks never hang indefinitely.
  - **Parallel collector execution**: Collectors now run in parallel using `Promise.allSettled()`, improving performance while ensuring all collectors complete regardless of individual failures.
  - **Base strategy config schema**: All strategy configs now extend `baseStrategyConfigSchema` which provides a standardized `timeout` field with sensible defaults (30s, min 100ms).

  ### Fixes

  - Fixed HTTP and Jenkins strategies clearing timeouts before reading the full response body.
  - Simplified registry type signatures by using default type parameters.

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/queue-api@0.2.5
  - @checkstack/signal-backend@0.1.11

## 0.4.12

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/queue-api@0.2.4
  - @checkstack/signal-backend@0.1.10

## 0.4.11

### Patch Changes

- 48c2080: Migrate aggregation from batch to incremental (`mergeResult`)

  ### Breaking Changes (Internal)

  - Replaced `aggregateResult(runs[])` with `mergeResult(existing, run)` interface across all HealthCheckStrategy and CollectorStrategy implementations

  ### New Features

  - Added incremental aggregation utilities in `@checkstack/backend-api`:
    - `mergeCounter()` - track occurrences
    - `mergeAverage()` - track sum/count, compute avg
    - `mergeRate()` - track success/total, compute %
    - `mergeMinMax()` - track min/max values
  - Exported Zod schemas for internal state: `averageStateSchema`, `rateStateSchema`, `minMaxStateSchema`, `counterStateSchema`

  ### Improvements

  - Enables O(1) storage overhead by maintaining incremental aggregation state
  - Prepares for real-time hourly aggregation without batch accumulation

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/api-docs-common@0.1.6
  - @checkstack/auth-common@0.5.5
  - @checkstack/signal-backend@0.1.9
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.4.10

### Patch Changes

- f8ce585: Improved RPC error logging to include full stack traces for procedure errors. Previously, errors inside RPC handlers (such as database table not found errors) resulted in silent 500 responses. Now these errors are logged with detailed information to the backend console for easier debugging.

## 0.4.9

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/api-docs-common@0.1.5
  - @checkstack/auth-common@0.5.4
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/drizzle-helper@0.0.3
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-backend@0.1.8
  - @checkstack/signal-common@0.1.5

## 0.4.8

### Patch Changes

- dd16be7: Fix plugin schema isolation: create schema before migrations run

  Previously, schemas were only created when `coreServices.database` was resolved (after migrations), causing tables to be created in the `public` schema instead of plugin-specific schemas. Now schemas are created immediately before migrations run.

  Also removed the `public` fallback from migration search_path to make errors more visible if schema creation fails.

## 0.4.7

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/api-docs-common@0.1.4
  - @checkstack/auth-common@0.5.3
  - @checkstack/backend-api@0.5.1
  - @checkstack/signal-backend@0.1.7
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.4.6

### Patch Changes

- 66a3963: Update plugin loader to use SafeDatabase type

  - Updated `PluginLoaderDeps.db` type from `NodePgDatabase` to `SafeDatabase`
  - Added type cast for drizzle `migrate()` function which still requires `NodePgDatabase`

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/backend-api@0.5.0
  - @checkstack/signal-backend@0.1.6

## 0.4.5

### Patch Changes

- 8a87cd4: Added startup validation for unregistered access rules

  The backend now throws an error at startup if a procedure contract references an access rule that isn't registered with the plugin system. This prevents silent runtime failures.

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/auth-common@0.5.2
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/queue-api@0.1.3
  - @checkstack/signal-backend@0.1.5
  - @checkstack/api-docs-common@0.1.3
  - @checkstack/signal-common@0.1.3

## 0.4.4

### Patch Changes

- 18fa8e3: Add notification suppression toggle for maintenance windows

  **New Feature:** When creating or editing a maintenance window, you can now enable "Suppress health notifications" to prevent health status change notifications from being sent for affected systems while the maintenance is active (in_progress status). This is useful for planned downtime where health alerts are expected and would otherwise create noise.

  **Changes:**

  - Added `suppressNotifications` field to maintenance schema
  - Added new service-to-service API `hasActiveMaintenanceWithSuppression`
  - Healthcheck queue executor now checks for suppression before sending notifications
  - MaintenanceEditor UI includes new toggle checkbox

  **Bug Fix:** Fixed migration system to correctly set PostgreSQL search_path when running plugin migrations. Previously, migrations could fail with "relation does not exist" errors because the schema context wasn't properly set.

- db9b37c: Fixed 500 errors on healthcheck `getHistory` and `getDetailedHistory` endpoints caused by the scoped database proxy not handling Drizzle's `$count()` utility method.

  **Root Cause:** The `$count()` method returns a Promise directly (not a query builder), bypassing the chain-replay mechanism used for schema isolation. This caused queries to run without the proper `search_path`, resulting in database errors.

  **Changes:**

  - Added explicit `$count` method handling in `scoped-db.ts` to wrap count operations in transactions with proper schema isolation
  - Wrapped `$count` return values with `Number()` in healthcheck service to handle BigInt serialization

## 0.4.3

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/signal-backend@0.1.4
  - @checkstack/api-docs-common@0.1.2
  - @checkstack/auth-common@0.5.1
  - @checkstack/signal-common@0.1.2

## 0.4.2

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/auth-common@0.5.0
  - @checkstack/queue-api@0.1.1
  - @checkstack/signal-backend@0.1.3

## 0.4.1

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-common@0.4.0

## 0.4.0

### Minor Changes

- 180be38: # Queue Lag Warning

  Added a queue lag warning system that displays alerts when pending jobs exceed configurable thresholds.

  ## Features

  - **Backend Stats API**: New `getStats`, `getLagStatus`, and `updateLagThresholds` RPC endpoints
  - **Signal-based Updates**: `QUEUE_LAG_CHANGED` signal for real-time frontend updates
  - **Aggregated Stats**: `QueueManager.getAggregatedStats()` sums stats across all queues
  - **Configurable Thresholds**: Warning (default 100) and Critical (default 500) thresholds stored in config
  - **Dashboard Integration**: Queue lag alert displayed on main Dashboard (access-gated)
  - **Queue Settings Page**: Lag alert and Performance Tuning guidance card with concurrency tips

  ## UI Changes

  - Queue lag alert banner appears on Dashboard and Queue Settings when pending jobs exceed thresholds
  - New "Performance Tuning" card with concurrency settings guidance and bottleneck indicators

- 747206a: ### Schema-Scoped Database: Improved Builder Detection and Security

  **Features:**

  - Implemented `entityKind`-based detection of Drizzle query builders, replacing the hardcoded method name list. This automatically handles new Drizzle methods that use existing builder types.
  - Added `ScopedDatabase<TSchema>` type that excludes the relational query API (`db.query.*`) at compile-time, providing better developer experience for plugin authors.

  **Security:**

  - Blocked access to `db.query.*` (relational query API) in schema-scoped databases because it bypasses schema isolation. Plugins must use the standard query builder API (`db.select().from(table)`) instead.
  - Runtime error with helpful message is thrown if `db.query` is accessed, guiding developers to the correct API.

  **Documentation:**

  - Added comprehensive internal documentation explaining the chain-recording approach, why transactions are required for `SET LOCAL`, and how the proxy works.

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/auth-common@0.3.0
  - @checkstack/api-docs-common@0.1.1
  - @checkstack/signal-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1
  - @checkstack/signal-backend@0.1.1

## 0.3.0

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
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/api-docs-common@0.1.0
  - @checkstack/auth-common@0.2.0
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/signal-backend@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.2.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

### Patch Changes

- 97c5a6b: Fix collector lookup when health check is assigned to a system

  Collectors are now stored in the registry with their fully-qualified ID format (ownerPluginId.collectorId) to match how they are referenced in health check configurations. Added `qualifiedId` field to `RegisteredCollector` interface to avoid re-constructing the ID at query time. This fixes the "Collector not found" warning that occurred when executing health checks with assigned systems.

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/auth-common@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
  - @checkstack/signal-backend@0.0.4
  - @checkstack/api-docs-common@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.1.0

### Minor Changes

- f5b1f49: Added collector registry lifecycle cleanup during plugin unloading.

  - Added `unregisterByOwner(pluginId)` to remove collectors owned by unloading plugins
  - Added `unregisterByMissingStrategies(loadedPluginIds)` for dependency-based pruning
  - Integrated registry cleanup into `PluginManager.deregisterPlugin()`
  - Updated `registerCoreServices` to return global registries for lifecycle management

### Patch Changes

- f5b1f49: Added JSONPath assertions for response body validation and fully qualified strategy IDs.

  **JSONPath Assertions:**

  - Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
  - Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
  - Added `jsonPath` field to `CollectorAssertionSchema` for persistence
  - HTTP Request collector body field now supports JSONPath assertions

  **Fully Qualified Strategy IDs:**

  - HealthCheckRegistry now uses scoped factories like CollectorRegistry
  - Strategies are stored with `pluginId.strategyId` format
  - Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
  - Router returns qualified IDs so frontend can correctly fetch collectors

  **UI Improvements:**

  - Save button disabled when collector configs have invalid required fields
  - Fixed nested button warning in CollectorList accordion

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/signal-backend@0.0.3
  - @checkstack/api-docs-common@0.0.3
  - @checkstack/auth-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/api-docs-common@0.0.2
  - @checkstack/auth-common@0.0.2
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/drizzle-helper@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-backend@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.4

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/auth-common@0.2.1
  - @checkstack/queue-api@1.0.1
  - @checkstack/signal-backend@0.1.1
  - @checkstack/api-docs-common@0.0.3
  - @checkstack/signal-common@0.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-common@0.2.0

## 0.1.2

### Patch Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config

## 0.1.1

### Patch Changes

- f0bdec2: Fixed CI test failures by implementing proper module mocking infrastructure:
  - Added test-preload.ts with comprehensive mocks for db, logger, and core-services
  - Added skipDiscovery option to loadPlugins() for test isolation
  - Configured bunfig.toml preload for workspace-wide test setup

## 0.1.0

### Minor Changes

- ffc28f6: ### Anonymous Role and Public Access

  Introduces a configurable "anonymous" role for managing permissions available to unauthenticated users.

  **Core Changes:**

  - Added `userType: "public"` - endpoints accessible by both authenticated users (with their permissions) and anonymous users (with anonymous role permissions)
  - Renamed `userType: "both"` to `"authenticated"` for clarity
  - Renamed `isDefault` to `isAuthenticatedDefault` on Permission interface
  - Added `isPublicDefault` flag for permissions that should be granted to the anonymous role by default

  **Backend Infrastructure:**

  - New `anonymous` system role created during auth-backend initialization
  - New `disabled_public_default_permission` table tracks admin-disabled public defaults
  - `autoAuthMiddleware` now checks anonymous role permissions for unauthenticated public endpoint access
  - `AuthService.getAnonymousPermissions()` with 1-minute caching for performance
  - Anonymous role filtered from `getRoles` endpoint (not assignable to users)
  - Validation prevents assigning anonymous role to users

  **Catalog Integration:**

  - `catalog.read` permission now has both `isAuthenticatedDefault` and `isPublicDefault`
  - Read endpoints (`getSystems`, `getGroups`, `getEntities`) now use `userType: "public"`

  **UI:**

  - New `PermissionGate` component for conditionally rendering content based on permissions

- 71275dd: fix: Anonymous and non-admin user authorization

  - Fixed permission metadata preservation in `plugin-manager.ts` - changed from outdated `isDefault` field to `isAuthenticatedDefault` and `isPublicDefault`
  - Added `pluginId` to `RpcContext` to enable proper permission ID matching
  - Updated `autoAuthMiddleware` to prefix contract permission IDs with the pluginId from context, ensuring that contract permissions (e.g., `catalog.read`) correctly match database permissions (e.g., `catalog-backend.catalog.read`)
  - Route now uses `/api/:pluginId/*` pattern with Hono path parameters for clean pluginId extraction

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

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkstack/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkstack/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkstack/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkstack/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkstack/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- 81f3f85: ## Breaking: Unified Versioned<T> Architecture

  Refactored the versioning system to use a unified `Versioned<T>` class instead of separate `VersionedSchema`, `VersionedData`, and `VersionedConfig` types.

  ### Breaking Changes

  - **`VersionedSchema<T>`** is replaced by `Versioned<T>` class
  - **`VersionedData<T>`** is replaced by `VersionedRecord<T>` interface
  - **`VersionedConfig<T>`** is replaced by `VersionedPluginRecord<T>` interface
  - **`ConfigMigration<F, T>`** is replaced by `Migration<F, T>` interface
  - **`MigrationChain<T>`** is removed (use `Migration<unknown, unknown>[]`)
  - **`migrateVersionedData()`** is removed (use `versioned.parse()`)
  - **`ConfigMigrationRunner`** is removed (migrations are internal to Versioned)

  ### Migration Guide

  Before:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: {
      version: 1,
      schema: mySchema,
      migrations: [],
    },
  };
  const data = await migrateVersionedData(stored, 1, migrations);
  ```

  After:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: new Versioned({
      version: 1,
      schema: mySchema,
      migrations: [],
    }),
  };
  const data = await strategy.config.parse(stored);
  ```

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/auth-common@0.1.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/signal-backend@0.1.0
  - @checkstack/api-docs-common@0.0.2
