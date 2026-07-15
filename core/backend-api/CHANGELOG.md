# @checkstack/backend-api

## 0.34.0

### Minor Changes

- 6c8b36b: Promote the SSRF-guarded, redirect-revalidating fetch into backend-api as
  `createGuardedFetch` / `GuardedFetchError`: scheme allow-list, host validation
  on EVERY redirect hop, spec-correct redirect semantics (301/302/303 downgrade
  to GET and drop the body; 307/308 preserve the method and refuse
  non-replayable stream bodies), and `maxRedirects: 0` returning the 3xx as-is
  for callers that must not follow.

  The Prometheus scrape executor now uses it: previously the scraper validated
  only the ORIGINAL host and then followed redirects blindly, so a compliant
  target could redirect a scrape to an internal address; every hop is now
  re-validated. (The AI probe-url tool and the notification egress validator
  deliberately keep their own guards - both are STRICTER than the shared
  default: probe-url blocks all private ranges and metadata hostnames by name,
  notification egress fails closed on any redirect.)

  Credential headers (`authorization`, `proxy-authorization`, `cookie`) are now
  stripped from the forwarded request when a redirect crosses to a different
  origin (scheme, host, or port), matching browser / undici behavior. Previously
  the manual follower re-sent every request header verbatim, so a redirecting
  target (e.g. a Prometheus scrape endpoint) could replay the configured bearer
  to another host. Same-origin redirects keep the credentials.

- 6c8b36b: Promote the t-digest percentile helpers from healthcheck-backend into
  backend-api (`createTDigest`, `serializeTDigest`, `deserializeTDigest`,
  `mergeTDigestStates`, `percentileFromState`, ...), so any plugin can maintain
  mergeable percentile sketches; tracestream's per-operation p95 buckets are the
  first new consumer. healthcheck-backend now imports the shared module (the
  local copy is removed, no behavior change).
- 6c8b36b: Catalog **Groups** and **Environments** are now team-manageable. Their reads
  stay public (they are shared browse facets everyone can see), but creating,
  renaming, and deleting them is team-scoped exactly like Systems: a create
  writes an owning-team grant, and edit/delete require a per-instance manage
  grant. A team that can create Systems can also create Groups and Environments
  (and attach them to systems it manages) with no extra grant.

  New reusable platform seam `instanceAccess.create.alsoAcceptCreatorOf: string[]`:
  a create procedure can declare sibling types whose `creator` (create-capability)
  grant also authorizes the create - strictly the type-level creator grant, so it
  stays orthogonal to `create.parent` (which is instance-manage). It is backed by a
  new strict-creator auth primitive `hasCreateCapability({ objectType })` consumed
  by BOTH the create middleware and the frontend `canCreate` verdict (extended with
  an optional `alsoAcceptCreatorOf`), so the button gate and the backend can never
  drift. The boot conformance check now also verifies every `alsoAcceptCreatorOf`
  type is a real team-scoped type, and `catalog.group` / `catalog.environment` gain
  resource-name resolvers so their team grants render by name.

  BREAKING: `catalog.deleteGroup` input reshaped from a bare `string` to
  `{ id: string }` (mirrors the earlier `deleteSystem` reshape) so the per-group
  manage check can resolve the target id. `catalog.reorderGroups` stays a
  global-admin operation (it rewrites the single global sort order for all groups).
  Existing ownerless (global) groups and environments remain editable only by
  global catalog admins until re-owned; no data migration is required (team grants
  live in the auth relation store).

- 6c8b36b: Promote the user-scoped cross-plugin RPC client into
  `@checkstack/backend-api` (`createUserScopedRpcClient` +
  `forwardableAuthHeadersFrom`): the caller-identity re-entry used by
  "cannot expose what you cannot see" gates (catalog readability on stream
  links, satellite binding auth, AI deferred tool routing, status-page
  publish) now has ONE implementation instead of six near-verbatim copies.
  Only the session cookie and bearer Authorization are ever forwarded, and a
  request without them re-enters anonymous (fail closed). ai-backend,
  status-page-backend and telemetry-backend migrate to the shared export;
  behavior is unchanged.

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/common@0.23.0
  - @checkstack/cache-api@0.3.20
  - @checkstack/signal-common@0.3.1
  - @checkstack/template-engine@0.4.12

## 0.33.0

### Minor Changes

- d00e099: Make a catalog System's free-form `metadata` (custom fields) genuinely usable
  end to end, mirroring how Environment custom fields already work. Previously a
  System's `metadata` column was writable but nothing consumed it - it did not
  surface in templating, could not be set via GitOps, and had no UI editor, so
  models (and users) had no way to understand what it was for.

  Now a system's custom fields are surfaced everywhere an environment's already
  are:

  - **Config templating**: a system's fields render as
    `{{ system.metadata.<key> }}` in templatable health-check config (e.g. an
    HTTP URL). They are namespaced under `.metadata` so a field named `id`/`name`
    can never shadow the structural `{{ system.id }}` / `{{ system.name }}`.
  - **Satellites**: the fields ride the satellite assignment
    (`SatelliteAssignment.systemMetadata`) so satellite runs template
    `{{ system.metadata.<key> }}` identically to local runs.
  - **UI**: the System editor gains a free-form key/value custom-fields editor
    (extracted into a shared `CustomFieldsEditor` used by both the System and
    Environment editors).
  - **GitOps**: the `System` kind accepts optional `spec.fields`, replaced on
    every reconcile (same shape as the `Environment` kind).
  - **Script collectors**: inline TS collectors read `context.system.metadata`
    (SDK editor types updated), and shell collectors get one
    `CHECKSTACK_SYSTEM_<FIELD>` env var per field, mirroring
    `CHECKSTACK_ENV_<FIELD>`. A field that normalizes to a reserved name
    (`CHECKSTACK_SYSTEM_ID`/`_NAME`) is now skipped with a warning rather than
    clobbering the built-in; the same reserved-name guard was added to the
    environment shell-env builder (previously a custom field named `id`/`name`
    could shadow the structural var).
  - **Editor autocomplete/preview**: the health-check editor offers
    `{{ system.metadata.<key> }}` completions and previews their values when a
    concrete system is in context.

  The AI assistant is corrected on two fronts:

  - The catalog create/update-system (and create-environment) tool schemas now
    `.describe()` their `metadata` field, so a model knows it is free-form custom
    fields that surface in templating - not a tagging/labeling mechanism - and
    should only set keys the user explicitly asks for.
  - A new "Acting on requests" chat system-prompt rule tells the assistant to
    perform a requested change via its tool instead of deflecting to a manual
    GitOps/UI how-to, and to name the missing permission when a tool is genuinely
    unavailable. (This entry also covers the regenerated docs index reflecting the
    updated GitOps/templating docs.)

  State & scale: a system's metadata continues to live solely in the
  `catalog.systems.metadata` Postgres column and is read via the existing
  `getSystem` RPC, so every pod reads the same value. The satellite assignment
  carries a per-dispatch snapshot for the duration of that run (ephemeral,
  re-read on the next dispatch), not a second source of truth. No new table or
  migration.

### Patch Changes

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/common@0.22.0
  - @checkstack/queue-api@0.3.19
  - @checkstack/template-engine@0.4.11

## 0.32.1

### Patch Changes

- @checkstack/healthcheck-common@1.16.2

## 0.32.0

### Minor Changes

- bd41130: perf(auth): cache the authenticated read path on the shared distributed cache

  `readEnrichedUser` ran three joins on EVERY authenticated request - user -> roles,
  role -> access rules, and (for guests) the anonymous role's rules - which were
  among the highest-call-count queries in production even though the underlying
  mappings change only on rare admin edits. These are now served read-through from
  the **platform `CacheManager`** (the same shared cache every plugin uses):

  - `user -> role ids` and `role -> access-rule ids` (`auth-backend/src/auth-cache.ts`)
  - anonymous role -> effective rules (read in `core/backend`'s
    `getAnonymousAccessRules`, under auth-backend's cache scope)

  Cross-pod correctness comes from the SHARED backend, not from an application
  broadcast: with a distributed provider (Redis) an invalidation is a `delete`
  every pod sees immediately, so a user load-balanced to any pod always gets an
  up-to-date authorization decision. On the default in-memory backend the caches
  are per-pod and therefore single-instance-only (the Infrastructure Cache UI now
  warns about this). The 60s TTL is only a natural-refresh safety net. User role
  membership itself is still resolved live per request; only the rarely-changing
  derived mappings are cached.

  The reads happen CACHE-FIRST, OUTSIDE any database transaction: `enrichUser` no
  longer wraps its lookups in `withScopedTransaction`, so on a cache hit it issues
  NO query for roles/rules and never holds a pooled DB connection across the cache
  round-trip - only the always-uncached team read touches the DB.

  The invalidation is enforced by design, not by convention: all writes to the
  `role` / `role_access_rule` / `user_role` tables go through a single
  `RoleMembershipStore` that now takes the shared cache as a required constructor
  argument and welds each write to its `delete`, so the two cannot drift. The
  `checkstack/no-direct-role-membership-writes` lint rule (error) still forbids raw
  `insert`/`update`/`delete` on those tables anywhere else in `auth-backend`.

  Invalidation completeness (from an adversarial review):

  - `RoleMembershipStore.removeAccessRuleMappings` (plugin-deregister cleanup) now
    also evicts the anonymous-access-rules entry, since a removed rule may have
    been granted to the anonymous role.
  - `access-rule-sync`'s boot `fullSync` now evicts the affected shared entries
    when a default-rule change actually mutates a non-admin role's grants - a later
    pod's boot / a redeploy runs it against a cache the cluster already warmed, so
    the old "runs against a cold cache" assumption no longer holds under the shared
    cache. An idempotent no-change sync evicts nothing.
  - The batched `role -> access-rule ids` read now runs through
    `CachedScope.wrapManyBatched`, so it carries the same epoch guard as the
    single-key path: a role-rules revoke racing an in-flight load can no longer be
    clobbered by the loader's stale write.

  BREAKING CHANGE: the internal cache-invalidation hooks
  `authHooks.roleAccessRulesInvalidated`, `authHooks.userRolesInvalidated`, and
  `coreHooks.anonymousAccessRulesInvalidated` are removed, along with their
  per-pod broadcast subscribers. They existed only to keep the old per-pod caches
  coherent; the shared cache makes them redundant. These were internal signals,
  never a plugin-facing extension contract. `@checkstack/auth-common` now exports
  `AUTH_CACHE_PLUGIN_ID` and `ANONYMOUS_ACCESS_RULES_CACHE_KEY` so `core/backend`
  and `auth-backend` agree on the shared scope + key for the anonymous entry.

### Patch Changes

- @checkstack/healthcheck-common@1.16.1

## 0.31.1

### Patch Changes

- 43e4484: Add a database query profiler to the OpenTelemetry/Prometheus metrics layer.

  Two new scoped-db duration histograms answer "how long do queries take, and how long is a connection held", labelled by BOUNDED attributes only:

  - `checkstack.db.query.duration` (`schema`, `operation`) — wall-clock of a standalone scoped query (`BEGIN` + `SET LOCAL search_path` + query + `COMMIT`), recorded at the scoped-db proxy seam for every `.then`/`.execute`/`$count` path.
  - `checkstack.db.transaction.duration` (`schema`) — connection-hold time of a `withScopedTransaction` batch, the guard against a batch pinning a pooled connection (e.g. slow non-DB work wrapped in a transaction).

  For the per-statement drill-down (which exact SQL is hot, not just which operation kind), the host optionally exports Postgres' `pg_stat_statements` view: `checkstack.db.statements.{calls,exec_time_ms,rows}` counters plus a `mean_exec_time_ms` gauge, bounded to the top-N statements by total execution time (`CHECKSTACK_DB_STATEMENTS_TOP_N`, default 25). It is self-disabling: when metrics are enabled the backend probes the connected database once and, if `pg_stat_statements` is not active (extension absent or the role cannot read the view), registers nothing and logs a single info line — a clean no-op with zero cost. The whole layer remains off unless `CHECKSTACK_METRICS_ENABLED` is set.

  The `@checkstack/ai-backend` bump is the regenerated docs search index reflecting the expanded observability page.

- 43e4484: Link the "Checkstack" wordmark in email notification footers to
  https://checkstack.dev.

  The footer text ("This is an automated notification from Checkstack.") now
  renders "Checkstack" as a link to the public site. The footer string is still
  HTML-escaped first and only the trusted anchor is injected, so a custom footer
  cannot introduce markup; a custom footer that does not mention "Checkstack" is
  left untouched.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/healthcheck-common@1.16.0

## 0.31.0

### Minor Changes

- f93ee7a: Fuse authorization into the RPC call so a frontend gate can't drift from - or be
  forgotten alongside - the procedure it guards. This is the structural endpoint of
  the contract-derived gating work: instead of pairing `client.X.useMutation()` with
  a separate `useProcedureAccess(X)`, the gate is welded to the call.

  - `useGatedMutation` / `useGatedQuery` (`@checkstack/frontend-api`): the plugin
    client's mutation/query hooks now have gate-fused variants that derive the
    authorization verdict from the SAME contract procedure and input the call uses
    and return it as `{ allowed, accessLoading }` on the result. A control cannot
    obtain `mutate` without the verdict, and a gated query stays disabled until the
    caller is authorized (no guaranteed-403 fetch). The id a mutation gates on is
    passed as `gateInput` (e.g. `{ id }`), the same id `mutate` will send.
  - `accessApi.useSurfaceAccess(procedure)` (`@checkstack/auth-frontend`): the
    coarse "can the user reach this management surface" gate, DERIVED from a
    representative procedure of the page (its access rule + object/parent type from
    the contract) instead of hand-passed `objectType`/`parentType` that can drift.
    Generalizes the hand-authored `useCanAccessType` surface gate.
  - Runtime gating-drift detector (`@checkstack/backend-api`): the auth middleware
    logs, in dev/e2e only (no-op in production), when a real user is denied a
    global-only gate - a candidate for the "shown-but-denied" drift class. A
    belt-and-suspenders net for hand-rolled/dynamic call paths the fused hooks
    don't cover.

  The automation editor is the reference surface: its create/update gates are fused
  directly into the create/update mutations, so there is no separate gate hook to
  keep in sync, and its surface gate uses `useSurfaceAccess`. The run-detail page's
  "Cancel run" control is also fused onto
  `cancelRun` - a real drift fix: it previously gated on a bare
  `useAccess(automation.manage)` (the GLOBAL rule), so a team-scoped manager with a
  grant on the automation but no global rule saw no Cancel button even though the
  `parentScope`d backend would authorize them; the fused gate derives the verdict
  from the page's `automationId`, so they now see it. A
  `checkstack/prefer-gated-mutation` lint rule (dev tooling, scoped, `warn`) nudges
  raw `.useMutation()` toward the fused variant so fusion is the default and raw
  mutations become the deliberate, greppable exception (the remaining raw automation
  mutations - per-row toggle/delete gated via `useResourceAccess`, and the
  stateless `renderTemplate` utility - carry a documented suppression).

  No behavior change for existing call sites: `useMutation` / `useQuery` /
  `useCanAccessType` are unchanged and remain for per-row arrays, non-procedure
  gates, and compound controls.

- d0eddc9: Cut the per-tick database work of the health-check executor by batching
  scoped-database queries, and fix a dashboard "Recent activity" rendering bug.

  The scoped-database proxy has to wrap every standalone query in its own
  transaction so `SET LOCAL search_path` applies to it, which means a hot path
  issuing many sequential queries pays the `BEGIN` / `SET LOCAL` / `COMMIT`
  round-trips once per query and checks a connection out that many times. Two
  changes remove most of that overhead on the health-check path:

  - **New `withScopedTransaction` helper (`@checkstack/backend-api`).** A reusable
    primitive for running several scoped queries under a SINGLE `SET LOCAL
search_path` transaction, plus `ScopedTransaction` / `ScopedQueryRunner`
    types so a helper can accept either the scoped db or a transaction handle.
    Use it on any scoped-db hot path that issues 2+ queries in sequence.
  - **`getSystemHealthStatus` is now batched.** It was a `1 + N` read fan-out (one
    associations query, then one run-window query per enabled check) run as `1 +
N` separate proxy transactions. It now runs as ONE transaction. This is the
    hottest read on the platform - each check tick reads it several times, and the
    dashboard, RPC router, and AI system-signals all call it - so the reduction in
    transaction volume and connection churn is broad. The reads are also now a
    single consistent snapshot.
  - **The executor's run + aggregate writes are batched.** Each persisted run
    previously issued the run `INSERT`, the aggregate `SELECT`, and the aggregate
    `UPSERT` as three separate proxy transactions; they now run in one
    transaction and commit atomically (the run and the aggregate it feeds can no
    longer be persisted apart).

  Behaviour is unchanged: the derived health status, transition detection, and
  signals are identical; only the number of database transactions per tick drops.

  Also fixes a dashboard bug where the "Recent activity" feed generated React keys
  from `configurationName` plus a millisecond timestamp, so results from different
  systems sharing a check name that completed in the same millisecond collided on
  one key and React mis-reconciled the list (visually duplicated/omitted entries).
  Keys are now derived from the system, configuration, and environment ids.

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

- f93ee7a: Fix a 403 that blocked team-scoped health-check managers from opening the
  health-check editor.

  The editor's utility endpoints (`healthcheck.getStrategies`,
  `healthcheck.getCollectors`, `healthcheck.testCollectorScript`, and the
  script-package SDK/type endpoints) were gated with `instanceAccess: { global:
true }` or a separate global `script-packages.read` rule. A `global: true` gate
  is enforced ONLY against a caller's global access rules - team grants never
  satisfy it - so a user who could manage a health check through a team grant, but
  did not hold the global `healthcheck.configuration.read` rule, got a 403 on the
  metadata endpoints the editor needs and could not open it.

  New `typeScoped` instanceAccess mode. A no-instance utility/catalog endpoint can
  now be gated by ANY team grant of its resource type (or the global rule): a
  `viewer`/`editor`/`owner` grant on any instance, or a `creator`
  (create-capability) grant so a team member who may CREATE the type can open its
  authoring UI before owning an instance. `healthcheck.getStrategies` /
  `getCollectors` use it at read level; `testCollectorScript` at manage level.
  Backed by an `includeCreator` option threaded through `hasAnyTypeGrant`
  (store -> auth S2S contract -> `AuthService`), so the create-capability path is
  counted only where intended (the list/record post-filter keeps its old
  semantics). The boot validator recognises `typeScoped` as one of the mutually
  exclusive modes.

  Script-package authoring endpoints relaxed to authenticated. `getInstallState`
  and the two raw type routes (`/api/script-packages/sdk-types/:version` and
  `/api/script-packages/types/:hash/:spec`) now require only authentication, not
  the global `script-packages.read` grant. They serve IntelliSense metadata
  (installed package inventory, `.d.ts` closures, the `@checkstack/sdk` bundle) -
  no secrets - which any script author, including a team-scoped health-check
  manager, needs. The install/registry MANAGE endpoints stay restricted.

  Why the team-permission guards did not catch this: `check:manage-capabilities`
  only covers management routes/nav, not the procedures a page calls; the boot
  conformance validator treats `global: true` as a deliberate, valid "not
  team-scoped" marker and cannot tell it is actually a dependency of a
  team-scopable editor flow. The RLAC rule now documents `typeScoped` as the
  correct mode and warns against `global: true` for endpoints a team manager
  needs.

