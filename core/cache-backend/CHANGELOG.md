# @checkstack/cache-backend

## 0.4.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4

## 0.4.3

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/cache-api@0.3.11
- @checkstack/cache-common@0.5.2
- @checkstack/common@0.14.1

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/cache-common@0.5.2

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/cache-common@0.5.1

## 0.4.0

### Minor Changes

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/cache-common@0.5.0
  - @checkstack/cache-api@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/cache-api@0.3.8

## 0.3.7

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/cache-api@0.3.7

## 0.3.6

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/cache-common@0.4.2
  - @checkstack/cache-api@0.3.6

## 0.3.5

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/cache-api@0.3.5

## 0.3.4

### Patch Changes

- f23f3c9: Add `correlationMiddleware` to `@checkstack/backend-api` and apply it
  to every plugin/core router so each request carries a stable
  `x-correlation-id` (read from the inbound header, or freshly minted
  via `crypto.randomUUID()` when absent) and an auto-injected child
  logger bound with `{ correlationId, pluginId, userId? }`. The ID is
  echoed back on the response header so the caller can correlate their
  client-side trace to the server logs.

  The `Logger` interface in `@checkstack/backend-api` now formally
  documents the structured-metadata convention (`logger.info("msg",
{ ...meta })`) alongside the long-standing varargs shape. Winston's
  splat handling already routes both shapes through the same vararg
  slot, so existing call sites are unaffected. A new optional
  `Logger.child(meta)` method captures the metadata-binding contract the
  new middleware relies on; production loggers always implement it,
  minimal test mocks may omit it (the middleware falls back gracefully).

  `RpcContext` grew two optional `Headers` bags, `requestHeaders` and
  `responseHeaders`, populated by the outer Hono `/api/*` and `/rest/*`
  handlers in `@checkstack/backend`. They are write-through observation
  points for middleware; an `RpcContext` constructed without them (S2S
  clients, tests) keeps working — the echo is a silent no-op and the ID
  is still bound onto the child logger for server-side correlation.

  The scaffolding template in `@checkstack/scripts` was updated so any
  new plugin generated via `bun run create` wires the middleware in the
  expected `.use(correlationMiddleware).use(autoAuthMiddleware)` order
  out of the box.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/cache-common@0.4.1
  - @checkstack/cache-api@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/cache-api@0.3.3

## 0.3.2

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
  - @checkstack/cache-api@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/cache-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/cache-api@0.3.1

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/cache-common@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/backend-api@0.15.1

## 0.2.4

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
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-common@0.2.1

## 0.2.3

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/cache-common@0.2.0
  - @checkstack/common@0.7.0

## 0.2.2

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/cache-api@0.2.2

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/cache-api@0.2.1

## 0.2.0

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

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-common@0.2.0
  - @checkstack/backend-api@0.13.0
