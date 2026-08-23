# @checkstack/queue-memory-backend

## 0.4.39

### Patch Changes

- Updated dependencies [68ef4b2]
  - @checkstack/backend-api@0.35.2

## 0.4.38

### Patch Changes

- @checkstack/backend-api@0.35.1

## 0.4.37

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/backend-api@0.35.0
  - @checkstack/queue-api@0.4.1
  - @checkstack/queue-memory-common@0.1.29

## 0.4.36

### Patch Changes

- @checkstack/backend-api@0.34.1

## 0.4.35

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/backend-api@0.34.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/common@0.23.0
  - @checkstack/queue-memory-common@0.1.28

## 0.4.34

### Patch Changes

- Updated dependencies [d00e099]
  - @checkstack/backend-api@0.33.0
  - @checkstack/common@0.22.0
  - @checkstack/queue-api@0.3.19
  - @checkstack/queue-memory-common@0.1.27

## 0.4.33

### Patch Changes

- @checkstack/backend-api@0.32.1

## 0.4.32

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0

## 0.4.31

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/backend-api@0.31.1

## 0.4.30

### Patch Changes

- d0eddc9: Cut health-check connection churn and de-cluster the scheduling "thundering
  herd" so per-run durations stop varying wildly for the same check against the
  same target. Grounded in live OpenTelemetry phase histograms: per-run wall time
  was dominated by TCP/TLS connection setup under a self-inflicted burst, not by
  slow targets, CPU, or the database.

  - **In-memory queue now honors `startDelay` in `scheduleRecurring`.** It was
    silently dropped, so every recurring job (health checks included) fired
    immediately on boot and then on a boot-anchored interval grid - keeping all
    equal-interval checks phase-aligned forever. `scheduleRecurring` now defers the
    first execution by `startDelay` and anchors the recurrence to that first fire,
    matching the queue contract and the BullMQ backend's intent. Jobs scheduled
    without `startDelay` are unchanged (first run is immediate).
  - **The BullMQ queue now honors `startDelay` in `scheduleRecurring` too.** It also
    dropped `startDelay`, and its `every` scheduler captures the grid phase from
    whenever `upsertJobScheduler` first runs - so a bootstrap loop scheduling many
    equal-interval jobs at ~the same instant handed them all the same phase.
    `scheduleRecurring` now pins the first fire to `now + startDelay` via the
    scheduler's `startDate`, which shifts the whole recurrence, so the same jittered
    `startDelay` de-clusters checks on the Redis backend identically to the
    in-memory one. Cron schedules (absolute times) are unaffected.
  - **The health-check scheduler jitters each check's first fire** by a small,
    deterministic fraction of its interval (stable across restarts, keyed on the
    check). A synchronized set of checks now spreads across the interval instead of
    hammering their targets at the same instant. Because the queue anchors the
    recurrence to the first fire, this offset persists for every subsequent run.
  - **The HTTP collector refreshes its TCP/TLS connect-timing probe in the
    background, per origin, and never awaits it.** Bun's `fetch` already pools and
    reuses connections across runs (verified: warm reuse survives 20s+ idle gaps),
    but the timing probe opened a fresh handshake on EVERY run - mis-reporting the
    reused request's real latency and doubling the connection count under a burst.
    The probe now refreshes a per-origin sample at most once per TTL (60s) and runs
    fully in the background: it is NEVER on a request's critical path. Pinned to one
    resolved IP, the probe can be far slower than the reused fetch (e.g. an
    intermittent IPv6 SYN retry the real request never pays), and per the collector
    contract best-effort timing must never delay the check - the previous code
    `await`ed it, so a slow probe's refresh run showed up as a latency outlier. The
    `connect`/`tls` phases are now explicitly a cached, per-host estimate.
  - **The run detail UI now labels the estimate.** The timing-breakdown caption
    clarifies that DNS, wait, and transfer are measured on the request, while
    connection and TLS setup are an estimate sampled from a periodic per-host probe
    and cached briefly (about a minute), so an operator does not read the cached
    connect/TLS value as a per-run measurement.

  Behaviour is otherwise unchanged: health status and assertions are the same;
  there are simply far fewer connections, the herd is spread out, and the timing
  breakdown can no longer be inflated by a slow best-effort probe. No configuration
  or API changes.