### Patch Changes

- d0eddc9: Rework health-check scheduling to one recurring job per
  `(configuration, system, environment)` slice and add a slow-check bulkhead so a
  slow or unreachable check can no longer starve the healthy ones.

  Previously a single recurring job per `(configuration, system)` fanned out over
  every environment sequentially inside one tick, so the job held a concurrency
  slot for the sum of all its environments, and a slow environment stalled its
  siblings. Now each environment slice is its own recurring job that holds a slot
  only for its own probe. A convergence reconciler (k8s-controller style) derives
  the desired per-env job set from Postgres + catalog membership and converges the
  queue toward it (schedule missing, cancel orphans, reschedule interval changes),
  so it is self-healing across pods and stays correct as catalog membership
  changes. It runs at boot, and system-scoped after an assignment or GitOps
  change. `run_now` enqueues one one-off job per effective environment.

  The system rollup (the bare `<systemId>` health entity every badge, SLO rule and
  dependency map reads) is recomputed by an event-driven, debounced consumer that
  subscribes to per-environment health changes and recomputes once per system per
  window, instead of inline on every tick. Notifications stay owned by the
  per-environment runs, so the rollup notification is structurally deduplicated.

  The bulkhead classifies each slice's recent runs: a slice whose last K runs were
  slow transport failures (held its slot ~the full timeout) is admitted to a
  capped, pod-local lane (single-flight per slice) and probed with a timeout shrunk
  toward its own healthy-latency baseline, or DEFERRED (recording nothing, freeing
  the slot) when the lane is full or a prior run is still in flight. The adaptive
  timeout has four deadlock guardrails: no baseline means no shrink, the baseline
  uses only healthy runs, every Nth suspect run re-probes at the full timeout, and
  an absolute floor. A healthy slice is never gated and always runs at the full
  timeout. A new `checkstack.healthcheck.deferred{reason}` counter records
  bulkhead deferrals.

  Measured with the scale harness (240 checks, 20% unreachable, concurrency 10, 5s
  timeout, 35s): with the bulkhead off the queue backlog climbs unbounded to 774
  while 60 slow checks pin slots; with it on the backlog stays bounded (drains to
  0), completions roughly triple (288 → 862), and slot-pinning timeouts drop
  (60 → 12) as 207 suspect runs are deferred.

  `@checkstack/test-utils-backend` gains a `withTransactionMock` helper that adds a
  `.transaction(cb)` passthrough to a mock database, so tests can exercise code
  that batches reads/writes through `withScopedTransaction`.

  BREAKING CHANGE: the internal `HealthCheckJobPayload` now requires an
  `environmentId` field and recurring health-check job IDs are per-environment
  (`healthcheck:<config>:<system>[:<env>]`). This is an internal queue contract
  with no external package API surface; on upgrade the reconciler cancels the
  old-format jobs and schedules the per-environment set at boot.

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/queue-api@0.3.19
  - @checkstack/signal-common@0.2.17
  - @checkstack/template-engine@0.4.11

## 0.30.0

### Minor Changes

- 390d9cf: Add a **Container** health-check strategy for monitoring Docker and Podman
  containers that expose no external service of their own. It reports container
  existence, running state, healthcheck status, exit code, restart count, and
  OOM-killed via the **Container Status** collector, and CPU/memory usage via the
  **Container Stats** collector. Both collectors issue only read (GET) requests
  against the runtime REST API.

  The check runs wherever the executor runs: locally on the core instance (the
  default) to watch containers that share a host with Checkstack, or on a
  satellite pinned to another host.

  Critically, Checkstack never touches the raw container socket. The strategy
  talks the Docker Engine / Podman libpod API over either a unix socket path or an
  `http(s)` endpoint, so operators point it at a **read-only socket-proxy**
  (`lscr.io/linuxserver/socket-proxy` with `POST=0`) running next to whichever
  Checkstack instance runs the check - core or a satellite - or at a rootless
  Podman socket. The raw socket is mounted only into the proxy; even a compromised
  instance can only read container state, never control the host. A stopped or missing container is a successful collection whose metrics
  feed assertions (following the transport-failure-vs-metric rule) - only an
  unreachable runtime endpoint fails the check. Container `exec` probes are
  intentionally not offered because they would require write access to the socket.

  To support in-product setup guidance, the health-check strategy contract gains
  an optional `setupInstructions` (Markdown) field, surfaced in the DTO and
  rendered as a collapsible "Setup guide" callout above the strategy config fields
  in the editor. The Container strategy populates it with the secure proxy setup.

  The hardened socket-proxy compose is maintained as a single canonical file
  (`deploy/socket-proxy/docker-compose.yml`) that operators `include:` from their
  core or satellite compose, so the read-only / `POST=0` / internal-network
  hardening is defined in exactly one place; the docs and the in-product setup
  guide reference it rather than duplicating the YAML.

  Also removes a stale hand-written `HealthCheckStrategyDto` interface in
  `@checkstack/healthcheck-common` that shadowed (and lagged behind) the
  Zod-inferred DTO; the inferred type from `schemas.ts` is now the single source
  of truth and correctly carries `resultSchema`, `aggregatedResultSchema`, and the
  new `setupInstructions`.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  that shaped this release.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
  - @checkstack/healthcheck-common@1.14.0

## 0.29.1

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/cache-api@0.3.18
  - @checkstack/queue-api@0.3.18
  - @checkstack/signal-common@0.2.16
  - @checkstack/template-engine@0.4.10

## 0.29.0

### Minor Changes

- faf98f5: Security: config secrets (health-check strategy/collector credentials such as
  SSH passwords, DB credentials, HTTP auth, and integration connection
  credentials) ride ONE shared, domain-agnostic extraction channel instead of
  being stored as plaintext or re-implemented per plugin.

  New primitive and shared service:

  - `configSecret({ id })` (in `@checkstack/backend-api`) declares an
    extraction-channel secret keyed by a STABLE `id`, independent of field name or
    position, so renaming or reordering a field never orphans its value. Use it
    (not `configString({ "x-secret": true })`) for any credential whose config is
    relayed to a satellite, projected to AI, or diffed by GitOps. `validateSecretIds`
    rejects, at plugin registration, an `x-secret` field with no `id`, a duplicate
    `id`, or a secret nested in an un-keyable container (array / record / tuple /
    map) - so a mis-keyable schema fails boot rather than at run time.
  - `ConfigSecretChannel` (in `@checkstack/secrets-backend`) is the single
    extract / inflate / collect / redact / merge / delete / prune implementation.
    Health-checks and integration connections both BIND it to their own scope
    (marker prefix + internal-secret key layout); neither re-implements the walk.

  Lifecycle (both bindings):

  - **Write**: an inline value is extracted into the encrypted internal secret
    store; the stored config keeps only an opaque marker. `${{ secrets.NAME }}`
    references are stored verbatim and resolve through the active backend (local
    or Vault) at run time.
  - **Read**: configuration and connection reads strip `x-secret` values and
    internal markers while keeping `${{ secrets.NAME }}` references visible; the
    AI `getConfigurations` tool and create/update responses are redacted too. A
    value never reaches a browser or an AI model context.
  - **Run**: the core executor inflates markers/references in memory just before
    the client is built. Satellites receive markers only and fetch values
    just-in-time over the authenticated WS channel, per run, never persisted, then
    fail CLOSED if any marker/reference survives resolution.
  - **No orphan**: clearing a secret, removing a field/collector, swapping an
    inline value for a reference, updating a connection, or deleting a
    configuration/connection deletes the now-unreferenced internal secret. Cleanup
    is schema-free (scans markers by prefix) and best-effort on delete, so it works
    even when the owning plugin is uninstalled and never blocks a delete.
  - **Forged-marker safe**: extract/inflate key each internal secret by the
    SCHEMA leaf's stable `id`, never by an id parsed out of a stored marker string,
    so a crafted marker can never resolve or delete another scope's secret.

  Health-checks additionally get an idempotent, advisory-locked backfill that
  moves pre-existing plaintext values into the internal store, and per-config-id
  locking so concurrent writers across pods can never leave a dangling marker.
  Integration connection credentials keep their released `__connref__:` marker
  prefix and key layout (id equals the flat field name), so existing stored
  connections are byte-compatible.

  BREAKING CHANGES:

  - Configuration and connection reads no longer include `x-secret` field values
    (clients must treat blank-on-save as keep-existing; the bundled editors
    already do).
  - Satellites must be upgraded together with the core: an old satellite cannot
    resolve the markers a new core stores, so its credentialed checks fail until
    upgraded.

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/cache-api@0.3.17
  - @checkstack/queue-api@0.3.17
  - @checkstack/signal-common@0.2.15
  - @checkstack/template-engine@0.4.9

## 0.28.0

### Minor Changes

- e819276: Fix JSONPath collector assertions: the executor previously evaluated every
  assertion with a flat field lookup, so a `Body (JSONPath)` assertion compared
  against `undefined` and the configured path was silently ignored (`Exists`
  always failed, `Not Exists` always passed). The executor now parses the source
  field as JSON and extracts the configured path via `jsonpath-plus` (with
  expression evaluation disabled - filter/script expressions are rejected).
  Fail-closed: a non-JSON body, missing expression, or invalid path fails the
  assertion with a diagnostic, never the collection.

  Also adds `isEmpty` / `isNotEmpty` to the JSONPath operator set (and the
  AssertionBuilder), treating `[]`, `{}`, `""`, and missing values as empty - so
  "no errors reported" is a single `$.errors Is Empty` assertion, and "key exists
  but is empty" is `Exists` + `Is Empty` on the same path.

## 0.27.1

### Patch Changes

- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0

## 0.27.0

### Minor Changes

- e430fbe: Add "Mass delete" and "Mass resolve" to the Incidents and Maintenances lists,
  authorized per item (RLAC).

  The incidents and maintenances list pages now support multi-select with a bulk
  action bar. A user may only select and act on entries they are allowed to
  MANAGE: a row's checkbox appears only when the caller can manage it (the same
  `canAccess(id)` gate as the per-row actions), so a team-scoped member sees
  checkboxes only for their team's entries. Mass delete confirms before running;
  mass resolve (incidents) and mass complete (maintenances, the "resolve"
  equivalent = close, status -> completed) skip entries that are already
  resolved/completed. Each action reports a per-id partial-success summary
  (e.g. "3 deleted, 1 skipped").

  New backend procedures: `incident.bulkDeleteIncidents`,
  `incident.bulkResolveIncidents`, `maintenance.bulkDeleteMaintenances`, and
  `maintenance.bulkCloseMaintenances`. Each authorizes EACH id against the
  caller's manage grant and never fails open: unauthorized ids are filtered out
  before the handler runs and returned as `forbidden`; missing ids as `notFound`;
  a per-id failure is isolated as `error` without aborting the batch. Per-id cache
  invalidation, realtime signals, and subscriber notifications run for every
  success so dashboards and status pages stay consistent.

  Platform: a new `instanceAccess` mode `bulkManage: { idsParam }` is the
  enforcement point for bulk writes. Before the handler runs, `autoAuthMiddleware`
  partitions the input id array into the caller's manageable subset and the denied
  remainder and exposes both on `context.bulkAccess` (fail-closed on an S2S
  error). The boot-time contract validator (`validateContractInstanceAccess`)
  accepts `bulkManage` as one of the mutually-exclusive scoping modes, marks its
  type team-scopable, and cross-checks `idsParam` against the input schema.

  State and scale: authorization is derived per request from the shared team-grant
  store via the existing auth S2S path (no process-local state); the read returns
  the same answer on every pod. No database migration.

