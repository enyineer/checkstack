# @checkstack/infrastructure-common

## 0.3.14

### Patch Changes

- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0

## 0.3.13

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/frontend-api@0.12.1

## 0.3.12

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/common@0.17.0

## 0.3.11

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1

## 0.3.10

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0

## 0.3.9

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
  - @checkstack/common@0.16.0
  - @checkstack/frontend-api@0.10.0

## 0.3.8

### Patch Changes

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/common@0.15.0

## 0.3.7

### Patch Changes

- fb705df: Upgrade React 18 to React 19 across the platform.

  **BREAKING (runtime frontend plugins):** React is shared as a Module Federation
  singleton, so the host now provides **React 19** to every runtime plugin.
  Frontend plugins built against React 18 must be rebuilt against React 19
  (`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
  `requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
  to a single version across the workspace via syncpack so the singleton can never
  skew (react and react-dom must match exactly).

  The React 19 removed-API surface was audited - the codebase used only no-arg
  `useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
  legacy context, string refs, or function-component `defaultProps`. This also
  clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
  `React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

  The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
  receive only the mechanical `react` dependency bump (`patch`); the framework
  packages carrying the shared-singleton change are bumped `minor`.

- Updated dependencies [fb705df]
  - @checkstack/frontend-api@0.8.0
  - @checkstack/common@0.14.1

## 0.3.6

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2

## 0.3.5

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/frontend-api@0.7.1

## 0.3.4

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [6d52276]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/common@0.12.0

## 0.3.2

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/frontend-api@0.5.2

## 0.3.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/frontend-api@0.5.1

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
- Updated dependencies [950d6ec]
  - @checkstack/common@0.9.0
  - @checkstack/frontend-api@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0
  - @checkstack/frontend-api@0.4.2

## 0.2.2

### Patch Changes

- Updated dependencies [32d52c6]
  - @checkstack/frontend-api@0.4.1

## 0.2.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/frontend-api@0.4.0

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
  - @checkstack/common@0.7.0
  - @checkstack/frontend-api@0.3.11