- d0eddc9: Add opt-in OpenTelemetry metrics with a Prometheus exporter so a performance
  investigation can be grounded in real numbers from a running instance instead of
  guesses.

  The layer is **off by default and free when off**: the instruments are OTel
  no-ops until a `MeterProvider` is registered, so the hot paths pay nothing until
  you opt in.

  - **`@checkstack/backend-api` gains an `instrumentation` module** exporting lazy,
    memoized instrument accessors any plugin can record through:
    `dbTransactionsCounter`, `dbQueriesCounter`, `healthcheckExecutionHistogram`,
    `healthcheckPhaseHistogram`, `queueEnqueuedCounter`, `queueProcessedCounter`.
    Each looks up its instrument once and is a no-op until the host registers a
    provider, so callers can record unconditionally.
  - **`@checkstack/backend` owns the SDK bootstrap.** `startMetrics()` registers a
    global `MeterProvider` + Prometheus exporter when `CHECKSTACK_METRICS_ENABLED`
    is set (host `127.0.0.1`, port `9464` by default, both overridable via
    `CHECKSTACK_METRICS_HOST` / `CHECKSTACK_METRICS_PORT`). The exporter runs its
    OWN HTTP server, NOT a route on the app, so it carries no app-auth surface. It
    also registers host-owned observable instruments:
    `checkstack.db.pool.connections` (admin/lock pool active/idle/waiting) and
    `checkstack.runtime.event_loop_delay` (setInterval-drift histogram = JS-thread
    block time).
  - **The scoped-DB proxy records DB transactions/queries per plugin schema**, so
    `db_transactions_total` minus `db_queries_total` per schema is exactly the
    number of batched transactions - a live check that `withScopedTransaction`
    batching is taking effect.
  - **The health-check executor records execution + per-phase histograms**
    (`connect`, `wait`, ...) so a high `connect` p95 with a low `wait` points at
    connection establishment rather than a slow target or a CPU-bound platform.
  - **The in-memory queue records enqueued/processed counters** per queue and
    status.

  No behaviour changes when disabled. Enable with `CHECKSTACK_METRICS_ENABLED=1`
  and scrape `http://127.0.0.1:9464/metrics`. See the backend observability guide
  for the full metric list and interpretation.

- d0eddc9: Add a queue-backlog metric and fix the in-memory queue's backlog accounting so
  the metric is trustworthy under saturation - the single most important signal
  for whether health-check (or any queue) work is keeping up at scale.

  - **New `checkstack.queue.jobs` observable gauge** (`state="pending"|"processing"`),
    registered by the host once the QueueManager exists. `pending` is the backlog;
    if it climbs without draining, work is arriving faster than the queue
    concurrency can execute it. No-op unless metrics are enabled.
  - **Fix: the in-memory queue undercounted `pending`.** `processNext` removed a
    job from the pending list and only THEN awaited a concurrency slot in
    `processJob`, so jobs blocked waiting for a slot were invisible - not in
    `pending`, not yet in `processing`. Under saturation the reported backlog read
    ~0 while hundreds of jobs were actually queued. Such slot-waiters are now
    counted in `pending`, so `getStats()` (and the gauge, and the runtime panel)
    reflect the true depth. `processing` still counts only executing jobs.

  This surfaced from a scale harness driving the real hot path: 20% unreachable
  checks (which pin a concurrency slot for the full timeout) drove the backlog from
  0 to 700+ in 35s while lock-pool waiting stayed at 0 - i.e. the first scaling
  ceiling is concurrency-slot saturation by slow checks, not the database.

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/queue-api@0.3.19
  - @checkstack/queue-memory-common@0.1.27