- eab80e3: Add an instance-namespace runtime mode so a secondary backend instance can run
  alongside the default one on shared external infrastructure without colliding.

  - `@checkstack/backend-api` now exposes `coreServices.instanceRuntime`
    (`InstanceRuntime { namespace, isDefault }`) plus `parseInstanceNamespace` /
    `createInstanceRuntime` / `instanceNamespaceSchema`. The core backend reads
    `CHECKSTACK_INSTANCE_NAMESPACE` at boot (validated, failing fast on a bad
    value), registers the service, and advertises a non-empty namespace on
    `/api/config`.
  - Plugin-author contract: a plugin that keeps state on infrastructure SHARED
    across instances (redis key space, shared cache prefix, consumer group, topic)
    MUST fold `instanceRuntime.namespace` into that key/name. Namespace rather than
    suppress: user-visible behaviour keeps running in a secondary instance, only
    the shared keys change. See the new "Parallel instances and namespacing"
    developer-guide page.
  - `@checkstack/queue-bullmq-backend` is the reference implementation: it folds
    the namespace into the effective redis key prefix (`checkstack:` becomes
    `checkstack:preview:` under the `preview` namespace), isolating queues, jobs,
    schedulers and consumer groups. The default instance's prefix is byte-for-byte
    unchanged.
  - The admin frontend shows a slim "preview instance" banner when the runtime
    config carries a non-empty `instanceNamespace`.

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/common@0.19.0
  - @checkstack/cache-api@0.3.16
  - @checkstack/queue-api@0.3.16
  - @checkstack/signal-common@0.2.14
  - @checkstack/template-engine@0.4.8

## 0.26.1

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/cache-api@0.3.15
  - @checkstack/queue-api@0.3.15
  - @checkstack/signal-common@0.2.13
  - @checkstack/template-engine@0.4.7

## 0.26.0

### Minor Changes

- 2e20792: Serve public status pages from the lean bundle, and stop the SPA entry pulling the whole UI kit

  Public status pages used to render inside the full admin app on same-origin
  paths, so opening one booted every plugin (and its eager slot components) and the
  entire `@checkstack/ui` barrel.

  - **Lean public bundle for public paths.** New platform extension point
    `publicPathExtensionPoint` lets a plugin declare same-origin public path
    prefixes; the backend advertises them via `/api/config` and the inlined boot
    blob. The SPA entry now loads the minimal public bundle (no admin app, no
    plugin loader, no eager plugin components) for those paths, driving the slug
    from the URL. A status page no longer loads any admin frontend code.
  - **Entry no longer imports the `@checkstack/ui` barrel.** `ThemeProvider` /
    `DensityProvider` moved from `main.tsx` into each bundle's root (`App` and
    `public-app`), cutting the critical-path preload from ~280 KB to ~0.5 KB gz on
    both bundles (the barrel now loads only inside the bundle that needs it).
  - **public-app provider fix.** Added the missing `ToastProvider` (required by
    `PerformanceProvider`) so the public bundle renders standalone.
  - **Local plugins load as parallel chunks.** The bundled plugins moved from one
    eager `import.meta.glob` chunk to per-plugin lazy chunks downloaded in
    parallel. They are still registered before first render (the shell chrome
    depends on plugin-contributed APIs such as the auth plugin's `auth.api`), and
    remote plugins continue to load after first paint and register reactively.
  - **Tree-shakeable barrels.** `@checkstack/ui`, `auth-frontend`,
    `command-frontend`, `signal-frontend`, and `announcement-frontend` now declare
    `sideEffects` (CSS only), so importing one provider/hook no longer drags a
    whole package's components into the shell. `AnnouncementBanner` also lazy-loads
    its Markdown renderer, keeping ~98 KB of react-markdown out of first paint.

  BREAKING CHANGE: status-page route ids now match the `statuspage` plugin id (the
  frontend route registry requires this). URLs change: the admin builder moves from
  `/status-pages` to `/statuspage` (and `/status-pages/:id` to `/statuspage/:id`),
  and the public page moves from `/status/:slug` to `/statuspage/view/:slug`. Update
  any bookmarks or external links to published status pages.

### Patch Changes

- Updated dependencies [2e20792]
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/cache-api@0.3.14
  - @checkstack/common@0.17.0
  - @checkstack/queue-api@0.3.14
  - @checkstack/template-engine@0.4.6

## 0.25.0

### Minor Changes

- 8cad340: fix(security): crypto + auth depth hardening (at-rest encryption, brute-force scale, token timing)

  Three concrete defects found and fixed during the deferred crypto + auth depth audit:

  - **At-rest encryption (`@checkstack/backend-api`)**: AES-256-GCM decrypt now
    rejects values whose IV is not exactly 12 bytes or whose auth tag is not the
    full 16 bytes (128-bit). GCM accepts truncated tags, which weaken forgery
    resistance; the encryptor only ever emits full tags, so short tags now hard-
    error instead of being silently accepted. `isEncrypted` is also tightened to
    require the exact decoded IV/tag lengths, not just a loose
    `base64:base64:base64` shape, so a plaintext secret that merely resembles the
    shape can no longer be misclassified as "already encrypted" and stored in
    plaintext. The unique-nonce and tamper-rejection guarantees are now covered by
    regression tests.

  - **Brute-force protection scale bug (`@checkstack/auth-backend`)**: better-auth's
    built-in rate limiter (sign-in, password reset) defaulted to per-pod in-memory
    storage. With N replicas behind one database that multiplied the effective
    limit by N (state-and-scale §14.5). The limiter is now backed by a shared
    `better_auth_rate_limit` Postgres table via a `customStorage` adapter, so the
    counter is global across all pods. Adds a new append-only migration for the
    table. No behaviour change in local dev (limiter stays off when not in
    production); no configuration required.

  - **Satellite token timing oracle (`@checkstack/satellite-backend`)**:
    `validateToken` previously skipped the bcrypt verify when the `clientId` did
    not exist, leaking client-ID existence via response timing. It now always
    verifies the supplied token (against a decoy hash when the row is missing) so
    the missing-clientId path costs the same as the wrong-token path.

  Audited and found clean (no change needed): the better-auth cookie/session/CSRF
  posture (`httpOnly`, `sameSite=lax`, `Secure` derived from the https `BASE_URL`,
  single trusted origin, fresh session on internal trusted-login), and
  token/secret logging hygiene across the auth, satellite, and secrets paths (no
  secret material is logged).

- 8cad340: Encryption key rotation support plus fail-loud secret decryption.

  Non-breaking: existing single-key (`ENCRYPTION_MASTER_KEY` only) setups keep
  working unchanged. The ciphertext format (`iv:authTag:ciphertext`, AES-256-GCM)
  is unchanged - no key-id prefix - so old values stay decodable.

  - **Multi-key decryption for rotation.** `decrypt()` now trial-decrypts with the
    primary `ENCRYPTION_MASTER_KEY` first, then each key in the optional
    comma-separated `ENCRYPTION_MASTER_KEY_PREVIOUS` list, in order. Only when ALL
    configured keys fail the GCM tag does it raise the hard error. New encryption
    always uses the primary key. Every key is validated (32-byte hex) with zod;
    key material is never logged.
  - **Fail-loud, fail-closed decrypt in `ConfigService`.** Previously a failed
    decrypt silently substituted the raw CIPHERTEXT in place of the plaintext
    secret, so downstream consumers used ciphertext as the secret and operators
    never learned decryption broke. Now the failure is surfaced via the structured
    `Logger` at error level (with the config key and plugin, never the secret or
    ciphertext) and a typed `DecryptionError` is thrown, failing the whole config
    read so the operator sees it. A new exported `DecryptionError` type lets
    callers detect this.
  - **Re-encryption tooling.** New `bun run --filter @checkstack/backend
reencrypt-secrets` command (and reusable `reencryptAllSecrets` helper) walks
    the local secret backend `secrets` table and config-service `x-secret` fields
    in `plugin_configs`, decrypts each value with whichever configured key
    authenticates, and re-encrypts it onto the current primary key. After running
    it with zero failures, the operator can safely drop the demoted key from
    `ENCRYPTION_MASTER_KEY_PREVIOUS`. External backends (e.g. Vault) are out of
    scope - rotate those through their own mechanism.

  No schema change. State note: all encrypted state lives in shared Postgres
  (`secrets`, `plugin_configs`); reads return the same answer on every pod because
  key resolution and trial-decryption are pure functions of the env-configured
  keys and the stored ciphertext.

- 8cad340: feat(healthcheck-http): SSRF egress guard for the in-process HTTP collector

  The HTTP healthcheck strategy runs in-process on the trusted core (whenever a
  check is local or not satellite-only), so it now applies a secure-by-default
  egress guard before connecting:

  - Denies the cloud-metadata + link-local ranges by default (the same
    `ALWAYS_BLOCKED_CIDRS` the script sandbox enforces), so a check can no longer
    be pointed at `http://169.254.169.254/...` to read instance credentials.
  - Keeps RFC1918 / internal probing ALLOWED by default (a monitoring tool's job).
  - Resolves the target host to IP(s) and checks the CONNECTED IP, pinning the
    request to the validated IP to resist DNS-rebind.
  - Operator-extensible: the new optional `egressDenyCidrs` field on the HTTP
    strategy config adds further CIDRs on top of the always-on block.

  `@checkstack/backend-api` exports a reusable `resolveAndValidateHost` /
  `pinUrlToIp` SSRF guard plus `DEFAULT_EGRESS_DENY_CIDRS`.

- 8cad340: Add a finer per-run transport timing breakdown to health checks.

  Each run now records an optional structured `metadata.timings` (DNS, connect,
  TLS, wait/time-to-first-byte, transfer, and a `processing` catch-all for
  non-HTTP operation time). The run-detail view renders the phases it has, in
  transport order, and falls back to the previous Connection + Processing split
  for older runs that lack the finer data.

  For HTTP the request is issued verbatim through `fetch` (original URL, headers,
  and body), so request behavior is identical to a plain `fetch`. The timing is
  measured around it: `fetch` resolves at the response headers, so wait
  (time-to-first-byte) and transfer (body) are measured exactly on the request,
  DNS is timed at the resolve step, and connect/TLS come from a short-lived,
  best-effort raw `net`/`tls` probe to the same already-validated IP (the request
  socket exposes no connect/handshake events on the Bun runtime). The probe is
  timing-only and never fails the check. The probe validates the TLS certificate
  (against the original hostname via SNI) like the real request does - it does not
  disable certificate validation; an unverifiable cert simply yields no TLS-phase
  timing rather than aborting. Other transports surface the connect and operation
  times they already measure.

  The SSRF guard now validates the resolved host (rejecting cloud-metadata /
  link-local and operator-denied ranges) as a pre-flight check and no longer pins
  the request to the resolved IP. Pinning rewrote the URL to the IP literal and
  moved the host to the `Host` header, which breaks HTTP/2 origins (their
  authority comes from the URL's `:authority`, not `Host`) - that is why real
  hosts such as `google.com` started answering 404/429 instead of 200. The
  pre-flight validation keeps blocking static metadata/link-local targets and
  direct denied IP literals; the only thing dropped is DNS-rebind TOCTOU
  protection (a narrow window that pinning closed at the cost of breaking
  legitimate HTTP/2 requests).

  The run-detail "slowest" badge no longer collides with the timing bar, and a
  genuinely sub-millisecond phase reads as "<1 ms" instead of a bare "0 ms".

### Patch Changes

- 8cad340: fix(backend-api): sanitize notification email HTML

  `markdownToHtml()` now sanitizes its output with an email-safe allow-list before
  returning. Notification bodies can be influenced by operator- or user-controlled
  content (incident titles/descriptions, integration payloads), and `marked` does
  not sanitize, so the rendered HTML could previously carry `<script>`, `on*`
  event-handler attributes, or `javascript:`/`data:` URLs into an email body.

  The sanitizer keeps ordinary formatting (emphasis, lists, tables, code,
  headings, and `http`/`https`/`mailto` links) and removes anything executable,
  matching the intent the frontend already enforces with `rehype-sanitize`. A new
  `sanitizeEmailHtml()` helper is exported for reuse.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/cache-api@0.3.14
  - @checkstack/queue-api@0.3.14
  - @checkstack/signal-common@0.2.11
  - @checkstack/template-engine@0.4.6

## 0.24.1

### Patch Changes

- 2ec8f64: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `hono` 4.12.23 → 4.12.25 (CVE-2026-54286, CVE-2026-54287, CVE-2026-54288, CVE-2026-54289, CVE-2026-54290)
  - `nodemailer` 9.0.0 → 9.0.1 (GHSA-p6gq-j5cr-w38f)
  - `dompurify` 3.4.3 → 3.4.11 (CVE-2026-49458, CVE-2026-49459, CVE-2026-49978, GHSA-76mc-f452-cxcm, GHSA-cmwh-pvxp-8882)
  - `protobufjs` 7.5.8 → 7.6.3 (CVE-2026-48712, CVE-2026-54269)
  - `undici` 7.24.7 → 7.28.0 (CVE-2026-9678, CVE-2026-9697)

## 0.24.0

### Minor Changes

- b1a5f3c: Status pages: first-class custom domains with a locked-down public surface.

  A published status page can now be served on its own host (e.g. `status.acme.com`),
  isolated from the admin UI at three layers:

  - **Data.** A new platform extension point (`publicHostResolverExtensionPoint` in
    `@checkstack/backend-api`) lets the owning plugin map an incoming `Host` to a
    published page. On a matched custom domain, a core host-routing middleware
    serves ONLY the single public read (`getPublishedStatusPage`), `/api/config`,
    the public bundle's assets, and the on-demand-TLS hook. Every other `/api/*`,
    all of `/rest/*`, the admin docs, and the platform endpoints
    (`/.checkstack/*`, `/.well-known/jwks.json`) return 404. `/api/config` returns
    the custom domain itself as `baseUrl`, so the bundle's RPC client can only
    call back into the same locked-down origin - never the admin origin.
  - **Code.** The custom-domain host loads a separate minimal public bundle that
    ships none of the admin app (no sidebar, auth, signals, command palette, or
    plugin loader). The frontend entry checks `/api/config` first and dynamically
    imports only the public bundle on a public host, so the admin chunk is never
    fetched there.
  - **Ownership.** Domains are added in the builder, verified via a DNS TXT record
    (`_checkstack-verify.<domain>`), and route only once verified AND published.
    An `/.well-known/checkstack/authorize-domain` hook lets an on-demand-TLS edge
    (Caddy, Cloudflare for SaaS, cert-manager automation) mint certificates only
    for verified domains. TLS is terminated at the edge, matching how the platform
    already serves its primary domain.

  Builder gains a Custom domain panel (set / verify / remove + DNS instructions).

  Widget renderers are now pluggable too. A plugin that contributes a backend
  widget type can ship its frontend renderer with `defineStatusWidgetRenderer`
  (in `@checkstack/status-page-common`) via its `extensions[]`; the status-page
  frontend resolves each block's renderer by id, merging built-ins (which win on a
  clash) with plugin-contributed ones. Previously only the built-in renderers
  existed, so a third-party widget type had no way to draw on a page.

  Third-party renderers work on custom domains too. A backend widget type can
  declare `rendererRemote` (its frontend npm package); the published-page response
  then lists exactly the renderer remotes that page needs, and the minimal
  custom-domain bundle loads only those on demand via Module Federation. The set
  is derived from the page's widget types (operator-controlled, never visitor
  input) and the loaded code is the operator's own trusted plugin, so it does not
  widen the data surface (the only reachable data endpoint on a public host is
  still the single public read).

  Hardening (from review): WebSocket upgrades are gated on custom-domain hosts
  (they bypass the HTTP middleware), so no socket endpoint is reachable there;
  custom domains route ONLY `public`-visibility published pages (an
  `authenticated` page never routes nor leaks its slug); `setCustomDomain` rejects
  the platform's own host, IP literals, and internal suffixes; and the host-lookup
  cache is size-bounded against unique-host floods. The host-routing decision is
  unit-tested.

  NOT breaking. New `status-page-common` contract procedures (`setCustomDomain`,
  `verifyCustomDomain`, `removeCustomDomain`) and `customDomain*` columns on the
  `status_pages` table (additive migration).

  (`@checkstack/ai-backend` is a patch only: its generated docs index now includes the custom-domain documentation.)

### Patch Changes

- @checkstack/healthcheck-common@1.7.1

## 0.23.0

### Minor Changes

- d2077bd: Platform-wide team-scoped access control on a unified relation-tuple store.

  Admins can scope any resource to teams, and the **platform** (not each plugin)
  enforces it. A plugin opts in declaratively by adding `instanceAccess` to a
  procedure's contract; the auth middleware does the rest, so enforcement is
  consistent across catalog, health checks, incidents, maintenances, SLOs,
  automations, and the dependency map, and any third-party plugin gets it for free.

  Core model:

  - **Teams are optional.** A resource with no team grants behaves exactly as
    before.
  - **Team grants are additive and restrict who can CHANGE a resource, not who can
    SEE it.** Granting a team `Manage` lets its members view and change the
    resource; `Read-only` lets them view it. Either level grants access to team
    members **even when they lack the global permission**, and granting never
    removes read from anyone who already had it (e.g. a public status page stays
    readable). Privacy is a separate, explicit opt-in via the **Private** toggle,
    which removes the global read path so only the resource's teams can see it.
  - **Ownership at creation.** Create forms expose an **Owning team** picker. A
    non-admin can create a resource for a team they belong to that holds a
    create-capability grant for that type; the new resource is auto-granted to that
    team. Incidents and maintenances are **parent-gated**: anyone who can manage a
    system may open incidents/maintenances for it, no separate grant needed.
  - **Meaningful authorization errors.** A caller with neither the global rule nor
    any team grant for a resource type gets a `403` with a structured body instead
    of a silently-empty `200`. Anonymous callers on public endpoints are never
    `403`'d, so status pages keep rendering.

  Unified relation-tuple store:

  - The previously separate access primitives (`resource_team_access.canRead` /
    `.canManage`, ownership, `resource_access_settings.teamOnly`, and
    `resource_create_grant`) are collapsed onto ONE
    `relation_tuple(object, relation, subject)` store: "a team has
    `viewer`/`editor`/`owner` on an object, or `creator` on a type". Privacy is an
    explicit **`private` marker** tuple — its **presence** closes the global read
    path (team grants only), its **absence** is the readable-by-default state, so a
    private resource with zero grants is correctly inaccessible to everyone rather
    than silently globalized. The access decision is a pure, unit-tested function.
  - The auth API is generic: `writeRelation` / `removeRelation` / `setObjectPublic`
    / `listObjectRelations` / `listSubjectRelations` / `setCreateGrant` /
    `listTeamCreateGrants` (user-facing) and `check` / `listAccessibleObjectIds` /
    `hasAnyTypeGrant` / `authorizeCreate` / `setOwner` / `deleteObjectRelations`
    (service-to-service). Migration `0008` backfills tuples from the legacy tables
    and drops them.

  Explicit per-procedure scoping:

  - Access rules (`access()` / `accessPair()`) define only the rule (id, level,
    defaults); every procedure declares its own `instanceAccess`. This removes a
    "loaded gun" default that silently applied a shared `idParam` to any procedure
    which forgot its own override.
  - Modes: `idParam` (single-resource pre-check, fails **closed** if the id does
    not resolve), `listKey` / `recordKey` (post-filter a list/record to the
    accessible subset), `create` (authorize creation + write the owning-team
    grant), `parentScope` (scope by read/manage access to a PARENT type,
    cross-plugin single-hop: "you may see incidents/maintenances/SLOs/health for
    system S iff you may see S"), and `global: true` (the honest "intentionally not
    team-scoped" opt-out). A boot-time validator **rejects** any procedure gated on
    a team-scopable resource type that declares no `instanceAccess`, turning the
    previous fail-open into a boot error.

  Teams administration:

  - **Team managers** manage their own team's members and managers without the
    global `auth.teams.manage` rule; creating, deleting, and granting a team access
    remain admin-only.
  - A **standalone Teams page** (gated on `auth.teams.read`) lets managers reach
    team administration without the admin Auth Settings page; members are added via
    a debounced directory picker.
  - A **cross-plugin `ResourceResolverRegistry`** lets owning plugins register a
    name/search resolver for their resource types, so the Teams page lists a team's
    grants **by name** (grouped by type) and offers a resource picker — an admin can
    change a grant's level, revoke it, or add one, without auth depending on every
    plugin. Resolvers shipped for catalog systems, health-check configurations,
    incidents, maintenances, SLO objectives, and automations.

  Frontend:

  - The resource-side editor is **"Who can change this"** (one Manage checkbox per
    team; unticked = read-only), with an always-visible **Private** toggle
    (disabled until a team that can Manage exists, so a resource can't be stranded).
  - `TeamOwnershipPicker` explains _why_ there's nothing to pick (not a member of
    any team, or none of your teams manage the selected parent) instead of a bare
    "global resource" line.
  - Read-only **"who can change this"** indicators on resource detail pages expand
    to the actual people by name; bulk + per-row **Scope to team** actions in the
    catalog systems list; and the team-access copy spells out that grants are
    additive and that Read-only grants view (not change) even without the global
    permission.

  Security hardening:

  - Child deletes in catalog (`removeSystemContact` / `removeSystemLink`) are scoped
    to both the child id and its parent `systemId`, closing a cross-system IDOR for
    team-scoped managers.
  - `searchUsers` is restricted to team administrators, closing a directory/email
    enumeration path opened by the default `auth.teams.read` rule.
  - Grant setters reject unregistered resource types.

  BREAKING CHANGES (beta; shipped as minor bumps):

  - `access()` and `accessPair()` no longer accept `idParam` / `listKey` /
    `recordKey`; move instance config to the procedure's `instanceAccess`.
  - Boot fails if a procedure gated on a team-scopable resource type omits
    `instanceAccess`. Declare a scoping mode or `instanceAccess: { global: true }`.
  - The `AuthService` interface is reshaped: `check`, `listAccessibleObjectIds`,
    `hasAnyTypeGrant`, `authorizeCreate` (returns `isPrivate`), `setOwner`
    (`isPrivate`), and `deleteObjectRelations`. Custom `AuthService` implementations
    and mocks must update.
  - The auth RPC contract's per-concept resource-access endpoints are replaced by
    the generic tuple API above; external callers of the old
    `getResourceTeamAccess` / `setResourceTeamAccess` / `setResourceAccessSettings`
    / `grantResourceCreate` / etc. must move to the new procedures.
  - Several contract inputs changed from a bare `string` to an object so the
    middleware can resolve the resource id: catalog `deleteSystem` (`{ id }`),
    `removeSystemContact` / `removeSystemLink` (`{ id, systemId }`); health-check
    `deleteConfiguration` / `pauseConfiguration` / `resumeConfiguration` (`{ id }`).
    All in-tree callers are updated.
  - List/record endpoints that relied on returning an empty `200` to signal "no
    access" now return a `403` for categorically-unauthorized principals.
  - The mis-keyed bulk endpoints `getBulkIncidentsForSystems`,
    `getBulkMaintenancesForSystems`, and `getBulkObjectivesForSystems` no longer
    post-filter their (systemId-keyed) result; access is already gated by
    `catalog.system` upstream.
  - Team membership/manager mutations (`addUserToTeam`, `removeUserFromTeam`,
    `addTeamManager`, `removeTeamManager`) now require `auth.teams.read` instead of
    `auth.teams.manage` at the contract level (broadened to per-team managers).
  - The `resource_team_access`, `resource_access_settings`, and
    `resource_create_grant` tables are dropped (data backfilled into
    `relation_tuple` by migration `0008`). A previously inconsistent "team-only with
    zero grants" resource is now correctly inaccessible to global-access holders.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/common@0.16.0
  - @checkstack/cache-api@0.3.13
  - @checkstack/queue-api@0.3.13
  - @checkstack/signal-common@0.2.10
  - @checkstack/template-engine@0.4.5

## 0.22.0

### Minor Changes

- 6005271: Add AI "skills" - reusable prompt templates for the chat assistant and the
  `ai_analyze` automation action. A skill bundles a system-prompt fragment, an
  optional starter prompt, and (for analyze) suggested output fields, tagged with
  the surfaces it targets.

  Skills come from two sources merged into one catalogue: builtin skills
  contributed by core/plugins via the new `aiSkillExtensionPoint`, and GLOBAL
  user skills authored by operators (new `ai_skill` table) and visible to everyone
  who can read skills. New access rules `ai.skill.read`, `ai.skill-create.manage`
  (a dedicated create permission), and `ai.skill.manage` (edit/delete, author-only
  with admin moderation) gate the feature - all default-on, admin-revocable.

  The chat composer gains a skill picker (its system prompt seeds the turn, its
  starter prompt seeds the message box); the `ai_analyze` action gains an optional
  `skillId` that seeds the system prompt, prompt (when blank), and output fields
  (when none) - explicit config always wins. A new "AI skills" settings page lets
  operators browse, view full details (prompts + output fields), publish, edit,
  and delete their global skills. Ships six builtin skills across chat and analyze.

  To support rich pickers, `@checkstack/ui`'s `DynamicForm` gains a `catalog`
  options style (`x-options-style: "catalog"`, with resolver options carrying an
  optional `description`) that renders a browsable modal of cards instead of a
  plain Select, and `@checkstack/backend-api` propagates the new annotation. The
  shared `PageHeader` now wraps a long subtitle beside its actions instead of
  letting them overlap.

### Patch Changes

- Updated dependencies [079369a]
  - @checkstack/template-engine@0.4.4
  - @checkstack/healthcheck-common@1.6.2

## 0.21.7

### Patch Changes

- @checkstack/healthcheck-common@1.6.1

## 0.21.6

### Patch Changes

- Updated dependencies [0b6f01b]
  - @checkstack/healthcheck-common@1.6.0

## 0.21.5

### Patch Changes

- 0626782: Guard the role editor against granting inert (and misleading) permissions to the
  anonymous role.

  RPC procedures carry two independent axes: `userType` (the hard authentication
  gate) and `access` rules (authorization). An admin can grant the anonymous role
  any access rule, but if the procedures needing that rule are `userType:
"authenticated"`/`"user"`, the grant does nothing - the auth middleware rejects
  unauthenticated callers BEFORE access rules are checked (so there is no security
  hole; the grant is simply inert). After anonymous users started seeing
  permission-gated UI, such a grant would surface as visible-but-broken controls.

  - The backend now computes, from contract metadata, the access rules an anonymous
    caller can actually use (a rule is "usable" iff at least one `public` procedure
    requires it) via `pluginManager.getAnonymousUsableAccessRuleIds()`, exposed to
    plugins through the plugin environment.
  - `auth.getAccessRules` annotates each rule with `anonymousUsable`.
  - `auth.updateRole` REFUSES to ADD a non-usable rule to the anonymous role
    (existing grants are untouched, so no configuration can be wedged). This is a
    guardrail, not an enforcement change - RPC authorization is unchanged.
  - The role editor disables non-usable rules (with an explanation) when editing
    the anonymous role.

  Verified live: `getAccessRules` reports 11 anonymous-usable vs 58 not; granting
  `incident.incident.manage` to the anonymous role returns HTTP 400 with a clear
  message.

- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/cache-api@0.3.12
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9
  - @checkstack/template-engine@0.4.3

## 0.21.4

### Patch Changes

- b50916d: Fix "Date cannot be represented in JSON Schema" crashing the AI chat. Zod v4's
  `toJSONSchema()` throws on `z.date()` (and even `z.coerce.date()`) by default,
  and the chat hit this in TWO places:

  - **`@checkstack/backend-api`** `toJsonSchema()` (the OpenAPI generator and AI
    tool-introspection / MCP substrate) called it with no options.
  - **`@checkstack/ai-backend`** the agent loop hands the Vercel AI SDK the raw
    Zod tool input, and the SDK runs its OWN `toJSONSchema()` (throwing) to build
    the model-facing tool schema - so a single date field in any tool input
    crashed every chat turn (the whole tool list is projected before the model is
    called).

  Both now render dates as `{ type: "string", format: "date-time" }` (their wire
  shape) and degrade other unrepresentable types to `{}` instead of throwing.

  For the model boundary, a single `dateSafeModelSchema()` helper hands the SDK a
  ready-made date-safe schema plus a validator that COERCES the ISO strings the
  model emits back into real `Date`s before parsing with the original schema
  (refinements and the downstream RPC client, which expects `Date`s, keep
  working). A single `toModelSchema()` entry point applies this at EVERY point a
  schema is handed to the model - chat tool inputs, the headless agent runner's
  tool inputs (the automation "AI Action"), and `generateObject` structured
  output - gated so non-date schemas are untouched, so individual tool / agent
  definitions never special-case dates. Regression tests cover the converter, the
  AI tool serializer, and the model-schema generation + coercion helper, including
  the full inbound round-trip with the exact ISO shape a live model emits
  (`...T22:00:00Z`, no milliseconds).

  **Timezone correctness.** Because the model produces dates as text, the chat now
  enforces an unambiguous wire contract: a date-time tool argument MUST be RFC 3339
  with an explicit timezone offset. Zone-less (`2026-07-01T22:00:00`) and date-only
  (`2026-07-01`) values are rejected with a model-readable error (the model
  self-repairs), instead of being silently interpreted in the pod's local zone -
  which would resolve the same string to different instants across pods. To resolve
  an operator's bare "22:00", the browser's IANA timezone is sent with every chat
  turn and folded into the system prompt, so each operator's times are interpreted
  in their own zone by default. When no browser zone is available (a headless
  automation AI Action), the reference zone falls back to the host/container
  timezone (`TZ`), not UTC. A format-matrix test covers every common shape a model
  might emit. The chat UI shows the operator which timezone is in use, and the
  `TZ` override is documented for operators.

  **Current time in context.** The model has no clock, so the system prompt now
  includes the current instant (UTC plus the reference-zone wall clock), letting it
  resolve relative dates like "today at 10:00" without asking. Applied to both the
  chat and the headless agent runner, computed per turn/run so it is never stale.

  **Less-strict topic classifier.** The chat's off-topic pre-classifier was
  refusing legitimate requests like "create a maintenance" because maintenances
  (and several other domains) were not listed. The classifier now enumerates the
  full domain set and treats any create/list/update/delete action on a platform
  resource as on-topic by default.

## 0.21.3

### Patch Changes

- @checkstack/cache-api@0.3.11
- @checkstack/common@0.14.1
- @checkstack/healthcheck-common@1.5.3
- @checkstack/queue-api@0.3.11
- @checkstack/signal-common@0.2.8
- @checkstack/template-engine@0.4.2

## 0.21.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/cache-api@0.3.11
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/signal-common@0.2.8
  - @checkstack/template-engine@0.4.2

## 0.21.1

### Patch Changes

- 13373ce: Break the publish-time dependency cycle between `@checkstack/backend-api` and `@checkstack/cache-api` / `@checkstack/queue-api`.

  `cache-api` and `queue-api` only ever used `Logger` and `Migration` from `backend-api` as `import type`, yet declared `@checkstack/backend-api` as a runtime dependency. In the monorepo this is harmless (everything resolves via `workspace:*`), but once published, `bun publish` freezes each `workspace:*` into a concrete pin of the _other_ package's then-current version. Because the dependency is mutual, a consumer installing these packages from the registry must resolve `backend-api -> cache-api -> backend-api -> ...` backward through release history until it reaches ancient versions that shipped raw `workspace:*` ranges and a long-removed `@checkstack/cache-api@0.1.0` pin - which fail to resolve. This surfaced as `bun install` errors (and a missing `checkstack-dev` binary) in freshly scaffolded standalone plugins.

  `Logger` and `Migration` now live in `@checkstack/common` (a dependency-free leaf package). `@checkstack/backend-api` re-exports both for backward compatibility, so existing `import type { Logger, Migration } from "@checkstack/backend-api"` call sites are unchanged. `cache-api` and `queue-api` now depend on `@checkstack/common` instead of `@checkstack/backend-api`, removing the cycle.

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/cache-api@0.3.10
  - @checkstack/queue-api@0.3.10
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/signal-common@0.2.7
  - @checkstack/template-engine@0.4.1

## 0.21.0

### Minor Changes

- 9dcc848: Add the AI platform: a transport-agnostic tool spine, an OAuth Authorization Server + read-only MCP server, a propose/apply flow with audit log, a streaming in-app chat agent, per-conversation permission modes, per-integration spend caps, and user-scoped tool authorization.

  Two new packages, `@checkstack/ai-common` (the `AiTool` contract, `read`/`mutate`/`destructive` effect classification, the `ai.*` access rules, the OpenAI-compatible connection shape, and the wire contracts) and `@checkstack/ai-backend` (the tool registry, extension points, principal-to-tool resolver, shared zod-to-JSON-Schema serializer, and all transports). The OpenAI-compatible integration provider registers through the existing integration provider extension point, so its API key is stored in the Secrets Vault and configured in the generic Connections UI.

  What ships:

  - Tool spine and extension points: `aiToolExtensionPoint.registerTool` (hand-authored composite tools) and `aiToolProjectionExtensionPoint.expose` (opt-in projections of existing oRPC procedures). Authorization mirrors `autoAuthMiddleware` exactly - a tool is surfaced only when every `requiredAccessRules` entry is satisfied, so a scope-narrowed principal can only ever see fewer tools.
  - OAuth + MCP: Checkstack can act as its own OAuth 2.1 Authorization Server (authorization code + PKCE, consent screen, Dynamic Client Registration) and expose a read-only MCP server over Streamable HTTP at `/api/ai/mcp`. Off by default, enabled by the admin `ai.mcp-oauth` setting. A Bearer OAuth-token branch is added to the auth strategy; token scopes are intersected live with the bound user's access rules on every call. A shared-Postgres rate limiter throttles the DCR endpoint per client IP. `getMcpOAuthSettings` / `setMcpOAuthSettings` contracts added to `@checkstack/auth-common`. A minimal OAuth consent page (`/auth/oauth-consent`) renders the requesting client and scopes.
  - Propose/apply + audit: a transport-agnostic two-step service - `propose` re-checks authz, runs the tool's `dryRun` without mutating, and returns a single-use proposal token (the `proposed` audit row IS the token store, 10-minute TTL, atomic single-use); `apply` re-parses the server-stored payload, re-checks authz, and atomically commits. The `ai_tool_calls` audit table records every call across both transports with a SHA-256 args hash (never raw arguments) and stamps who proposed and who applied. An `ai.toolCalled` event carries metadata only.
  - In-app chat: a server-side, provider-agnostic Vercel AI SDK agent loop (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio, ...). The model provider is built on the backend from the integration credentials, so the API key never leaves the backend. The loop offers only resolver-allowed tools, auto-runs read tools (re-entering the live router as the logged-in user) and routes mutating / destructive tools through propose/apply. Durable conversation persistence (`ai_conversations`, `ai_messages`, owner-scoped RPCs) plus a streaming chat UI with a confirm-card component and per-integration model picker.
  - Per-conversation permission mode (Claude-Code-style approve/auto), a durable `permission_mode` column on `ai_conversations` (default `approve`). `read` always auto-runs in both modes; `mutate` inherits the mode (auto-applies server-side in `auto`, confirm-carded in `approve`); `destructive` ALWAYS requires the human `applyTool` in both modes. Security invariant (structural + tested): the mode is consulted only on the `mutate` branch, so no `(effect, mode)` pair routes a destructive tool to auto-apply.
  - Per-integration LLM spend cap (optional `spendCap` = `tokenBudget` + `windowMinutes`, default OFF). Spend is tracked in a shared-Postgres `ai_spend` ledger; enforcement is a rolling-window SUM run before each turn (HTTP 429 over budget). Per-principal tool rate-limit budgets are a rolling COUNT over `ai_tool_calls`, enforced on both transports. An absent / empty / incomplete `spendCap` is treated as "no cap" rather than rejected.
  - Full tool-call replay: `ai_messages.model_messages` (jsonb) persists the canonical AI-SDK `ResponseMessage[]` per turn and replays them verbatim on the next turn; legacy rows fall back to text-only replay.
  - Enforced no-secret-leak scrubbing: `appendMessage` runs `scrubContent` on every write, redacting credential-shaped keys and high-confidence credential values; a canary regression test asserts injected secrets are stripped. A hardening test suite asserts no secret appears in any AI-surface DTO and that handler-side authz holds when the model misbehaves.
  - Provider correctness: the chat provider uses `@ai-sdk/openai-compatible`'s `chatModel` (plain `/chat/completions`), so OpenAI-compatible gateways (OpenRouter, DeepSeek, Ollama, vLLM) no longer reject turns with `invalid_prompt`; `@ai-sdk/openai` is removed.

  BREAKING CHANGES:

  - The `AiTool` contract (`@checkstack/ai-common`) gained a `TRpc` type parameter, and both `dryRun` and `execute` now receive a USER-SCOPED `rpcClient` arg bound to the originating user. Every plugin procedure a tool calls re-enters the live router AS THAT USER, so handler-side authorization (access rules AND per-resource/team scope) is enforced exactly as a direct UI/RPC call - closing a prior privilege-escalation where tools captured a trusted service client at construction. A hand-authored tool MUST resolve its plugin client from this per-call arg and MUST NOT capture a trusted service client at factory scope. Tool factories that previously took `{ rpcClient }` should drop that parameter.
  - `AiToolProjectionExtensionPoint.expose` no longer takes a second `pluginMetadata` argument; the owning metadata lives on `input.sourcePluginMetadata`. Callers must drop the second argument.

  State and scale: conversations, messages, the audit log, proposal tokens, the rate-limit counter, and the spend ledger all live in shared Postgres, so every pod answers identically and the agent loop is resumable on any pod. The only pod-local state is the live MCP connection registry (bookkeeping, never a source of truth). Cross-pod conversation readback, the spend cap, and the tool budget are verified by env-gated two-pod integration tests.

  This is a beta minor.

- 9dcc848: Automations now run as a configured service account, removing implicit god-mode from the dispatch path.

  BREAKING: every automation must declare a `runAs` application (service account). Previously every automation action ran as the trusted service client, bypassing all access-rule, per-resource, and team-scope checks - so an automation could touch any team's data. Now each automation runs as a bounded `application` principal, and every data-access call an action makes is authorized exactly as that identity. An automation with no `runAs` fails to run with a clear error rather than falling back to the trusted client; legacy automations must be assigned a service account before they run again.

  What changed:

  - New top-level field `runAs` on automations (a `run_as_application_id` column + create/update inputs; `AutomationSchema.runAs`). Required on create; GitOps sets it via the `run-as` metadata label.
  - A new `coreServices.rpcClientAs(applicationId)` mints a short-lived, backend-signed app-principal token; the auth service resolves it LIVE to an `application` principal (reusing `enrichApplicationPrincipal`), so it flows through full `autoAuthMiddleware` enforcement. The dispatch engine threads this client into every action's `execute` as the required `context.rpcClient`.
  - Bind authority (anti-escalation): a user may only bind an application whose access rules are a subset of their own (`isApplicationBindable`); `getBindableApplications` lists only bindable apps, and the create/update handlers enforce the check.
  - `notification.sendTransactional` moves from service-only to access-gated (`notification.send`, a new access rule), so an automation's `runAs` can call the built-in `notify_user` / `notification.send` actions; trusted services still bypass via short-circuit.
  - A "Run as (Service Account)" picker in the automation editor, populated from `getBindableApplications` (server-side filtered to bindable apps), seeding from the loaded `runAs` on edit and passing it into create + update. First-class teaching UX: an inline info banner, a blocked Save with an inline hint until one is chosen, and an empty state linking to the Applications admin + docs when none are bindable.

  State and scale: `runAs` resolution is a pure read over shared tables; the app-principal token is self-contained and verified statelessly, so the per-run client is correct under horizontal scale.

  This is a beta minor.

- 9dcc848: Harden config-versioning so stored configs always migrate-then-validate and broken migration chains fail fast at boot.

  - `@checkstack/backend-api` `Versioned<T>` gains `parseAssumingV1` (migrate-from-v1 then validate leniently, runtime path), `parseStrictAssumingV1` (migrate then validate strictly, editor path), and `validateMigrationChainFromV1()`. A standalone pure helper `assertMigrationChainFromV1({ version, migrations })` is the single shared implementation behind the constructor guard and `validateMigrationChainFromV1`.
  - `Versioned` now validates its own v1 -> `version` chain in the constructor, which runs at module import / plugin registration. A new `no-restricted-syntax` ESLint rule bans calling `parse` / `safeParse` / `parseAsync` / `strict` directly on a `Versioned`'s `.schema` member.
  - Auth strategy migration chains are validated at the `betterAuthExtensionPoint.addStrategy` chokepoint (`@checkstack/auth-backend`).
  - Automation action AND trigger configs migrate-then-validate (lenient at dispatch, strict in the editor validator, recursing into `choose`/`parallel`/`repeat`/`sequence` blocks). The `run_script` / `run_shell` action configs bump to `version: 2` dropping the removed `sandbox` key, fixing the editor's `Unrecognized key: sandbox` error.
  - Anomaly read path now validates: `getAnomalyConfig` / `getAnomalyAssignmentConfig` run stored records through `Versioned.parseRecord`; `PartialAnomalySettingsSchema` moved to `@checkstack/anomaly-common`. Notification ConfigService reads thread the migrations argument, and per-strategy `userConfig` is migrate-then-validated before `send()`.
  - gitops-apply migrate-then-validates authored health-check config; integration connection validation routes through `safeValidate`. The latent HTTP health-check `result` schema (at `version: 3` with no migrations) now ships a pass-through v1 -> v2 -> v3 chain.

  BREAKING CHANGES (fail-fast at boot, intended):

  - Any `Versioned` config with `version > 1` and an incomplete or non-contiguous migration chain now throws at construction (boot) instead of failing lazily on first read. This covers every `Versioned` instance repo-wide, including future plugin types. Out-of-tree plugins shipping such a config must add the missing migration step(s); all in-repo strategies already have complete chains.
  - An auth strategy declaring `configVersion > 1` without a complete chain throws at registration.
  - A trigger's per-automation config is now a versioned `config: Versioned<TConfig>` instead of a bare `configSchema?`. Plugins registering triggers with `configSchema:` must wrap it: `config: new Versioned({ version: 1, schema })`. The underlying schema stays reachable via `config.schema`; triggers without per-automation config are unaffected.

  State and scale: all affected reads resolve from shared Postgres / in-process registries, so every pod sees the same migrated answer. No new framework-owned current-state store.

  This is a beta minor.

- 9dcc848: Add environments as a first-class catalog primitive, with per-environment health-check fan-out, config templating, per-environment reactive health, and script run-context exposure.

  - Catalog primitive: an environment is a sibling of groups - a named, instance-global record carrying free-form custom fields (baseUrl, region, tier, ...) that any system can belong to many-to-many. New `environments` + `systems_environments` tables, `EnvironmentSchema` + create/update schemas, `EntityService` environment CRUD and membership joins, RPC endpoints gated by a new `catalogAccess.environment` access rule, a GitOps `Environment` kind + `System.environments` extension, and frontend management (an `EnvironmentEditor`, an Environments management panel, and a per-system environment picker). The Environments card's Add/Edit/Delete affordances are gated on `catalogAccess.environment.manage`.
  - Per-environment fan-out: run identity becomes `(systemId, configurationId, environmentId)`. Runs, aggregates, and state transitions gain a nullable `environmentId`. The health-check assignment gains an `environmentIds` selector with three modes (All / Specific / None; `null` and `[]` are distinct). The queue executor resolves the effective environment set via the catalog `resolveSystemEnvironments` read and executes one isolated run per environment.
  - Config templating: a new `x-templatable` config-field marker renders a string field through the template engine at execute time, against `{ environment, check, system }`. A shared `renderTemplatableConfig` and a `renderTemplatePreview` helper (re-exported from `@checkstack/template-engine`) keep editor previews identical to the run-time render. The HTTP collector's `url`, `headers[].value`, and `body` are templatable, rendered per environment (the strategy client build moves inside the per-env loop); the `url`'s `.url()` validation moves post-render. Secrets resolve before templating; a field marked both secret and `x-templatable` is rejected at plugin load. `DynamicForm` shows a live "Preview" line, and the catalog `EnvironmentPreviewPicker` ("Preview as: <environment>") drives it in the collector editor (only when the schema has a templatable field).
  - Script run-context: `CollectorRunContext` gains an optional `environment` field (`{ id, name, fields }`, metadata only). Shell collectors receive `CHECKSTACK_ENV_ID` / `_NAME` / `CHECKSTACK_ENV_<FIELD>` vars; inline TS collectors read `globalThis.context.environment`; the editor test panel mirrors both. The env-less path is unchanged.
  - Per-environment reactive health (see BREAKING below), env-keyed read/write paths, env-qualified serialization locks, an optional `trigger.payload.environmentId`, per-environment isolation, and an `ENVIRONMENT_RESOLUTION_FAILED` signal when catalog resolution degrades to a single env-less run.

  BREAKING CHANGES: the reactive `health` entity's id-shape and cardinality change. It now encodes two views: per-environment (id `"<systemId>::<environmentId>"`) and a system rollup (id `"<systemId>"`, the worst status across environments + env-less runs). The rollup PRESERVES the pre-existing system-level contract - dashboards, status badges, and automations referencing health by `systemId` keep working without re-authoring - but the entity's contract surface changed (new id-shape, higher cardinality, new payload field), so it is flagged breaking. `getBulkHealthState` parses env-qualified ids and keys results by the original id.

  State and scale: membership and custom fields live only in catalog Postgres and are re-read every tick via the cross-plugin RPC; env-keyed health reads from shared `health_check_runs` / aggregates / transitions (compute-on-read). Every pod resolves the same effective set and the same per-environment health. No pod-local environment state.

  Also: `unwrapSchema` in `zod-config.ts` loops instead of single-pass-stripping so multi-layer wrappers (`.optional().default()`) still resolve `x-templatable` meta. The env-less `{{ environment.* }}` run notice logs at `debug` (a legitimate recurring configuration), while the post-render HTTP `.url()` check still fails a genuinely-broken empty render with a clear "Rendered URL is invalid" error.

  This is a beta minor.

- 9dcc848: Cut initial-load JS: lazy plugin contributions, a hardened lazy-by-default contribution contract, on-demand Monaco, and a lighter icon/chart load.

  - Lazy plugin route pages: each plugin's route `element` references a `React.lazy`-wrapped page rendered inside a shared `<Suspense>` boundary. Plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are available on first paint. This moves ~37 route-page chunks (~600 KB) out of the entry; the entry chunk drops from ~2.4 MB to ~190 KB. Auth flow pages stay eager. The `@checkstack/scripts` scaffold template generates lazy route pages too.
  - Hardened contribution contract (BREAKING, frontend plugin contract): plugins declare contributions lazily and let the framework own code-splitting, Suspense, and per-plugin error isolation. Routes use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />` (`element` is still accepted for the rare page that must paint without a chunk fetch; provide exactly one). Slot extensions accept either an eager `component` or a lazy `load`; new `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind. This also fixes runtime-installed plugins: `ExtensionSlot` subscribes to the plugin registry, and the API registry rebuilds when the plugin set changes (`getPlugins()` returns an immutable snapshot via `useSyncExternalStore`). A per-plugin error boundary contains a bad contribution.
  - On-demand Monaco: the `@checkstack/ui` barrel no longer pulls the `@codingame/*` / `monaco-languageclient` stack into the initial load. `CodeEditor` lazy-loads its Monaco-backed editor behind `React.lazy` + Suspense, `validateTypeScriptSources` imports the editor API via in-body `await import(...)`, and the "vscode services ready" signal moved to a Monaco-free module. The ~10 MB editor body loads only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was added for stable vendor caching.
  - lucide-react 1.x + lighter icons/charts (BREAKING for icon consumers): lucide-react unified from three drifting ranges to `^1.17.0`. lucide v1 removed brand icons, so the GitHub/GitLab marks are vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`); a new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is canonical, accepted by `AuthStrategy.icon` and the card components, so data-driven brand names keep working. `DynamicIcon` no longer eagerly imports lucide's ~1600-icon map (~1 MB) - it lives in a `React.lazy` `iconRegistry` chunk fetched on first data-driven render, while statically named-imported icons tree-shake normally. The recharts-backed health-check charts (~300 KB) and the `HealthCheckSystemOverview` drawer leave the initial load.

  BREAKING CHANGES:

  - Frontend plugin contract: routes/slot contributions are lazy-by-default (`load` instead of `element`/eager elements) as described above.
  - Any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

  This is a beta minor.

- 9dcc848: Layered OS-level script sandbox, secure and fail-closed by default (epic #247).

  Script and shell health checks and the `run_shell` / `run_script` automation actions now run inside a layered OS-level sandbox by default. The sandbox lives in `core/backend-api/src/script-sandbox/` (the single source of truth) and is enforced inside the shared runners, so it applies wherever a job runs.

  Layers:

  - Resource caps (CPU / memory / PID / FD / file-size, via `prlimit` on capable Linux; ESM JS-heap cap via `--max-old-space-size`; portable wall-clock timeout) and an OOM-safe streaming output cap.
  - Privilege drop via a NON-ROOT supervisor model: the shipped images run the supervisor as non-root uid `65532`, so every sandboxed script inherits non-root and can never be host-root; filesystem + network confinement is delivered by ROOTLESS `bwrap`/`nsjail` via unprivileged user namespaces. `enforced.privilege` is truthful (true only when the child cannot run as host-root). Runners no longer pass `uid`/`gid` to `Bun.spawn` (a silent no-op and a forward-compat hazard).
  - Filesystem isolation (`scratch-only` / `scratch-plus-ro`) confining the child to its per-run scratch dir over a read-only base; the interpreter path is RO-bound so the runtime execs, and `TMPDIR` is pinned to the in-namespace tmpfs.
  - Network egress control: `deny` (routeless loopback-only netns), `allowlist` (real plumbed egress via macvlan OR rootless slirp4netns + an in-kernel nftables filter), and an always-on metadata / link-local block (`169.254.0.0/16`, `fe80::/10`, `fc00::/7`). No-blackhole invariant: `enforced.network` is never true when egress is actually severed or unfiltered; unpluggable egress degrades to surfaced host net.
  - Per-run fork-bomb containment via RLIMIT*NPROC inside the fresh per-run user+PID namespace; a centralized forbidden-env denylist (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD*_`, `NODE*OPTIONS`, `BUN*_`, caller `PATH` overrides).
  - A validated tuned seccomp profile (`deploy/seccomp/checkstack-userns.json`) and a live `clone(CLONE_NEWUSER|CLONE_NEWNET)` capability probe (not the static sysctl), shipped by default in both Dockerfiles, `docker-compose.yml`, and `deploy/k8s/checkstack-sandbox.yaml`.

  Global policy and operator surface:

  - The global sandbox policy lives in ONE durable row owned by `script-packages` (its `ConfigService` row in shared `plugin_configs`). A single process-wide provider serves every runner; the two script plugins no longer register competing providers. A dedicated admin-only `script-sandbox.manage` permission gates both reading and writing the policy. New `getSandboxPolicy` / `setSandboxPolicy` endpoints and a Settings -> Script Sandbox admin UI (`enabled`, `onUnavailable`, network/filesystem/privilege modes, allow list, metadata block, resource caps). The startup capability/readiness log is emitted in-process by `script-packages-backend` (no fragile init-order RPC self-loop), and on a host that cannot enforce a layer a one-time startup warning explains the two local-dev paths (Docker, or set the global policy to `degrade`).
  - Satellite relay: the WS protocol carries the resolved policy in the `authenticated` message and a `sandbox_policy` push-on-change; a satellite caches the last relayed policy and resolves every run through it.

  BREAKING CHANGES (platform in BETA, shipped as minor):

  - Scripts run sandboxed by default. The shipped global default is FAIL-CLOSED (`onUnavailable: "fail"`): when a requested layer cannot be enforced the run is REFUSED (clean `exitCode: -1`, never an unsandboxed spawn) rather than silently degrading. Deployments on hosts that cannot enforce a layer (no bubblewrap, user namespaces blocked, no `/proc` unmask) must run the official images with the documented runtime flags (the bundled seccomp profile + `systempaths=unconfined`, or k8s `procMount: Unmasked`), or set the global policy to `degrade`. On macOS / restricted containers the strong layers degrade to the portable subset and are surfaced per run.
  - Default network posture is deny-egress (`allowlist` with an empty allow list, which resolves to the routeless `deny` path). Scripts calling external endpoints fail until those destinations are allowlisted in the global default. The always-on metadata / link-local block applies even under looser modes.
  - The per-action / per-check `sandbox` config override and the transport `ScriptRequest.sandbox` field are removed; policy is global-only, so an automation/check author can no longer weaken the sandbox on their own item. Stored configs carrying a stray `sandbox` key are tolerated (stripped on parse).
  - The shared runners' `run()` no longer accepts a `sandbox` option; callers rely on the global policy provider.
  - A satellite fails closed (most restrictive profile) until it receives the first relayed policy; a relay-read failure or an older core keeps it fail-closed. A relay failure can never loosen a satellite's sandbox.

  State and scale: the global policy is a single durable Postgres row read identically on every pod. Capability detection is per-process, deterministic from the host kernel, and surfaced per run via the `EffectiveSandbox` report (a Linux pod and a macOS satellite may legitimately differ). `CHECKSTACK_SANDBOX_UID/GID` and macvlan addressing are genuinely per-host infrastructure, surfaced per run, not the queryable policy. The satellite's policy cache is satellite-local transport state. No new pod-local current-state.

  This is a beta minor.

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
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/common@0.13.0
  - @checkstack/template-engine@0.4.0
  - @checkstack/cache-api@0.3.9
  - @checkstack/queue-api@0.3.9
  - @checkstack/signal-common@0.2.6

## 0.20.0

### Minor Changes

- a57f7db: fix(backend): give advisory locks a dedicated connection pool to prevent pool-starvation deadlock

  Both the session-lock service and `withXactLock` HOLD a Postgres connection for
  the lock's whole lifetime while the gated work runs on a _different_ connection.
  Both lock and work were drawing from the single shared `adminPool` (which, with
  no explicit config, defaulted to `max: 10` and `connectionTimeoutMillis: 0` -
  wait forever). Under concurrency >= pool size, every slot became a lock-holding
  connection waiting for a work connection that could never free up: a permanent
  deadlock. It surfaced as all connections stuck `idle in transaction` on
  `pg_advisory_xact_lock` and every API request hanging into an upstream 502,
  only after the server had been running long enough to hit that concurrency
  (e.g. a burst of health-check evaluations or incident dedups).

  Advisory locks now run on a dedicated `lockPool`, separate from `adminPool`, so
  the acquire graph is acyclic (`lockPool -> adminPool`, never back) and the
  deadlock class is impossible. `AdvisoryLockService` gains a pooled
  `withXactLock({ key, fn })` method (lock on the lock pool, work on the admin
  pool); healthcheck's per-system serializer, incident's dedup-create, and the
  automation single-mode concurrency lock now use it. The deadlock-prone
  standalone `withXactLock({ db, ... })` helper is REMOVED.

  Both pools are explicitly configured with `connectionTimeoutMillis` so any
  future exhaustion fails fast and self-heals instead of hanging, and both get a
  pool-level `error` handler (an idle pooled client whose backend dies otherwise
  crashes the pod). The lock pool additionally sets
  `idle_in_transaction_session_timeout` and `lock_timeout` so a stalled critical
  section is reaped server-side (auto-releasing the lock) rather than stranding a
  key forever. The advisory-lock service also now removes its per-client error
  listener on release (it previously leaked one listener per acquisition on each
  reused pooled connection - an unbounded `MaxListenersExceeded` leak).

  New env vars (all optional): `DATABASE_POOL_MAX` (default 20),
  `DATABASE_LOCK_POOL_MAX` (default 10), `DATABASE_POOL_CONNECTION_TIMEOUT_MS`
  (default 10000), `DATABASE_POOL_IDLE_TIMEOUT_MS` (default 30000),
  `DATABASE_LOCK_IDLE_TX_TIMEOUT_MS` (default 30000), `DATABASE_LOCK_TIMEOUT_MS`
  (default 30000). Size pools off
  `N_pods * (DATABASE_POOL_MAX + DATABASE_LOCK_POOL_MAX) <= max_connections`.

  BREAKING CHANGE: the standalone `withXactLock({ db, key, fn })` export is
  removed - use `coreServices.advisoryLock.withXactLock({ key, fn })` instead.
  `IncidentService`'s constructor now requires an `AdvisoryLockService` as its
  second argument, and the healthcheck `createHealthEntitySerializer` /
  `executeHealthCheckJob` / `setupHealthCheckWorker` helpers take `advisoryLock`
  instead of `db` for the serializer.

### Patch Changes

- @checkstack/cache-api@0.3.8
- @checkstack/queue-api@0.3.8

## 0.19.0

### Minor Changes

- 270ef29: Fix automation provider actions and `secretEnv` script actions throwing in production.

  The automation dispatch engine resolved provider-action dependencies (the integration connection store, the secret resolver) through a `getService` that was a throwing stub, so Jira / Teams / Webex actions and `secretEnv` script actions threw at execute time in production. The whole dispatch test suite stubbed `getService`, so the break was invisible.

  Root cause: the plugin `env` exposed `registerService` but no resolver, so the dispatch path (the only context that resolves arbitrary cross-plugin refs outside an RPC handler) had nothing real to call.

  Changes:

  - `@checkstack/backend-api`: add `getService<S>(ref: ServiceRef<S>): Promise<S>` to the plugin `env` (`BackendPluginRegistry`). It resolves a service registered by any plugin through the real `ServiceRegistry` using the calling plugin's identity, and throws a clear error if the ref is not registered (never silently `undefined`). **NEW PLUGIN-AUTHOR CONTRACT**: `env.getService` is now available to resolve arbitrary cross-plugin service refs at init / afterPluginsReady time.
  - `@checkstack/backend`: implement `env.getService` in both the plugin loader and the runtime single-plugin registration path, backed by `ServiceRegistry.get(ref, { pluginId })`.
  - `@checkstack/automation-backend`: wire the dispatch `getService` to `env.getService` (was a throwing stub). This also activates run-wide provider-credential masking, because resolving the connection store / secret resolver now flows through the run's masking interceptor.

  Also fixes a test-only seam where the `core/backend` test preload registered a no-op `registerRouter`, silently disabling oRPC router registration across the suite.

- 270ef29: Fix suspend/resume durability + complete the run-wide secret-masking guarantee.

  A panel review confirmed several defects in the automation dispatch engine's suspend/resume durability and in the run-wide masking choke point. These survived because the unit suite stubbed the seam under test; the fixes ship with tests that exercise the real suspend / sweep / resume paths.

  Suspend/resume durability:

  - **Stalled sweeper no longer re-runs intentional waits.** `findStalledRunIds` now joins `automation_runs` and returns only `status = 'running'` runs, and suspend-finalisation no longer clobbers the run's `lastActionPath` checkpoint to `null`. Previously any wait longer than the stale window (>60s) was re-walked from the top every sweep cycle, re-firing pre-wait side effects and leaking wait locks. The wait-aware sweeps now also run before the stalled-run sweep.
  - **Stalled recovery refuses a run holding a live wait lock.** `recoverStalledRun` now only recovers a genuinely-`running` run with no wait lock; a crash-mid-wait recovery is left to the wait/resume paths instead of re-walking from the top and creating a duplicate lock + duplicate delay job.
  - **Cancelled runs can no longer resurrect.** `resumeRun` guards on `status === 'waiting'` (mirroring `checkWaitUntil`) and drops any stale lock for a non-waiting run, so `wakeWaitingRuns` / delay-expiry / a racing queue job can't wake a cancelled or terminal run. `cancelActiveRuns` (restart mode) now deletes the cancelled runs' wait locks + run-state in the same operation.
  - **Concurrency check-then-create is serialized.** The `mode` check + `createRun` now run under a transaction-scoped advisory lock keyed on `(automationId, scope)`, so two concurrent fires can't both pass a `single`-mode "no active run" check and double-run.

  Masking guarantee (now genuinely covers scope + artifacts):

  - **The run-wide masking choke point now also masks the durable scope snapshot and produced artifacts.** The `RunSecretRegistry` is threaded into `RunStateStore.upsert` (masks `scopeSnapshot`) and `ArtifactStore.record` (masks `data`) so a resolved connection credential threaded into `scope.variables` or surfaced into an artifact is redacted before persist - and therefore cannot reach a read-only user via `getRunScopeForReplay`. **GUARANTEE CHANGE**: run-wide masking now covers step output, run error, scope snapshot, and artifact data for every action.
  - **`testConnection` / `testProviderConnection` mask provider errors.** These RPCs run outside a dispatch run, so they build a per-call mask set from the resolved/submitted connection config and run any provider error through it before returning, so a provider error echoing a token can't cross back to the browser.
  - **Short secrets surface a warning.** `setSecret` now warns when a value is shorter than `MIN_MASKABLE_LENGTH` (4) that it cannot be auto-redacted (the threshold is intentionally not lowered).

  Internal:

  - `@checkstack/backend-api`: `withXactLock`'s `fn` now receives the transaction handle `tx` so a critical section can run on the locked connection; the doc clarifies why running on the pool inside the lock window is still safe. The incident dedup caller's comment is corrected accordingly. `RunStore` gains `findWaitLocksByRun`.

- 270ef29: Fix several correctness defects around distributed coordination and stored-data handling.

  - Dwell `for:` timers now fire via an atomic `DELETE ... RETURNING` claim, so two pods (or the stalled sweeper vs the queue consumer) can no longer both fire the same dwell.
  - Postgres session-level advisory locks now keep connection affinity. A shared `AdvisoryLockService` (backed by a dedicated pooled client) replaces the previous acquire/release-on-different-connection pattern that leaked locks. Used by the script-packages installer election, the automation run resume + stalled sweeper, and (via a new transaction-scoped `withXactLock`) incident dedup.
  - A storage migration that crashed mid-flight is now resumed on startup under the installer-election lock, instead of permanently wedging installs.
  - Distributed script-package blobs carry a `blobSha256` and are verified before extraction (the SRI `integrity` hashes the npm tarball, not the transported archive). Backward-safe: entries without the field skip verification until a re-install regenerates the manifest.
  - Archive extraction rejects zip-slip paths (absolute or `..` entries) before writing anything.
  - `incident.create` with `dedupe_open_for_system` serializes its check-then-create per system, so concurrent triggers for the same system can't both open a duplicate incident.
  - Seeded auto-incident filter expressions JSON-encode interpolated ids so a quote/backslash can't corrupt the expression.
  - Stored jsonb snapshots (dwell `actorSnapshot`, wait-lock `waitConfig`) are validated with zod on load and degrade safely instead of flowing through as the wrong type.

- b995afb: Harden the advisory-lock service against holder-connection termination.

  A session-level advisory lock is held on a dedicated checked-out pool client.
  If that backend is terminated (admin kill, failover, network drop) while the
  lock is held, `pg` emits an `'error'` on the client; with no listener attached
  that error is re-thrown by the EventEmitter and crashes the pod. The service
  now attaches an error listener to the held client so the loss degrades
  gracefully - the session lock is auto-released server-side when the backend
  dies, and the key simply becomes acquirable again.

  Also de-flaked the advisory-lock integration test: it now terminates only the
  lock-holding backend (found via `pg_locks`) instead of every backend in the
  database - the old blanket kill also tore down the pool's idle connections,
  whose async errors flaked the run and left the pool unusable.

- 270ef29: Add in-UI script testing for automation `run_script` / `run_shell` actions.

  A new `testScript` RPC runs a TypeScript or shell script against an
  editable, auto-seeded sample context using the same sandboxed runner the
  real action uses, so operators can test scripts directly in the editor
  without dispatching a whole automation. Surfaces beneath any script field
  flagged `x-script-testable` via the new `ScriptTestPanel` /
  `ContextSampleEditor` components in `@checkstack/ui` and the
  `scriptTestRenderer` prop threaded through `DynamicForm`.

  - `@checkstack/automation-common`: adds the `testScript` contract +
    `ScriptTest*` schemas (gated by `automation.manage`).
  - `@checkstack/automation-backend`: implements `testScript` reusing the
    shared ESM / shell runners; central-only, time-bounded.
  - `@checkstack/backend-api`: new `x-script-testable` config-schema
    metadata propagated to the frontend JSON Schema.
  - `@checkstack/ui`: new `ScriptTestPanel` + `ContextSampleEditor`
    components and a `scriptTestRenderer` prop on `DynamicForm`.
  - `@checkstack/automation-frontend`: wires the test panel into the action
    editor.
  - `@checkstack/integration-script-backend`: marks the `run_script` /
    `run_shell` script fields as testable.

- 270ef29: Activate npm packages in script execution: thread the managed
  `resolutionRoot` into every user-script call site so an allowlisted package
  can actually be `import`ed.

  - `@checkstack/backend-api`: the ESM runner now always writes a per-run
    `bunfig.toml` with `[install] auto = "disable"` and runs with that dir as
    CWD. Without this Bun silently auto-installs any imported package from the
    registry (verified), defeating the allowlist; with it, imports resolve
    only against the reconciled `current/node_modules` (when a `resolutionRoot`
    is set) and otherwise fail fast.
  - `@checkstack/script-packages-backend`: `resolveResolutionRoot` /
    `resolveResolutionRootFromStore` / `resolveResolutionRootForHost` decide a
    host's resolution-root status (`none` / `ready` / `notReady`) from the
    local `<store>/current`.
  - `run_script` (integration-script-backend), the inline-script collector
    (healthcheck-script-backend, core + satellite), and the in-UI `testScript`
    / `testCollectorScript` endpoints all resolve the root per run and pass it
    to the runner; `run_script` surfaces a clear "npm packages not ready"
    error when configured-but-unsynced. Shell paths are unaffected (no module
    resolution).

  An opt-in end-to-end test (`CHECKSTACK_E2E_NETWORK=1`) proves an allowlisted
  package imports successfully through the real `run_script` action execute
  path, with non-network degradation tests running always.

  BREAKING CHANGES: `@checkstack/backend-api`'s `defaultEsmScriptRunner` now
  always disables Bun auto-install for the user subprocess. A script that
  previously relied on Bun silently fetching an un-vendored package from the
  registry at import time will now fail to resolve it. This is intentional -
  package availability is governed by the admin allowlist - but any caller
  depending on the old implicit auto-install behavior must add the package to
  the allowlist instead. The new `EsmScriptRunOptions.resolutionRoot` field is
  optional and additive (defaults to today's `os.tmpdir()` behavior when
  unset), so the runner API itself is source-compatible.

- 270ef29: Add the per-host script-package reconciler and the runner resolution root.

  - `@checkstack/backend-api`: `EsmScriptRunOptions.resolutionRoot` - when
    set, the per-run temp dir is created inside it so module resolution walks
    up to `<resolutionRoot>/node_modules` and user scripts can `import`
    managed npm packages. Defaults to today's `os.tmpdir()` behavior when
    unset (backward-compatible; isolation unchanged - the subprocess still
    only sees `SAFE_ENV_VARS`).
  - `@checkstack/script-packages-backend`: content-addressed cache archive
    (tar+gzip per package), pure delta diff (`computeMissingBlobs`), atomic
    `current` symlink swap, the host reconciler (`reconcileToHash` -
    idempotent: pull only missing blobs, materialize a versioned tree via
    `bun install --offline`, atomically flip `current`), the concrete fs/Bun
    adapter, the central install resolver, and the `script-packages.changed`
    broadcast hook. An opt-in end-to-end test
    (`CHECKSTACK_E2E_NETWORK=1`) proves resolve -> publish -> cold reconcile
    (no registry) -> offline materialize -> import.

- 270ef29: Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

  - Script consumers declare a least-privilege `secretEnv` allowlist
    (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
    `run_shell` actions resolve ONLY the declared secrets via
    `secretResolverRef.resolveForRun`, inject them into the runner env for
    that run (memory-only; the ESM runner gained a per-run `env` option), and
    mask their values out of stdout/stderr/result/error via the run-scoped
    masking context. A missing required secret fails the run clearly. No
    ambient secret access.
  - Test panel: `testScript` / `testCollectorScript` inject named
    `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
    overrides; real production values are never resolved in the test path,
    and overrides are masked out of the result.
  - Healthcheck collectors carry the `secretEnv` field for authoring +
    the test panel; runtime injection on satellites lands in Phase 3.
  - Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
    record fields with `${{ secrets.* }}` name autocomplete (from
    `listSecretNames`), wired into the automation action editor and the
    healthcheck collector editor. New `withConfigMeta` helper +
    `x-secret-env` config-meta key in `@checkstack/backend-api`.

- 270ef29: Secrets platform Phase 3: just-in-time secret delivery to satellites + source-side masking, and central-execution injection for healthcheck collectors.

  - New satellite WS messages `request_run_secrets` / `run_secrets`: just
    before a satellite runs a collector that declares a `secretEnv`, it asks
    core for that collector's resolved env; core resolves ONLY the secrets the
    collector's OWN persisted assignment declares (least-privilege — the
    satellite cannot choose) and replies with the env map (or a clear error).
    The satellite injects it memory-only for the run and drops it on
    completion. Secrets never ride the persisted assignment and never touch
    disk.
  - Source-side masking: the satellite runs `maskSecrets` over the collector's
    stdout/stderr/result/error using the run's delivered values BEFORE the
    result leaves the satellite (defense in depth).
  - `CollectorStrategy.execute` gains an optional `secretEnv`. The
    inline-script and shell collectors inject it into the runner
    (`process.env` / `$VAR`) and mask the values out of their output.
  - Healthcheck collectors running centrally (the queue executor) also resolve
    - inject `secretEnv` via `secretResolverRef`, closing the gap where a
      centrally-run secretEnv collector got no secrets. A missing required
      secret fails the run clearly in all paths.

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/cache-api@0.3.7
  - @checkstack/queue-api@0.3.7

## 0.18.0

### Minor Changes

- 6d52276: feat(automation): expose `trigger.actor` so automations can filter on who/what caused an event

  Every platform event now carries an **actor** - the user, application (API
  client), service (backend-to-backend), or `system` (background /
  unauthenticated) that caused it - and the automation engine surfaces it to
  automations as `trigger.actor`. This lets a trigger filter gate on the
  origin of the event it reacts to:

  ```text
  {{ trigger.actor.type == "system" }}      # auto-created by the platform
  {{ trigger.actor.type == "user" }}         # a human
  {{ trigger.actor.id == "app-deploybot" }}  # a specific application
  ```

  `trigger.actor` is available on **every** trigger - it is injected by the
  platform, not declared per trigger - and editor autocomplete + Run Script
  context types include `trigger.actor.{type,id,name}`.

  How it works:

  - **`@checkstack/common`** adds the canonical `Actor` type / `ActorSchema`
    and `SYSTEM_ACTOR`.
  - **`@checkstack/backend-api`** adds `resolveActor(user)` and a
    `HookEventMeta` envelope. The hook listener / `onHook` signature gains an
    optional second `meta` argument (additive, backward compatible).
  - **`@checkstack/backend`** wraps emitted hooks in an envelope so the actor
    travels with the payload through the distributed queue, unwrapping it
    before delivery. The RPC emit path captures the authenticated caller;
    background emits default to the system actor. Raw/legacy queue data is
    treated as a system-actor payload, so delivery stays backward compatible.
  - **`@checkstack/automation-backend`** threads the actor into the dispatch
    scope (`trigger.actor`), available to trigger filters, top-level
    conditions, and all run templates, and persisted in the run's scope
    snapshot. Manual runs are attributed to the invoking user.
  - **`@checkstack/automation-common`** / **`@checkstack/automation-frontend`**
    expose `trigger.actor` in the editor variable scope and the generated
    Run Script `context.trigger.actor` types.

  No database migration and no per-trigger schema changes: the actor rides as
  event-envelope metadata and in the run scope snapshot.

- 35bc682: feat(healthcheck): expose check + system run-context to script collectors

  Script health checks can now read which check and system a run is for.
  Previously shell scripts got only a curated env whitelist and inline
  scripts only `context.config`, so a script had no built-in way to know
  its own check name or the system it was checking.

  - `@checkstack/backend-api`: new `CollectorRunContext` type
    (`{ check: { id, name, intervalSeconds }, system: { id, name } }`) and
    an optional `runContext` param on `CollectorStrategy.execute`. Optional,
    so existing collector implementations are unaffected.
  - Shell-script collector: injects reserved `CHECKSTACK_CHECK_ID`,
    `CHECKSTACK_CHECK_NAME`, `CHECKSTACK_CHECK_INTERVAL_SECONDS`,
    `CHECKSTACK_SYSTEM_ID`, `CHECKSTACK_SYSTEM_NAME` env vars (user-supplied
    `env` still wins on collision).
  - Inline-script collector: exposes `context.check` and `context.system`
    alongside `context.config`; the inline-script editor now types them for
    autocomplete.
  - Shell editors (health-check collectors and automation shell actions) now
    also suggest the user's own `env` (JSON) keys as `$NAME` completions, via
    the new exported `customShellEnvVars` helper. Keys that aren't valid shell
    identifiers are omitted.
  - Fix: the Typefox `CodeEditor` captured a stale `onChange` at editor start,
    so editing one `DynamicForm` field reverted sibling fields changed since
    mount (e.g. typing in a shell `script` field wiped an unsaved `env` value,
    or deleted a sibling automation action added after mount). The change
    handler now routes through a ref to the current `onChange`.
  - Fix: focusing a JSON editor threw "LanguageStatusService.addStatus is not
    supported" because the standalone service set omitted `ILanguageStatusService`.
    That one service is now registered via `serviceOverrides`.
  - Fix: the automation trigger card nested a `<Badge>` (a `<div>`) inside a
    `<p>`, producing a `validateDOMNesting` warning. Switched the wrapper to a
    `<div>`.
  - Local runs (`queue-executor`) and satellite runs both populate the
    context. `SatelliteAssignment` (and the `getAssignmentsForSatellite`
    RPC output) gained optional `configName` / `systemName` so the metadata
    reaches satellite-side execution; `HealthCheckService` resolves the
    system name via the catalog client.

  BREAKING CHANGE: `createHealthCheckRouter` now requires a `catalogClient`
  option (used to resolve system names for satellite assignments). Update
  call sites to pass the catalog RPC client.

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/signal-common@0.2.5
  - @checkstack/cache-api@0.3.6
  - @checkstack/queue-api@0.3.6

## 0.17.1

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/cache-api@0.3.5
  - @checkstack/queue-api@0.3.5

## 0.17.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-common@0.2.4
  - @checkstack/cache-api@0.3.4
  - @checkstack/queue-api@0.3.4

## 0.16.0

### Minor Changes

- a06b899: Dead-code audit cleanup and a small platform of shared notification helpers.

  **Removed (dead code)**

  - `core/backend/src/plugin-manager/deregistration-guard.ts` deleted. The exported `assertCanDeregister()` was never called and was a less-complete version of the dependents+isUninstallable checks already done inline by `previewUninstallOriginator` / `uninstallOriginator` in `plugin-manager-orchestrator.ts`.
  - `createMockQueueFactory` deprecated alias removed from `@checkstack/test-utils-backend`. Use `createMockQueueManager` directly.

  **New shared helpers**

  - `@checkstack/backend-api` now exports `requestTimeoutMs()` — a Zod field builder for outbound HTTP request timeouts (1s..60s, default 10s). Replaces hand-rolled `configNumber({}).min(1000).max(60_000).default(10_000)` in `integration-webhook-backend`, `integration-script-backend`, and `healthcheck-script-backend`'s inline collector.
  - `@checkstack/notification-common` now exports `SubjectStatusSchema` / `SubjectStatus`, mirroring the existing `ImportanceSchema`.
  - `@checkstack/notification-backend` now exports:
    - `SUBJECT_STATUS_EMOJI` / `IMPORTANCE_EMOJI` — the shared status / importance emoji maps that Discord, Slack, Teams, Webex and Telegram previously each redefined inline.
    - `postJson(opts)` — a timeout-bounded `fetch` wrapper that handles non-2xx logging and error mapping for webhook-style POSTs. Returns `{ ok: true, response } | { ok: false, error }`.

  **Migrated to shared helpers**

  - Discord, Slack, Gotify, Pushover notification backends now use `postJson`. Outer try/catch + per-plugin error mapping deleted (~140 LOC).
  - Discord, Slack, Teams, Telegram, Webex notification backends now use `IMPORTANCE_EMOJI`. Discord, Slack, Teams use `SUBJECT_STATUS_EMOJI`.
  - Teams, Webex, Backstage, Telegram kept their inline fetch/Bot logic: their error strings surface server response bodies to operators, or the transport isn't raw `fetch` (Telegram uses `grammy`'s `Bot`).

  **API surface tightening**

  - Per-plugin test-only re-exports in 6 notification backends (Pushover, Gotify, Backstage, Slack, Discord, Teams) and the `CertificateInfo` interface in `healthcheck-tls-backend/strategy.ts` are now JSDoc-tagged `@internal`. No behaviour change; signals that downstream consumers must not depend on them.

- a06b899: Extract shared `EsmScriptRunner` + `ShellScriptRunner` utilities, fix HIGH-severity privilege amplification in the integration TS provider, and harden the integration shell setupGuide example.

  **SECURITY FIX (HIGH)**

  The integration TS provider (`@checkstack/integration-script-backend` → `scriptProvider`) previously executed user scripts via `new Function(script)` in the satellite's main V8 isolate. A user with `integrationAccess.manage` could read `globalThis.process.env` directly (`DATABASE_URL`, `JWT_SECRET`, queue credentials, signing keys, …) and exfiltrate them through `result.id` — which round-trips into `delivery_logs.externalId` and is readable via the `getDeliveryLog` ORPC procedure. The same permission grants no legitimate API to those secrets; this was a privilege amplification.

  The provider now runs user scripts in a fresh Bun subprocess (matching the healthcheck inline-script collector model). The subprocess receives only a curated `SAFE_ENV_VARS` whitelist (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`) — backend secrets are no longer visible to user code. Filesystem reads, network calls (`fetch`), and the rest of the Node/Bun standard library continue to work, just in an isolated process.

  **BREAKING CHANGE (`@checkstack/integration-script-backend`)**

  User scripts can no longer read the satellite process's environment variables (`process.env.DATABASE_URL` etc. return `undefined`). Scripts that legitimately need configuration should accept it via the provider's `script` field input, not by introspecting the host environment. The full Node/Bun stdlib remains available; only the env scrub is new.

  **REFACTOR — new shared utilities in `@checkstack/backend-api`**

  Both the healthcheck and integration plugins had near-identical inline implementations of "run a user script in a subprocess sandbox" (ESM path) and "run a user shell script through `sh -c`" (shell path). These are now canonical, single-source-of-truth utilities:

  - **`defaultEsmScriptRunner.run({ script, context, timeoutMs, helperModuleName?, helperFunctionName? })`** — writes the user module to a fresh `mkdtemp` directory along with a generated runner module, spawns a Bun subprocess with `pickSafeEnv()`, parses the result back through a UUID-tagged stderr marker, and tears everything down in `finally` (`clearTimeout` + `proc.kill()` + recursive `rm`). The optional `helperModuleName` / `helperFunctionName` pair drops a sibling `_helpers.mjs` file and rewrites `import { <fn> } from "<module>"` to point at it (this is the trick that makes `@checkstack/healthcheck` / `@checkstack/integration` resolve at runtime even though they're not real npm packages).
  - **`defaultShellScriptRunner.run({ script, timeoutMs, cwd?, env? })`** — invokes `sh -c <script>` via `Bun.spawn` with `SAFE_ENV_VARS` (user-supplied `env` merged on top), `Promise.race` timeout with `proc.kill()` on expiry, and the same `clearTimeout` + `proc.kill()` cleanup in `finally`.

  Both runners expose `EsmScriptRunner` / `ShellScriptRunner` interfaces so tests can inject mocks without touching the spawn path. The four call sites (`plugins/healthcheck-script-backend/src/inline-script-collector.ts`, `strategy.ts` and `plugins/integration-script-backend/src/provider.ts`, `shell-provider.ts`) collapse from full inline implementations to ~8-line adapters.

  **FIXES**

  - Integration shell provider's `setupGuide` example replaced the unsafe `curl -d "{\"title\": \"$PAYLOAD_TITLE\"}"` JSON interpolation with a `jq -n --arg title "$PAYLOAD_TITLE" '{title: $title}'` pattern. The previous example demonstrated a shell-injection vulnerability whenever event payload values contained shell-special or JSON-special characters (which they can, since payloads come from other plugins / events / GitOps reconciles).
  - The shared shell runner adds `clearTimeout` + idempotent `proc?.kill()` in `finally`, fixing a leaked event-loop timer in the integration shell provider's previous inline implementation.

  **TESTS**

  - New `core/backend-api/src/esm-script-runner.test.ts` covering `normaliseUserScript` + `rewriteHelperImports` across both healthcheck and integration helper-module names, including regex-metacharacter escape coverage.
  - The plugin-local `inline-script-normaliser.test.ts` was deleted; the same coverage (plus more) lives at the canonical location with the utility.
  - Integration TS provider console-logging tests updated: in the subprocess model, `console.warn` and `console.error` both write to stderr (Bun matches Node), so the provider forwards every stderr line to `logger.error`. `console.log({…})` uses Bun's native `util.inspect` format rather than `JSON.stringify`, so the JSON-logging test now asserts on substring presence instead of strict serialisation.

  2047 tests pass, lint + typecheck clean.

### Patch Changes

- @checkstack/cache-api@0.3.3
- @checkstack/queue-api@0.3.3
- @checkstack/healthcheck-common@1.1.1

## 0.15.3

### Patch Changes

- 1909a61: Address open CodeQL code-scanning findings:

  - **`@checkstack/ui` (`LinksEditor`)**: validate URL scheme on render and on
    add; only `http:` / `https:` URLs are accepted, defeating stored XSS via
    `javascript:` / `data:` schemes in user-supplied hotlinks
    (`js/xss-through-dom`).
  - **`@checkstack/backend-api` (`markdownToPlainText`)**: decode HTML entities
    before stripping tags, then strip tags in a loop until the output
    stabilizes. Decoding `&amp;` last avoids reintroducing tag delimiters
    via `&amp;lt;` round-trips (`js/double-escaping`,
    `js/incomplete-multi-character-sanitization`).
  - **`@checkstack/backend` (`createScopedWsRegistry`)**: drop the
    identity-replacement on the path suffix; the leading-slash invariant
    is documented on `WebSocketRouteRegistry` (`js/identity-replacement`).

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

  - @checkstack/cache-api@0.3.2
  - @checkstack/queue-api@0.3.2

## 0.15.2

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1

## 0.15.1

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 0.15.0

### Minor Changes

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
  - @checkstack/common@0.8.0
  - @checkstack/queue-api@0.2.18
  - @checkstack/cache-api@0.2.4
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 0.14.1

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

  - @checkstack/cache-api@0.2.3
  - @checkstack/queue-api@0.2.17
  - @checkstack/common@0.7.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 0.14.0

### Minor Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

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

- 32d52c6: Fix and improve password reset flow + email branding:

  - **Fix**: password reset emails were failing with "Malformed password reset URL: missing token parameter". Better-auth puts the reset token in the URL path (`/reset-password/{token}`), not as a `?token=` query param, so the previous URL-parsing logic always failed. Now uses the `token` argument better-auth passes to `sendResetPassword` directly.
  - **UX**: the reset password page now validates the token on load via a new anonymous `validateResetToken` endpoint, so users see "Invalid Link" / "Link Expired" before typing a password rather than after submitting. Tokens are 24-char nanoid-style values (~143 bits of entropy), so exposing validity does not enable enumeration.
  - **Fix**: transactional notifications were hardcoded to `importance: "critical"`, causing password reset emails to display a misleading "CRITICAL" badge. The `sendTransactional` contract now accepts an optional `importance` field that defaults to `"info"`.
  - **Branding**: redesigned the email layout (`wrapInEmailLayout`) with a Checkstack-style engineering aesthetic — dark header with grid pattern, monospace importance badge, hardened CTA button (Outlook VML fallback + explicit text color), and force-light color scheme to prevent client auto-inversion from breaking text legibility.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/cache-api@0.2.2
  - @checkstack/queue-api@0.2.16

## 0.13.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/cache-api@0.2.1
  - @checkstack/queue-api@0.2.15

## 0.13.0

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
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.12.0

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
  - @checkstack/queue-api@0.2.13

## 0.11.1

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
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.11.0

### Minor Changes

- 54a5f80: ### Health Check Editor Redesign — IDE-Style Experience

  Replaces the modal-based health check editor with a full-page, IDE-style experience:

  - **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
  - **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
  - **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
  - **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
  - **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
  - **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
  - **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
  - **Responsive Design**: Split-view on desktop, stacked layout on mobile
  - **Deleted**: Legacy `HealthCheckEditor.tsx` modal component

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/queue-api@0.2.11

## 0.10.1

### Patch Changes

- Updated dependencies [1f191cf]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/queue-api@0.2.10

## 0.10.0

### Minor Changes

- 23c80bc: ### Jira Data Center Support

  Added support for on-premise Jira Data Center installations alongside existing Jira Cloud support:

  - **Authentication mode switching**: New `authMode` field (`cloud` | `datacenter`) on connection configuration. Cloud uses Basic Auth (email + API token), Data Center uses Bearer Auth (Personal Access Token).
  - **API version routing**: Automatically selects REST API v3 for Cloud and v2 for Data Center.
  - **Description format**: Cloud uses Atlassian Document Format (ADF), Data Center uses plain text.
  - **Connection schema v2**: Backward-compatible — defaults to `cloud` mode for existing connections.

  ### DynamicForm `x-hidden-when` Conditional Visibility

  New generic platform feature for conditionally hiding form fields based on sibling field values:

  - Added `x-hidden-when` metadata extension to `ConfigMeta` and `JsonSchemaProperty`.
  - DynamicForm automatically hides fields and skips their validation when conditions match.
  - Used by Jira integration to hide the email field when `authMode` is `datacenter`.

### Patch Changes

- @checkstack/queue-api@0.2.9

## 0.9.0

### Minor Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.

### Patch Changes

- @checkstack/queue-api@0.2.8

## 0.8.2

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-common@0.1.8

## 0.8.1

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
  - @checkstack/common@0.6.3
  - @checkstack/queue-api@0.2.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/signal-common@0.1.7

## 0.8.0

### Minor Changes

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

### Patch Changes

- @checkstack/queue-api@0.2.5

## 0.7.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

### Patch Changes

- @checkstack/queue-api@0.2.4

## 0.6.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.5.2

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-common@0.1.5

## 0.5.1

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.5.0

### Minor Changes

- 66a3963: Add `SafeDatabase` type to prevent Drizzle relational query API usage at compile-time

  - Added `SafeDatabase<S>` type that omits the `query` field from Drizzle's `NodePgDatabase`
  - Updated `DatabaseDeps` to use `SafeDatabase` for all plugin database injection
  - Updated `RpcContext.db` and `coreServices.database` to use the safe type
  - Updated test utilities to use `SafeDatabase`

  This change prevents accidental usage of the relational query API (`db.query`) which is blocked at runtime by the scoped database proxy.

### Patch Changes

- Updated dependencies [2c0822d]
  - @checkstack/queue-api@0.2.0

## 0.4.1

### Patch Changes

- 8a87cd4: Fixed anonymous user access to public endpoints with instance-level access rules

  The RPC middleware now correctly checks if anonymous users have global access via the anonymous role before denying access to single-resource public endpoints. Also added support for contract-level `instanceAccess` override allowing bulk endpoints to share the same access rule as single endpoints.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/queue-api@0.1.3
  - @checkstack/signal-common@0.1.3

## 0.4.0

### Minor Changes

- 83557c7: ## Multi-Type Editor Schema Support

  - Added `editorTypes` support to zod-config for multi-type editor fields
  - Extended schema-utils to handle editor type annotations

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/signal-common@0.1.2

## 0.3.3

### Patch Changes

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas
  - @checkstack/queue-api@0.1.1

## 0.3.2

### Patch Changes

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

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/signal-common@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6

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

- 827b286: Add array assertion operators for string array fields

  New operators for asserting on array fields (e.g., playerNames in RCON collectors):

  - **includes** - Check if array contains a specific value
  - **notIncludes** - Check if array does NOT contain a specific value
  - **lengthEquals** - Check if array length equals a value
  - **lengthGreaterThan** - Check if array length is greater than a value
  - **lengthLessThan** - Check if array length is less than a value
  - **isEmpty** - Check if array is empty
  - **isNotEmpty** - Check if array has at least one element

  Also exports a new `arrayField()` schema factory for creating array assertion schemas.

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- aa4a8ab: Fix anonymous users not seeing public list endpoints

  Anonymous users with global access rules (e.g., `catalog.system.read` assigned to the "anonymous" role) were incorrectly getting empty results from list endpoints with `instanceAccess.listKey`. The middleware now properly checks if anonymous users have global access before filtering.

  Added comprehensive test suite for `autoAuthMiddleware` covering:

  - Anonymous endpoints (userType: "anonymous")
  - Public endpoints with global and instance-level access rules
  - Authenticated, user-only, and service-only endpoints
  - Single resource access with team-based filtering

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
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

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
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
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 1.1.0

### Minor Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

### Patch Changes

- b4eb432: Fixed TypeScript generic contravariance issue in notification strategy registration.

  The `register` and `addStrategy` methods now use generic type parameters instead of `unknown`, allowing notification strategy plugins with typed OAuth configurations to be registered without compiler errors. This fixes contravariance issues where function parameters in `StrategyOAuthConfig<TConfig>` could not be assigned when `TConfig` was a specific type.

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/signal-common@0.1.1

## 1.0.0

### Major Changes

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

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [b55fae6]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/signal-common@0.1.0