## 0.4.29

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0

## 0.4.28

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/queue-api@0.3.18
  - @checkstack/queue-memory-common@0.1.26

## 0.4.27

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/queue-api@0.3.17
  - @checkstack/queue-memory-common@0.1.25

## 0.4.26

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0

## 0.4.25

### Patch Changes

- @checkstack/backend-api@0.27.1

## 0.4.24

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/queue-api@0.3.16
  - @checkstack/queue-memory-common@0.1.24

## 0.4.23

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/queue-api@0.3.15
  - @checkstack/queue-memory-common@0.1.23

## 0.4.22

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/queue-memory-common@0.1.22
  - @checkstack/common@0.17.0
  - @checkstack/queue-api@0.3.14

## 0.4.21

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/queue-api@0.3.14
  - @checkstack/queue-memory-common@0.1.21

## 0.4.20

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1

## 0.4.19

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0

## 0.4.18

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/queue-api@0.3.13
  - @checkstack/queue-memory-common@0.1.20

## 0.4.17

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0

## 0.4.16

### Patch Changes

- @checkstack/backend-api@0.21.7

## 0.4.15

### Patch Changes

- @checkstack/backend-api@0.21.6

## 0.4.14

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/queue-memory-common@0.1.19
  - @checkstack/queue-api@0.3.12

## 0.4.13

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4

## 0.4.12

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/queue-api@0.3.11
- @checkstack/queue-memory-common@0.1.18

## 0.4.11

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/queue-memory-common@0.1.18

## 0.4.10

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/queue-api@0.3.10
  - @checkstack/queue-memory-common@0.1.17

## 0.4.9

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
  - @checkstack/queue-api@0.3.9
  - @checkstack/queue-memory-common@0.1.16

## 0.4.8

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/queue-api@0.3.8

## 0.4.7

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
  - @checkstack/queue-api@0.3.7

## 0.4.6

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/queue-memory-common@0.1.15
  - @checkstack/queue-api@0.3.6

## 0.4.5

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/queue-api@0.3.5

## 0.4.4

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/queue-memory-common@0.1.14
  - @checkstack/queue-api@0.3.4

## 0.4.3

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/queue-api@0.3.3

## 0.4.2

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/queue-api@0.3.2

## 0.4.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/queue-memory-common@0.1.13
  - @checkstack/queue-api@0.3.1

## 0.4.0

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
  - @checkstack/queue-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/queue-memory-common@0.1.12

## 0.3.18

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/queue-api@0.2.18
  - @checkstack/queue-memory-common@0.1.11

## 0.3.17

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/queue-api@0.2.17
  - @checkstack/common@0.7.0
  - @checkstack/queue-memory-common@0.1.10

## 0.3.16

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/queue-api@0.2.16

## 0.3.15

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/queue-api@0.2.15

## 0.3.14

### Patch Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/queue-memory-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.3.13

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/queue-api@0.2.13

## 0.3.12

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/queue-memory-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.3.11

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/queue-api@0.2.11

## 0.3.10

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/queue-api@0.2.10

## 0.3.9

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/queue-api@0.2.9

## 0.3.8

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/queue-api@0.2.8

## 0.3.7

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/queue-api@0.2.7
  - @checkstack/queue-memory-common@0.1.8

## 0.3.6

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/queue-api@0.2.6
  - @checkstack/queue-memory-common@0.1.7

## 0.3.5

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/queue-api@0.2.5

## 0.3.4

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/queue-api@0.2.4

## 0.3.3

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/queue-memory-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.3.2

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/queue-api@0.2.2
  - @checkstack/queue-memory-common@0.1.5

## 0.3.1

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/queue-memory-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.3.0

### Minor Changes

- 2c0822d: ### Queue System

  - Added cron pattern support to `scheduleRecurring()` - accepts either `intervalSeconds` or `cronPattern`
  - BullMQ backend uses native cron scheduling via `pattern` option
  - InMemoryQueue implements wall-clock cron scheduling with `cron-parser`

  ### Maintenance Backend

  - Auto status transitions now use cron pattern `* * * * *` for precise second-0 scheduling
  - User notifications are now sent for auto-started and auto-completed maintenances
  - Refactored to call `addUpdate` RPC for status changes, centralizing hook/signal/notification logic

  ### UI

  - DateTimePicker now resets seconds and milliseconds to 0 when time is changed

### Patch Changes

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/backend-api@0.5.0

## 0.2.4

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/queue-memory-common@0.1.3
  - @checkstack/queue-api@0.1.3

## 0.2.3

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/queue-memory-common@0.1.2

## 0.2.2

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/queue-api@0.1.1

## 0.2.1

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/queue-memory-common@0.1.1

## 0.2.0

### Minor Changes

- 9a27800: Changed recurring job scheduling from completion-based to wall-clock scheduling.

  **Breaking Change:** Recurring jobs now run on a fixed interval (like BullMQ) regardless of whether the previous job has completed. If a job takes longer than `intervalSeconds`, multiple jobs may run concurrently.

  **Improvements:**

  - Fixed job ID collision bug when rescheduling within the same millisecond
  - Configuration updates via `scheduleRecurring()` now properly cancel old intervals before starting new ones
  - Added `heartbeatIntervalMs` to config for resilient job recovery after system sleep

### Patch Changes

- 9a27800: Fix recurring jobs resilience and add logger support

  **Rescheduling Fix:**
  Previously, recurring job rescheduling logic was inside the `try` block of `processJob()`. When a job handler threw an exception and `maxRetries` was exhausted (or 0), the recurring job would never be rescheduled, permanently breaking the scheduling chain.

  This fix moves the rescheduling logic to the `finally` block, ensuring recurring jobs are always rescheduled after execution, regardless of success or failure.

  **Heartbeat Mechanism:**
  Added a periodic heartbeat (default: 5 seconds) that checks for ready jobs and triggers processing. This ensures jobs are processed even if `setTimeout` callbacks fail to fire (e.g., after system sleep/wake cycles). Configurable via `heartbeatIntervalMs` option; set to 0 to disable.

  **Logger Service Integration:**

  - Added optional `logger` parameter to `QueuePlugin.createQueue()` interface
  - `InMemoryQueue` now uses the provided logger instead of raw `console.error`
  - Consistent with the rest of the codebase's logging patterns

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1

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
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/queue-memory-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
  - @checkstack/queue-memory-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/queue-memory-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/queue-memory-common@0.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/queue-memory-common@0.1.2

## 1.0.0

### Major Changes

- 8e889b4: Add consumer group support to Queue API for distributed event system. BREAKING: consume() now requires ConsumeOptions with consumerGroup parameter.

### Patch Changes

- e4d83fc: Add BullMQ queue plugin with orphaned job cleanup

  - **queue-api**: Added `listRecurringJobs()` method to Queue interface for detecting orphaned jobs
  - **queue-bullmq-backend**: New plugin implementing BullMQ (Redis) queue backend with job schedulers, consumer groups, and distributed job persistence
  - **queue-bullmq-common**: New common package with queue permissions
  - **queue-memory-backend**: Implemented `listRecurringJobs()` for in-memory queue
  - **healthcheck-backend**: Enhanced `bootstrapHealthChecks` to clean up orphaned job schedulers using `listRecurringJobs()`
  - **test-utils-backend**: Added `listRecurringJobs()` to mock queue factory

  This enables production-ready distributed queue processing with Redis persistence and automatic cleanup of orphaned jobs when health checks are deleted.

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/queue-memory-common@0.1.1
