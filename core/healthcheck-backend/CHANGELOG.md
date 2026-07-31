# @checkstack/healthcheck-backend

## 1.23.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ai-backend@0.11.6
  - @checkstack/automation-backend@0.11.10
  - @checkstack/catalog-backend@1.10.3
  - @checkstack/incident-backend@1.14.1
  - @checkstack/catalog-common@2.8.3
  - @checkstack/healthcheck-common@1.19.2
  - @checkstack/incident-common@1.11.1
  - @checkstack/maintenance-common@1.11.1
  - @checkstack/status-page-common@0.7.1
  - @checkstack/satellite-backend@0.10.1
  - @checkstack/sdk@0.137.1
  - @checkstack/backend-api@0.35.1
  - @checkstack/satellite-common@0.12.1
  - @checkstack/status-page-backend@0.7.1
  - @checkstack/script-packages-backend@0.4.8
  - @checkstack/command-backend@0.3.1
  - @checkstack/gitops-backend@0.5.29
  - @checkstack/healthcheck-execution@0.35.2
  - @checkstack/secrets-backend@0.3.11

## 1.23.0

### Minor Changes

- 88f4333: Per-satellite offline threshold, connectivity notifications, and stop satellite-only checks going silent

  **A satellite going offline was invisible, and so were its checks.** Three
  related changes:

  **Per-satellite offline threshold.** The 45-second global constant is now a
  per-satellite override (**Offline after**, 2 minutes to 24 hours), because
  tolerance is a property of the link, not of the platform: a satellite on a flaky
  uplink needs grace that should not be forced on every other satellite. The
  threshold is carried on every row read by `computeStatus`, so the entity read,
  the admin list and the heartbeat monitor cannot disagree about the same
  satellite. Additive, nullable column - existing satellites keep the default.

  **Connectivity notifications.** Satellites are now a notification target with a
  **Satellite connectivity** subscription: a warning when a satellite stops
  heartbeating, informational when it returns. A reconnect only notifies if the
  satellite was actually offline, so a redeploy is not an event. (The same
  transitions remain available as `satellite.heartbeat_lost` / `.connected`
  automation triggers for anyone wanting different routing.)

  **Satellite-only checks no longer go silent.** BUG FIX: a check with
  `includeLocal: false` whose satellites were all offline recorded NOTHING, so it
  displayed its last known status indefinitely - a dead probe was indistinguishable
  from a passing one. The core now records a `degraded` run with a clear message.
  Degraded rather than unhealthy because the target may be fine; what failed is our
  ability to observe it. Liveness that cannot be resolved is treated as "executing"
  so a transient lookup failure cannot mark the whole fleet degraded at once.

  Checks also surface staleness: a last run older than five intervals (minimum ten
  minutes) is highlighted, so an ageing status is visible even with no run to
  explain it. Paused checks are never stale, and neither is a RETIRED slice - one
  whose environment was removed or whose satellite was unassigned - because
  warning about something you retired on purpose trains operators to ignore the
  badge.

  The unobservable run does NOT notify subscribers. One offline satellite degrades
  every check assigned to it in the same tick, and `healthy -> degraded` is an
  escalation, so notifying per check would turn a single root cause into one alert
  per check. The satellite's own connectivity subscription reports the cause once;
  the runs are still recorded, so health and the UI stay honest.

  Satellite liveness is cached on the shared platform cache with a 5s TTL. The
  executor asks per tick of every satellite-only check and the read is a full
  scan, so the uncached version scaled with the number of such checks. The TTL is
  well below the smallest offline threshold the schema allows, so a cached answer
  can lag a transition by one tick but never span one.

  Corrects the user guide, which claimed offline satellites produced failed runs -
  they produced nothing at all.

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/status-page-common@0.7.0
  - @checkstack/incident-common@1.11.0
  - @checkstack/maintenance-common@1.11.0
  - @checkstack/command-backend@0.3.0
  - @checkstack/incident-backend@1.14.0
  - @checkstack/satellite-backend@0.10.0
  - @checkstack/status-page-backend@0.7.0
  - @checkstack/notification-common@1.9.0
  - @checkstack/ai-backend@0.11.5
  - @checkstack/backend-api@0.35.0
  - @checkstack/satellite-common@0.12.0
  - @checkstack/automation-backend@0.11.9
  - @checkstack/secrets-backend@0.3.10
  - @checkstack/ai-common@0.6.8
  - @checkstack/cache-api@0.3.21
  - @checkstack/catalog-backend@1.10.2
  - @checkstack/catalog-common@2.8.2
  - @checkstack/gitops-backend@0.5.28
  - @checkstack/gitops-common@0.7.5
  - @checkstack/healthcheck-execution@0.35.1
  - @checkstack/queue-api@0.4.1
  - @checkstack/script-packages-backend@0.4.7
  - @checkstack/sdk@0.136.1
  - @checkstack/secrets-common@0.3.4
  - @checkstack/signal-common@0.3.2
  - @checkstack/cache-utils@0.3.2

## 1.22.0

### Minor Changes

- be74b01: Evaluate health per probe location, so a failing satellite can no longer read as healthy

  Thanks to @stuajnht for reporting: a system whose local check succeeded and
  whose satellite check failed was shown as **healthy**, and the report correctly
  guessed the cause - one combined verdict where there should have been one per
  location.

  A check's runs were grouped into slices by environment alone, so both locations'
  runs landed in the same slice and were handed to the threshold evaluator as one
  interleaved stream. In the default `consecutive` mode the streak breaks on every
  alternation, no threshold is ever reached, and evaluation falls through to its
  healthy default. A satellite failing 100% of the time was therefore invisible
  for as long as a local check succeeded between its runs.

  A slice is now an **(environment, source)** pair - one environment as probed
  from one location - and each is evaluated on its own window, with the worst
  result deciding the check. This is the same rule environments already followed;
  the source dimension was simply never considered. Both the system rollup and the
  system overview were affected, and both are fixed.

  Related correctness fixes that fall out of keying slices by source:

  - A **de-assigned satellite** (or the core after **Include local** is turned
    off) stops counting immediately instead of dragging the rollup with its last
    failures until they age out of the window. Its history moves under **Old
    checks**.
  - **Per-satellite environment scoping** is honoured when resolving slices, so a
    satellite narrowed to production no longer keeps a stale staging slice alive.
  - A satellite scoped to run env-less while the core fans out keeps its slice
    live; the "has a live environment slice" question is now answered per
    location, as the backend already did.

  The system overview shows one row per slice and names the location (for example
  **EU West**) as soon as a check runs from more than one place. A check that only
  ever runs on the core shows no location label - there is nothing to
  disambiguate.

  `checkStatuses[].slices` and the overview's per-slice entries carry the
  breakdown (`sourceId`, `sourceLabel`, `sourceOrphaned`) on the wire, and
  `sliceCount` / `failingSliceCount` now count locations as well as environments -
  so a check probing one environment from the core and one satellite contributes
  2 to the dashboard's "X of Y checks failing" denominator, not 1.

- be74b01: Satellites run per environment, and can be scoped to specific ones

  Satellites were handed no environment information at all, so every result they
  reported was stored env-less. On a system with environments that meant satellite
  checks contributed nothing to per-environment health - and, until the preceding
  fix, were labelled "Old checks" for it.

  A satellite now fans out exactly as the local executor does:

  - `getAssignmentsForSatellite` resolves each assignment's effective environments
    and sends them with the assignment.
  - The agent schedules ONE run per environment and reports each result with its
    `environmentId`, so per-environment history, charts and rollups include
    satellite results.
  - Collectors on a satellite now receive the `environment` run-context block, so
    `{{ environment.<key> }}` templating resolves there exactly as it does locally.

  **A satellite can also be scoped to specific environments.** Without that, every
  satellite would probe every environment - a staging-network satellite would start
  failing prod checks it has no route to, and one per-environment slice would merge
  results from satellites in different networks. A new `satelliteEnvironmentIds`
  map on the assignment scopes each satellite: an absent key means "all
  environments" (so every existing assignment behaves exactly as before), `[]` means
  one env-less run, and a list narrows to those ids. A satellite can only ever
  narrow the assignment's own selector, never widen it.

  Both protocol additions are optional, for version skew in either direction: an
  older satellite sends no `environmentId` and its runs are stored env-less as they
  always were, while an older core sends no environments and the agent falls back to
  a single env-less run.

  The assignment's Execution panel gains a per-satellite environment picker,
  shown for each assigned satellite once the system has environments.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- be74b01: Drive satellite health results through the same reactive/notify path as local runs

  A satellite-detected health change previously did almost nothing on the core:
  `ingestSatelliteResult` inserted the run row and invalidated the cache, and
  stopped there. A LOCAL run additionally drives the whole reactive layer - the
  `health` entity write (which fires the ENTITY_CHANGED that automations and
  triggers key on), the state-transition record, the subscriber notification, the
  checkCompleted/checkFailed automation hooks, and the realtime signals. So a
  satellite that detected an outage fired **no notifications, no automations, no
  transition record, and no realtime signal** - satellite monitoring was
  effectively silent.

  Both paths now run through ONE shared function, `persistRunAndReact`, so a
  satellite result reacts exactly like a local one. The host binds the service
  dependencies once and hands the router a narrowed reactor, so the local and
  satellite callers cannot pass different dependencies and drift apart again
  (`ingestSatelliteResult` was itself a duplicated-and-drifted copy of the local
  persistence path - this removes the duplication that caused it). Ingest now
  splits into `processSatelliteResult` (evaluate assertions, strip ephemeral
  fields, resolve the check name) plus the shared reactive path.

  Also fixed: a satellite collector's transport error is now annotated as
  `_collectorError` on the stored result, matching a local run - the satellite
  previously dropped that annotation.

  Coverage: added tests that a satellite result is routed through the shared
  reactor with its processed payload (guarding against a silent regression back
  to insert-only), and extracted the satellite's `executeAssignment` into a
  testable module with tests for custom-field template expansion, probe-measured
  timings, the `_collectorError` annotation, and the strategy-not-loaded path.

- be74b01: Expand system/environment custom fields in satellite health checks, via one shared execution engine

  Thanks to @stuajnht for reporting: a system or environment custom field
  referenced with `{{ system.metadata.<key> }}` / `{{ environment.<key> }}` in a
  health check was NOT expanded when the check ran on a satellite - the raw
  template reached the probe. The core queue executor grew a per-run templating
  pass, but the satellite's execution loop was a hand-maintained COPY that never
  did, so the two drifted.

  The fix removes the copy. A new lean package `@checkstack/healthcheck-execution`
  owns the shared execution engine - render the strategy + collector
  `x-templatable` fields against the run's environment/system context, build the
  transport client, run the collectors, close the client - and BOTH the core
  queue executor and the satellite now run through it. Templating, the
  secret-then-template ordering, and the per-collector fan-out therefore cannot
  drift between core and satellite again. Each side keeps only its genuine edges
  as injected hooks: the core resolves secrets from its database and does
  migrate-on-read; the satellite resolves them just-in-time over its socket.

  Also fixed: transport sub-phase timings (DNS / connect / TLS / wait / transfer)
  are now measured AT THE PROBE and reported by satellites, so a satellite run's
  `metadata.timings` matches a local run's. The core cannot derive the timing of a
  probe it did not run - and may have no route to a target a satellite can reach -
  so the satellite must produce these; the core persists them as-is.

- be74b01: Stop reporting systems as healthy when nothing has measured them

  A system whose health check had never produced a run reported `healthy` - so it
  showed green in the catalog, kept its group green, and read "operational" on the
  public status page. A system with no checks at all did the same. For a
  monitoring product that is the worst possible default: the one state you must
  never invent is the reassuring one.

  `getSystemHealthStatus` began each check at `healthy` and each system's
  aggregate at `healthy`, then only ever downgraded. With no runs to examine,
  nothing downgraded them. `HealthCheckStatus` had no way to say "not measured".

  A new `SystemHealthStatus` adds `unknown` for systems and their checks. It is
  deliberately NOT a run status - a run that happened is always healthy, degraded
  or unhealthy, and the database enum stays three-valued. Now:

  - A check with no runs is `unknown`, not `healthy`.
  - A system reports `unknown` when no check contributed a signal. A system with
    one healthy check and one never-run check still reads `healthy`: it has
    positive evidence, and the unmeasured check is visible on its own page.
  - The catalog reports `unknown` by OMISSION, which its group rollup already
    treats as "no signal" - so a group with an unmeasured member stops claiming to
    be healthy. That is the reported bug.
  - The public status page maps it to its existing `unknown`, which is ignored for
    the overall banner unless everything is unknown. One unmeasured system no
    longer claims "operational" for itself, and does not panic the whole page.
  - A first measurement records a transition with a NULL `fromStatus` - the column
    was already nullable for exactly this case - instead of pretending the system
    was healthy beforehand.
  - Automations matching on `unhealthy` do not fire for a merely unmeasured
    system, which is correct: an unmeasured system is not a detected outage.

  Dependency warnings deliberately keep their current behaviour: an unmeasured
  upstream raises no warning, and a never-run check is dropped from the evaluation
  rather than counted as passing.

  Note that pausing a system's only check now leaves it `unknown` rather than
  `healthy`. Paused failures still do not keep a system degraded - that behaviour
  is unchanged - but with nothing running, the system is genuinely unmeasured.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ai-backend@0.11.4
  - @checkstack/notification-common@1.8.0
  - @checkstack/incident-backend@1.13.6
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/satellite-backend@0.9.4
  - @checkstack/healthcheck-execution@0.35.0
  - @checkstack/status-page-backend@0.6.6
  - @checkstack/status-page-common@0.6.5
  - @checkstack/automation-backend@0.11.8
  - @checkstack/secrets-backend@0.3.9
  - @checkstack/catalog-backend@1.10.1
  - @checkstack/catalog-common@2.8.1
  - @checkstack/incident-common@1.10.5
  - @checkstack/maintenance-common@1.10.5
  - @checkstack/script-packages-backend@0.4.6
  - @checkstack/sdk@0.135.1
  - @checkstack/backend-api@0.34.1
  - @checkstack/command-backend@0.2.27
  - @checkstack/gitops-backend@0.5.27

## 1.21.3

### Patch Changes

- 6c8b36b: Promote the health-check run-queue contract and the observability window
  math into `@checkstack/healthcheck-common`: `HEALTH_CHECK_QUEUE`,
  `HealthCheckJobPayload`, `fastPathJobId` (per-plugin prefix) and
  `computeWindowBounds`/`computeSecondsSinceLast` now have ONE definition
  that the queue owner (healthcheck-backend) and every observability
  strategy plugin import, replacing the per-plugin mirror copies that had
  to be kept in lock-step by convention. Enqueued job ids and window
  semantics are byte-identical; this is a drift-proofing refactor, not a
  behavior change.
- 6c8b36b: Run the config-secrets backfill in afterPluginsReady instead of init.
  Health-check strategies contributed by other plugins register during THEIR
  init, and plugin init order follows the service-ref graph, so running the
  backfill during healthcheck's own init could scan configurations before a
  contributor (e.g. logstream's health strategy) had registered - skipping
  that strategy's config with a "strategy not registered" warning at boot.
  Only afterPluginsReady guarantees a complete registry. The backfill is
  idempotent, so any configuration skipped by an earlier boot is picked up
  on the next one.
- 6c8b36b: Promote the t-digest percentile helpers from healthcheck-backend into
  backend-api (`createTDigest`, `serializeTDigest`, `deserializeTDigest`,
  `mergeTDigestStates`, `percentileFromState`, ...), so any plugin can maintain
  mergeable percentile sketches; tracestream's per-operation p95 buckets are the
  first new consumer. healthcheck-backend now imports the shared module (the
  local copy is removed, no behavior change).
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/ai-backend@0.11.3
  - @checkstack/backend-api@0.34.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/common@0.23.0
  - @checkstack/catalog-backend@1.10.0
  - @checkstack/status-page-backend@0.6.5
  - @checkstack/automation-backend@0.11.7
  - @checkstack/incident-backend@1.13.5
  - @checkstack/script-packages-backend@0.4.5
  - @checkstack/sdk@0.133.1
  - @checkstack/command-backend@0.2.26
  - @checkstack/gitops-backend@0.5.26
  - @checkstack/satellite-backend@0.9.3
  - @checkstack/secrets-backend@0.3.8
  - @checkstack/incident-common@1.10.4
  - @checkstack/maintenance-common@1.10.4
  - @checkstack/status-page-common@0.6.4
  - @checkstack/ai-common@0.6.7
  - @checkstack/cache-api@0.3.20
  - @checkstack/gitops-common@0.7.4
  - @checkstack/notification-common@1.7.2
  - @checkstack/secrets-common@0.3.3
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1

## 1.21.2

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ai-backend@0.11.2
  - @checkstack/automation-backend@0.11.6
  - @checkstack/catalog-backend@1.9.2
  - @checkstack/incident-backend@1.13.4
  - @checkstack/ai-common@0.6.6
  - @checkstack/backend-api@0.33.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/gitops-backend@0.5.25
  - @checkstack/gitops-common@0.7.3
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/incident-common@1.10.3
  - @checkstack/maintenance-common@1.10.3
  - @checkstack/notification-common@1.7.1
  - @checkstack/queue-api@0.3.19
  - @checkstack/satellite-backend@0.9.2
  - @checkstack/script-packages-backend@0.4.4
  - @checkstack/sdk@0.132.0
  - @checkstack/secrets-backend@0.3.7
  - @checkstack/secrets-common@0.3.2
  - @checkstack/signal-common@0.3.0
  - @checkstack/status-page-backend@0.6.4
  - @checkstack/status-page-common@0.6.3

## 1.21.1

### Patch Changes

- Updated dependencies [6540703]
- Updated dependencies [099045f]
  - @checkstack/ai-backend@0.11.1
  - @checkstack/automation-backend@0.11.5
  - @checkstack/catalog-backend@1.9.1
  - @checkstack/incident-backend@1.13.3
  - @checkstack/secrets-backend@0.3.7
  - @checkstack/satellite-backend@0.9.1
  - @checkstack/status-page-backend@0.6.3

## 1.21.0

### Minor Changes

- a74fa01: Relocate health-check assignment management from the catalog-entered,
  system-centric Assignment IDE into the check editor itself, so a check's
  settings AND its assignments (with their per-system settings) are managed in
  one place. Users think in terms of "Health Checks", not the catalog - the
  old flow was discovered through a catalog system row and inverted that mental
  model.

  - **Check editor Assignment section** (edit mode): lists every assigned
    system as a tree group with the per-assignment panels (General, Thresholds,
    Retention, Execution with satellites + environment fan-out, Notifications)
    plus an "Assign to system..." picker that only offers systems the caller
    can manage. The `AssignmentIDENodeSlot`/`AssignmentIDEPanelSlot` extension
    points keep their names and context shape - extension node ids are
    namespaced per system internally so config-keyed ids (e.g. the anomaly
    panels) no longer collide across systems.
  - **New procedure `getConfigurationAssignments`** (config → systems, the
    inverse of `getSystemAssociations`), handler-authorized fail-closed: global
    configuration read or a team grant on the configuration sees every row;
    otherwise rows filter to systems the caller may read.
  - **`getConfiguration` relaxed** (handler-authorized): a reader of an
    ASSIGNED system may load the (redacted) configuration - the same exposure
    `getSystemConfigurations` already allowed - so system managers can open the
    editor. Unauthorized callers still get the same `undefined` as a missing id.
  - **RLAC**: the edit and config routes now declare
    `manageCapability.parentType: catalog.system`, so a pure system manager
    reaches the editor for its Assignment section; the config side renders
    read-only for them (Save disabled, strategies/collectors/access-control
    gated per-node) while their systems' assignment panels stay writable.
    GitOps-locked systems lock exactly their own assignment nodes.
  - **Catalog wayfinding**: the per-system row button is now a
    "Manage health checks" link opening the Health Checks list pre-filtered to
    that system (`?system=<id>`); the filtered list loads via the
    system-read-gated `getSystemConfigurations`, so it also works for system
    managers without healthcheck grants.

  BREAKING CHANGES: the standalone system-centric assignment page is removed -
  the `healthcheck` plugin's `assignments` route (`/assignments/:systemId`) no
  longer exists and `healthcheckRoutes.routes.assignments` is gone from
  `@checkstack/healthcheck-common`. Deep links to the old page now 404; use the
  check editor's Assignment section (or the filtered Health Checks list)
  instead.

- 4568dcc: Expose health check environment resolution to cross-plugin callers via a new
  `resolveEnqueueEnvironments({ configId, systemId })` procedure. It returns the
  effective environment ids a one-off run should enqueue for (or `[null]` for an
  env-less system) - the same fan-out the `run_now` automation and the recurring
  scheduler use. Gated by any healthcheck read capability (`typeScoped` read),
  consistent with the other utility reads.

  This lets a cross-plugin health trigger enqueue exactly the environment slices
  the run executor accepts. Previously such a caller could only enqueue an env-less
  run (`environmentId: null`), which the executor drops as stale for a system that
  has effective environments - so the trigger was a silent no-op for env-assigned
  systems. The log-stream fast-path health trigger is the first consumer (covered
  by the existing log streams changeset).

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

- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [d9f2771]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ai-backend@0.11.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/satellite-backend@0.9.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/backend-api@0.33.0
  - @checkstack/catalog-backend@1.9.0
  - @checkstack/automation-backend@0.11.4
  - @checkstack/incident-backend@1.13.2
  - @checkstack/sdk@0.130.1
  - @checkstack/ai-common@0.6.6
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/gitops-backend@0.5.25
  - @checkstack/gitops-common@0.7.3
  - @checkstack/incident-common@1.10.3
  - @checkstack/maintenance-common@1.10.3
  - @checkstack/notification-common@1.7.1
  - @checkstack/queue-api@0.3.19
  - @checkstack/script-packages-backend@0.4.4
  - @checkstack/secrets-backend@0.3.7
  - @checkstack/secrets-common@0.3.2
  - @checkstack/status-page-backend@0.6.2
  - @checkstack/status-page-common@0.6.3

## 1.20.1

### Patch Changes

- Updated dependencies [1f20b5a]
- Updated dependencies [5e704cd]
  - @checkstack/ai-backend@0.10.12
  - @checkstack/automation-backend@0.11.3
  - @checkstack/catalog-backend@1.8.1
  - @checkstack/incident-backend@1.13.1
  - @checkstack/sdk@0.129.1
  - @checkstack/catalog-common@2.7.2
  - @checkstack/healthcheck-common@1.16.2
  - @checkstack/incident-common@1.10.2
  - @checkstack/maintenance-common@1.10.2
  - @checkstack/status-page-common@0.6.2
  - @checkstack/satellite-backend@0.8.6
  - @checkstack/script-packages-backend@0.4.3
  - @checkstack/backend-api@0.32.1
  - @checkstack/status-page-backend@0.6.1
  - @checkstack/command-backend@0.2.24
  - @checkstack/gitops-backend@0.5.24
  - @checkstack/secrets-backend@0.3.6

## 1.20.0

### Minor Changes

- bd41130: perf(healthcheck): stop recomputing the full system rollup on every check run

  The queue run executor captured the system-wide rollup health
  (`getSystemHealthStatus(systemId)`) at the start of EVERY check tick - a
  worst-wins aggregate that fans out an N+1 of windowed `health_check_runs` reads
  across every check × environment of the system. That value was only ever
  consumed on the rare catastrophic-failure path (a job that throws before running
  any probe); the normal success/failure paths record their transition from the
  per-environment pre-read and never touched it. Under load this was one of the
  heaviest repeated reads on the hot path.

  The rollup pre-status is now computed lazily, only inside the catastrophic-
  failure branch that actually uses it. Behavior is unchanged - the catastrophic
  path reads the same pre-tick rollup (it is reached only when the run threw before
  inserting anything, so nothing changed in between) - but every normal check tick
  no longer pays for a full rollup recompute it discards.

- bd41130: perf(healthcheck): add system-leading aggregate and config-reverse indexes

  Add two Postgres indexes (migration 0020) to serve reads that the existing
  keys cannot cover:

  - `health_check_aggregates_system_bucket_idx` on
    `(system_id, bucket_size, bucket_start)`. The health-state read omits
    `configuration_id`, so the leading-`configuration_id` unique index could
    not be used and the query scanned the aggregates table. This index leads
    with `system_id` so those reads use an index instead.
  - `system_health_checks_config_enabled_idx` on `(configuration_id, enabled)`.
    The reverse lookup in `getSystemIdsForConfiguration` (config-change
    recompute) filters by `configuration_id`, but the primary key leads with
    `system_id` and could not serve it. This index makes the config-scoped
    lookup an index scan.

- bd41130: perf(healthcheck): add the missing composite indexes on health_check_runs

  The status read path reads the last N runs for a (system, check[, environment])
  slice ordered by `timestamp DESC` on every status read AND on every check
  execution, but `health_check_runs` had NO secondary indexes - only its primary
  key. Every such read was a full sequential scan of the (multi-million-row) table
  plus an in-memory sort, so point reads averaged 50-320 ms and dominated total DB
  time. Two composite indexes now back these access patterns:

  - `health_check_runs_check_recent_idx` (system_id, configuration_id, timestamp) -
    the cross-environment newest-run reads and the retention `DELETE`.
  - `health_check_runs_slice_recent_idx` (system_id, configuration_id,
    environment_id, timestamp) - the env-scoped slice reads, the per-check
    DISTINCT-environment discovery, and the per-env last-healthy `max(timestamp)`
    group-by.

  Both turn full-table seq-scans into index range scans (Postgres scans the btree
  backward for the `DESC` order).

  > [!IMPORTANT]
  > Deploy note: the migration builds the indexes with a plain (non-CONCURRENT)
  > `CREATE INDEX`, which briefly locks writes to `health_check_runs` while each
  > index builds (the migrator runs every migration in one transaction, so
  > `CREATE INDEX CONCURRENTLY` is not possible through it). On a very large table
  > you can build them `CONCURRENTLY` by hand (same names) before deploying; the
  > migration uses `IF NOT EXISTS`, so it then no-ops.

- bd41130: perf(healthcheck): cache system health status on the shared distributed cache with per-check-vector invalidation

  The per-system derived health status (`getSystemHealthStatus`) is an N+1 over
  `health_check_runs` across every check × environment, and it backs the highest
  call-count read paths: the dashboard badges, the bulk status endpoint, the
  per-(system, check, environment) matrix the dependency map and status-page
  widgets consume, and the AI system-signals scan. It was only cached for the
  single/bulk rollup, was invalidated UNCONDITIONALLY on every check run (so a
  steady-state healthy system evicted its own cache every tick), the matrix
  endpoint was not cached at all, and the AI signals scan bypassed the cache with
  its own uncached N+1.

  All four reads now go through a single `HealthCheckCache` facade - built on the
  **platform `CacheManager`** - that is the ONE sanctioned reader AND invalidator
  of a system's status:

  - **Reads** (`read` / `readBulk` / `readMatrix`) are served read-through, keyed
    per `(system, environment)`, holding the RAW (pre-incident-override) status;
    the router folds incident overrides downstream, so an incident change never
    touches this cache. The matrix reuses the same per-environment entries the
    badge path warms. The AI signals contributor now scans candidate systems from
    the durable table and resolves their statuses through `readBulk`, reusing the
    warm cache instead of a fresh N+1.
  - **Invalidation is change-gated on the per-check status VECTOR**, not the run:
    `reconcile(previous, next)` evicts only when a check actually flipped status
    (or its slice-failure composition changed) - a `statusFingerprint` invariant
    to the volatile `evaluatedAt` / `lastRunAt` / `runsConsidered`. A run that
    leaves the vector unchanged keeps the cache warm. This also catches a per-check
    flip that leaves the rollup enum unchanged (which the reactive `health` entity
    view would miss). A per-environment run that changes its slice evicts BOTH its
    env key AND the system rollup key (the slice feeds the worst-wins rollup), so a
    simultaneous slice swap - one env recovering as another fails, which the
    rollup's own fingerprint is blind to - still refreshes the rollup. Sibling
    environment keys stay warm.

  Cross-pod coherence comes from the SHARED cache backend, not from an application
  broadcast: with a distributed provider (Redis) an eviction is a `delete` every
  pod sees immediately. On the default in-memory backend the cache is per-pod and
  therefore single-instance-only (the Infrastructure Cache UI now warns about
  this). The cached value is a derivation of the shared `health_check_runs` tables,
  so a miss recomputes the same answer on every pod; the 15s TTL is only a
  natural-refresh safety net.

  Enforced by design, not convention:

  - Every status-mutating writer invalidates through the facade: the run executor,
    the router config/assignment/satellite handlers, the system/satellite lifecycle
    hooks, AND the GitOps apply path (create/update/delete/associate/disassociate),
    which writes configs directly on the service rather than through the router and
    would otherwise have stranded a stale status until the TTL.
  - A `checkstack/no-direct-system-status-read` lint rule (error) forbids raw
    `service.getSystemHealthStatus(...)` reads anywhere except the cache facade and
    the executor / entity-compute paths that must read live to detect a transition.
  - A `checkstack/no-direct-health-run-insert` lint rule (error) forbids raw
    `insert(healthCheckRuns)` outside the executor / service run writers.

  The executor's per-run change-gate reads its pre-run baseline INSIDE the
  per-(system, environment) advisory-lock critical section (not before the probe),
  so a concurrent same-slice run cannot commit between the baseline read and the
  insert and cause the gate to miss a real transition.

  Behavior is unchanged for readers (same values, strictly fresher than the prior
  15s-stale-on-quiet-systems behavior). The `getSystemHealthStatus` /
  `getBulkSystemHealthStatus` / `getBulkSystemHealthMatrix` RPC contracts are
  untouched, so cross-plugin callers (dependency, SLO, status-page) need no change.

- bd41130: fix(status-page): scope email subscriptions to published environments and author-selected systems

  Two correctness fixes to status-page email subscriptions:

  - **Health notifications now respect the page's published environments.** A
    per-environment health transition carries the environment it happened in
    (`originEnvironmentId`, threaded through `notifyForSubscription` ->
    `NotificationAudienceEvent` -> the status-page fan-out). A page that publishes
    a specific environment set is now skipped for a change in an environment it
    does not publish - so a `development` failure never emails a prod-only page's
    subscribers, even for a system that is also shown in prod. Pages publishing all
    environments, and env-less sources (incident, maintenance, whole-system health
    rollup), are unaffected.
  - **Notifications are scoped per category to the widgets the author placed.** The
    send-time fan-out now surfaces a notification only through widgets of its own
    category: a health status change reaches a page only through a HEALTH widget
    (`banner` / `systemHealth` / `groupStatus` / `uptime`, which now implement
    `resolveScopedSystems` and declare `subscriptionCategory: "health"`), an
    incident only through an incident widget, and so on. A page that lists a
    system's incidents but never its health no longer emails health subscribers
    about it, and a health-only page now correctly surfaces its systems for
    subscription. Health widgets also participate in the public subscribe picker.

  BREAKING CHANGE: on a page publishing a specific environment set, health
  subscribers now only receive changes that occurred in a published environment
  (previously any environment of a surfaced system triggered a notification), and a
  notification is surfaced only by a widget of its own category (previously any
  scoping widget on the page could surface any category). Legacy subscribers (NULL
  categories) and all-environment pages are unchanged; no data migration is needed.

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/cache-utils@0.3.0
  - @checkstack/catalog-backend@1.8.0
  - @checkstack/ai-backend@0.10.11
  - @checkstack/incident-backend@1.13.0
  - @checkstack/notification-common@1.7.0
  - @checkstack/status-page-backend@0.6.0
  - @checkstack/automation-backend@0.11.2
  - @checkstack/command-backend@0.2.23
  - @checkstack/gitops-backend@0.5.23
  - @checkstack/satellite-backend@0.8.5
  - @checkstack/script-packages-backend@0.4.2
  - @checkstack/secrets-backend@0.3.5
  - @checkstack/catalog-common@2.7.1
  - @checkstack/sdk@0.128.1
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/incident-common@1.10.1
  - @checkstack/maintenance-common@1.10.1
  - @checkstack/status-page-common@0.6.1

## 1.19.0

### Minor Changes

- 43e4484: Fix an N+1 in the catalog manager: the per-system "Health Checks" count badge
  fired one `getSystemAssociations` request per system row, each holding a pooled
  Postgres connection that contended with the background health-check run
  executor and could exhaust the pool on large catalogs.

  - Add `getBulkAssignedHealthCheckCounts({ systemIds })` to healthcheck, which
    returns per-system assignment counts (0 for systems with no assignments) from
    ONE grouped `COUNT(*) ... GROUP BY system_id` query. Read authorization
    matches the per-system endpoint it replaces (`configuration.read` +
    `catalog.system` read via `recordKey`), so a team-scoped user only sees counts
    for systems they may read.
  - `CatalogSystemActionsSlot` now passes `visibleSystemIds` (every system id in
    the row's list) so a per-row filler can bulk-fetch for the whole visible set
    in a single deduped request instead of one request per row. This mirrors how
    `CatalogBrowseHealthSlot` / `SystemSignalsSlot` already pass `systemIds`.
  - The health-check count badge now reads its count from that one deduped bulk
    query. N visible rows cause 1 request instead of N.

  State & scale: the counts are derived on read from the shared
  `system_health_checks` table, so every pod returns the same answer; no
  process-local or duplicated state is introduced.

- 43e4484: Name the failing health check in system-health notifications. The notification
  body now names the check that drove the transition (in addition to the system
  and environment), and a `healthcheck.healthcheck` subject is pushed alongside
  the `catalog.system` subject, deep-linked to the check's run history. Recovery
  notifications stay system-level. Adds a `createHealthcheckSubject` builder to
  `healthcheck-common`.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- 43e4484: Status pages can now publish only a subset of catalog environments. The page
  builder gains a "Published environments" picker (empty = all environments, the
  backward-compatible default). When a non-empty set is selected, the page omits
  status, incidents, maintenances and uptime for systems that belong to none of
  the selected environments.

  - Status pages store an optional `publishedEnvironmentIds` set (new nullable
    `published_environment_ids` column; NULL = all environments, so existing pages
    are unchanged) exposed on `StatusPage`, `createStatusPage`, and
    `updateStatusPage`.
  - The scope is threaded onto `WidgetResolveContext.publishedEnvironmentIds` as
    opaque strings and passed identically to `resolvePublic`,
    `resolveScopedSystems`, and `resolveScopedSystemsDetailed` (and the email
    subscribe clamp + fan-out), so what a page shows, offers for subscription, and
    emails about all agree.
  - Health widgets recompute per environment: they read the per-environment health
    matrix and roll up only the selected environments. `getBulkRunStats` and
    `getRunStats` gain an optional `environmentIds` filter so uptime counts only
    runs recorded in the selected environments.
  - Incident and maintenance widgets filter their feed and scope by intersecting
    each item's affected systems with the environment-visible systems. Incidents
    and maintenance windows carry no environment of their own, so a system in
    several environments makes its items visible on a page publishing ANY of them
    (the multi-environment caveat).

### Patch Changes

- 43e4484: fix(healthcheck): disabling an environment for an assignment now clears its stale slice from the rollup and overview immediately

  Disabling an environment for a health-check assignment (removing it from the
  assignment's `environmentIds`) stopped that environment from fanning out, but a
  check that was FAILING there kept dragging the system health rollup/badge to
  unhealthy and kept showing as a live failing row in the system overview. Because
  the rollup is recomputed by an event-driven consumer subscribed to per-env health
  CHANGES, and a disabled env produces no further runs (so no change event fires),
  the stale unhealthy status was never recomputed away - it only cleared
  incidentally, once the disabled env's runs aged out of the bounded run window
  (which needs the assignment's OTHER active environments to produce enough newer
  runs first). With a single active/failing env, it could persist until retention.

  Scope: this reconciles environments DISABLED/removed ON THE ASSIGNMENT (its
  `systemHealthChecks.environmentIds` selector - switching to Specific and
  deselecting, or None).

  Fixes:

  - The rollup aggregation (`getSystemHealthStatus`) and the per-check status in
    `getSystemHealthOverview` now consider only CURRENTLY-EFFECTIVE environment
    slices, derived from the durable `systemHealthChecks.environmentIds` selector
    (catalog-free, identical on every pod). A slice whose environment was disabled
    for the assignment, or the stale env-less slice of a check that now fans out,
    no longer contributes.

  Known limitation: under an "all-environments" assignment (`environmentIds` is
  `null`), an environment removed only from the system's CATALOG MEMBERSHIP (rather
  than disabled on the assignment) can still contribute to the backend rollup/badge
  until the assignment is re-evaluated, because the rollup read path is
  intentionally catalog-free for horizontal-scale correctness (it must return the
  same answer on every pod without a per-read catalog lookup). This is pre-existing;
  the frontend overview, which can see membership, still orphans such a slice.

  - Each environment is now windowed by its OWN query in the rollup, instead of a
    single shared `LIMIT` across the mixed-env pool. The old shared window
    truncated per-env evaluation for checks that fan out to many environments (or
    with large threshold windows); every environment now gets its full evaluation
    depth.
  - Changing an assignment's environment set now triggers an immediate rollup
    recompute for that system, so the persisted `health` entity (badge + SLO
    downtime) converges at once rather than waiting for stale runs to age out.
  - The system-overview frontend tucks a slice whose environment was disabled for
    the assignment under "Old checks" (system membership alone could not detect it,
    since the environment is still part of the system). `getSystemHealthOverview`
    now returns each check's `environmentIds` selector to drive this.

  Shared pure helpers `selectorIncludesEnvironment` / `isEnvSliceEffective` /
  `selectEffectiveEnvKeys` are added to `@checkstack/healthcheck-common` so the
  backend and frontend agree on effective-slice detection.

- 43e4484: Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

  The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

  - healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
  - incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
  - ai: `appendMessage`, memory `saveOrUpdate`.
  - notification: `resolveInheritedGroups`.
  - status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
  - announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
  - gitops: `upsertProvenance`.

- 43e4484: Eliminate N+1 RPC fan-outs in the public status-page widget resolvers.

  Each of these widgets renders a PUBLIC page, so every per-item RPC was real
  external DB load. Three bulk-by-id endpoints replace the per-item fetches:

  - `healthcheck-common`: new `getBulkRunStats({ systemIds, startDate, endDate,
maxBuckets })` -> `{ stats: Record<systemId, RunStats> }`. The `systemHealth`
    widget's uptime column now issues ONE request for all systems instead of one
    `getRunStats` per system. Systems with no runs in the window are omitted, so
    the resolver's output is unchanged.
  - `incident-common`: new `getBulkIncidentUpdates({ incidentIds })` ->
    `{ updates: Record<incidentId, IncidentUpdate[]> }`. The incidents widget now
    fetches every selected incident's update timeline in ONE request instead of
    one `getIncident` per incident.
  - `maintenance-common`: new `getBulkMaintenanceUpdates({ maintenanceIds })` ->
    `{ updates: Record<maintenanceId, MaintenanceUpdate[]> }` (symmetric with the
    incident endpoint) for the maintenance widget.

  The new update endpoints apply the same per-item audience filter as
  `getIncident` / `getMaintenance`, so internal/logged-in updates and author
  identity never leak to a non-manager caller. Each endpoint is keyed by the
  resource id and gated with the record post-filter (`recordKey`) matching the
  single endpoint's read scope, mirroring `getBulkSystemHealthStatus` /
  `getBulkIncidentsForSystems`. Widget DTO output is unchanged - this is a pure
  request-count optimization.

- 43e4484: Status page enhancements:

  - Group-status widget can collapse its member rows while every member is
    operational (auto-expanding on any issue or maintenance).
  - New "Announcements" status-page widget, contributed fully externally by the
    announcement plugin: it surfaces active `visibility: "all"` announcements
    through a public-safe DTO (title/message/severity/timestamps only) and never
    affects the page status rollup.
  - Incident and maintenance widgets can scope by catalog GROUPS with per-system
    exceptions. Scope is resolved at read time (`(systemIds ∪ members(groupIds)) −
excludedSystemIds`), so members added to a group later are reflected
    automatically. The builder gets a nested group/system picker.
  - Incident and maintenance items on a public page link to dedicated public
    detail pages, gated server-side to items the page's published widgets actually
    surface (no enumeration, no internal-field leak). The custom-domain public
    bundle gains a minimal in-memory router for the two detail pages.
  - Fix the custom-domain "Cannot connect to Checkstack backend" screen: a
    configured-but-not-servable custom domain now serves the lean public
    "not available" page instead of the admin shell; the public bundle skips the
    cross-origin `/api/config` probe; CORS admits resolved custom domains; the
    request origin is normalized for proxy scheme/port variance; and re-saving an
    unchanged custom domain no longer clears its verification.
  - Anonymous email subscriptions (double opt-in) for incident updates, opt-in per
    status page (`emailSubscriptionsEnabled`, default off): a new
    `status_page_subscribers` table, public subscribe/verify/unsubscribe
    procedures with constant-time responses that fail closed when the page has not
    enabled subscriptions, and team-scoped admin list/remove + an enable toggle in
    the builder. Emails are delivered through a new `sendRawEmail` primitive in
    notification-backend that sends to an arbitrary external address (no auth
    account) via every enabled email strategy (SMTP), with a mandatory unsubscribe
    link.
  - Incident/maintenance update fan-out to subscribers via a new
    `notificationAudienceExtensionPoint` in notification-backend. Every
    notification funnelled through `notifyForSubscription` (incident, maintenance,
    health - all unchanged) now also invokes each registered audience sink exactly
    once, enriched with the affected systems and their catalog groups (resolved
    from notification-backend's own resource-parent graph, never a domain import).
    status-page-backend contributes a sink that, AT SEND TIME, matches each
    notification's affected systems against the systems each published + public +
    email-enabled page currently surfaces in its incident/maintenance widgets
    (honoring group membership and per-system exclusions) and emails that page's
    verified subscribers. Send-time scoping against the live layout is the privacy
    boundary: a page only ever emails about systems its widgets surface right now.
    Because `notifyForSubscription` is a single-pod point RPC, each notification
    fans out exactly once cluster-wide.
  - Subscriber reconcile on page deletion: the subscriber FK is `ON DELETE
CASCADE` and page deletion also explicitly purges subscribers (invalidating
    pending verify/unsubscribe tokens) - no orphan rows, no post-deletion send.
    Removing all systems from a page or disabling email is intentionally NOT a
    prune: send-time scoping plus the email-enabled gate make those subscribers
    dormant with no data loss, and re-enabling restores the audience without a
    re-subscribe.
  - Send-time scoping is single-source: the fan-out asks each event-feed widget for
    its CURRENT effective system scope (the same live catalog group expansion the
    widget renders from) instead of a parallel copy of group membership, so it can
    never over- or under-deliver relative to what the page shows.
  - `sendRawEmail` in notification-backend is now `userType: "service"` (was an
    authenticated procedure gated on `notification.send`). Sending to an arbitrary
    address is an open-relay / email-bomb primitive, so it is callable only by a
    trusted backend-to-backend caller (the status-page subscriber mailer), never by
    an end user.
  - Incident/maintenance widgets gain an optional per-system PUBLIC label override
    (`systemLabels`), the same override path the system-health widget uses, so the
    public incident/maintenance detail pages present clean labels instead of raw
    catalog names.
  - The anonymous subscribe endpoint adds a coarse per-page quota (max new
    subscribers per rolling hour, counted over durable rows so it holds across
    pods) on top of the per-(page,email) cooldown, capping verification-email
    amplification. The quota is CONFIGURABLE per status page (new nullable
    `email_subscribers_hourly_quota` column; null uses the default of 50, so
    existing pages are unchanged), validated as a positive integer up to 5000,
    editable in the builder next to the email opt-in toggle and gated by the same
    page-manage capability.
  - Email verification is now per-page configurable and backed by a platform-global
    once-per-address registry:
    - New `email_verification_required` column (boolean, default true) on
      `status_pages`, exposed on the admin StatusPage DTO + `updateStatusPage`
      input (same page-manage gate) with a builder toggle. When OFF, a new
      subscriber is created active immediately - no verification email, and the
      address is NOT written to the global registry (the operator's trust choice
      for e.g. an internal page).
    - New `status_page_verified_emails` table: one row per normalized address that
      has completed verification on ANY page. When a verification-required page is
      subscribed by an already-globally-verified address, the row is created active
      immediately and a COURTESY email (with one-click unsubscribe) is sent instead
      of a verification email, so a malicious add is always caught. `verify` upserts
      the address into this registry and activates every other pending row for the
      same address in one update (confirm once, all pages).
    - Fan-out is unchanged: it still gates on the per-row `verified` flag; the
      registry only governs whether a NEW subscribe short-circuits to active.

  BREAKING CHANGE: `sendRawEmail` is now service-only. Any (non-existent in-tree)
  authenticated caller must invoke it through a trusted service client instead.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ai-backend@0.10.10
  - @checkstack/automation-backend@0.11.1
  - @checkstack/catalog-common@2.7.0
  - @checkstack/catalog-backend@1.7.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/backend-api@0.31.1
  - @checkstack/incident-common@1.10.0
  - @checkstack/incident-backend@1.12.0
  - @checkstack/maintenance-common@1.10.0
  - @checkstack/notification-common@1.6.0
  - @checkstack/status-page-backend@0.5.0
  - @checkstack/gitops-backend@0.5.22
  - @checkstack/secrets-backend@0.3.4
  - @checkstack/status-page-common@0.6.0
  - @checkstack/satellite-backend@0.8.4
  - @checkstack/sdk@0.127.1
  - @checkstack/command-backend@0.2.22
  - @checkstack/script-packages-backend@0.4.1

## 1.18.0

### Minor Changes

- 8aae4e2: Count fanned-out environment slices in the dashboard's "X of Y checks failing".

  The dashboard problem card counted CHECKS, so a system with a single check that
  fans out to three environments showed "Unhealthy 1 of 1 checks failing" even
  when only one of the three environments was failing. It now counts (check ×
  environment) slices: that system reads "1 of 3 checks failing", and a system
  with a three-environment check plus a single-environment check with one
  environment failing reads "1 of 4 checks failing". An env-less check counts as a
  single slice, so a system with no environments reads exactly as before.

  The per-check status DTO (`SystemCheckStatus`, returned by
  `getSystemHealthStatus` / `getBulkSystemHealthStatus` /
  `getBulkSystemHealthMatrix`) gains two fields: `sliceCount` (environment slices
  this check currently fans out to, always >= 1) and `failingSliceCount` (how many
  of those slices are non-healthy). `deriveHealthcheckSignals` sums them across
  checks for the honest numerator/denominator.

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

- 8aae4e2: Show the last successful run per check (or per check+environment when fanned
  out) in the system overview.

  Each overview row that is currently degraded or unhealthy now shows when it was
  last healthy (for example "Healthy until 2h ago", or "Never healthy" when it has
  never succeeded), so operators can see at a glance since when a system has been
  degraded or unhealthy without opening the drawer.

  `getSystemHealthOverview` gains a `lastSuccessfulRunAt` field at both the check
  level (most recent healthy run across all of the check's environments) and per
  environment (`perEnvironment[].lastSuccessfulRunAt`). It is computed with a
  dedicated max-per-environment aggregate query OUTSIDE the bounded sparkline
  window, so it stays accurate even when a check has been failing for far longer
  than the last runs shown in the sparkline.

### Patch Changes

- 8aae4e2: Stop sending a duplicate notification when a fanned-out system goes unhealthy.

  A health check that fans out across environments notified once per environment
  ("... is unhealthy in environment X") AND once more for the system rollup
  ("... is unhealthy") in the same tick, so operators received two notifications
  describing the same outage. The rollup transition is always driven by the very
  environment(s) that already notified, so the rollup notification is now
  suppressed whenever any environment notified this tick. It is still sent as a
  fallback when no environment notified (e.g. every per-env delivery was
  suppressed by policy/maintenance or threw), so a real status change is never
  left entirely unannounced, and a system with no environments is unaffected.

  Only the redundant user-facing notification is dropped: the rollup state
  transition is still recorded and the `SYSTEM_STATUS_CHANGED` signal is still
  broadcast, so SLO downtime, the dependency graph, the frontend, and automations
  (which subscribe to the per-env and rollup entity changes) are unchanged.

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

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/ai-backend@0.10.9
  - @checkstack/backend-api@0.31.0
  - @checkstack/automation-backend@0.11.0
  - @checkstack/incident-common@1.9.0
  - @checkstack/incident-backend@1.11.0
  - @checkstack/maintenance-common@1.9.0
  - @checkstack/script-packages-backend@0.4.0
  - @checkstack/satellite-backend@0.8.3
  - @checkstack/sdk@0.126.1
  - @checkstack/ai-common@0.6.6
  - @checkstack/cache-api@0.3.19
  - @checkstack/catalog-backend@1.6.9
  - @checkstack/command-backend@0.2.21
  - @checkstack/gitops-backend@0.5.21
  - @checkstack/gitops-common@0.7.3
  - @checkstack/notification-common@1.5.3
  - @checkstack/queue-api@0.3.19
  - @checkstack/secrets-backend@0.3.3
  - @checkstack/secrets-common@0.3.2
  - @checkstack/signal-common@0.2.17
  - @checkstack/status-page-backend@0.4.8
  - @checkstack/status-page-common@0.5.3
  - @checkstack/cache-utils@0.2.24

## 1.17.0

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

- fc64fad: Dependencies can now be scoped to a specific environment and/or health check of
  the upstream system, each with its own severity - a "matrix" of scope cells.

  Previously a dependency watched the upstream's overall health (any check, any
  environment) at the edge's impact type, with optional per-check rules. That
  default is unchanged: with no scope cells configured, the dependency behaves
  exactly as before. Now each cell pins a check (a specific configuration, or
  "any"), an environment (a specific environment, or "any"), and a severity
  (informational / degraded / critical). When a dependency has any cells, only
  those slices are watched (they replace the whole-system watch) and the worst
  result across cells wins. This lets you express, e.g., "System A depends on
  System B only in `prod`", or "only when B's TLS check in `prod` fails", and lets
  different cells carry different severities.

  Because each environment is evaluated on its own slice, a scoped dependency
  catches an environment-specific outage that the upstream's overall status
  (worst-wins across environments) would otherwise hide. The dependency evaluator
  now reads per-(check, environment) health via a new
  `@checkstack/healthcheck-common` bulk contract `getBulkSystemHealthMatrix` (and
  its `@checkstack/healthcheck-backend` implementation), which returns each
  system's cross-environment rollup plus a per-environment slice. Incident
  overrides still fold into the overall rollup, so incident-forced statuses keep
  propagating through dependencies.

  The scope-cell store gains a nullable `environment_id` column and makes
  `health_check_id` nullable (forward-only migration; existing rows keep working
  as "any check, any environment"). The dependency editor's per-check panel
  becomes a scope-matrix editor with check + environment + severity rows.

  Transitive (multi-hop) dependencies still cascade using the upstream's overall
  status; per-environment cascades across multiple hops are not yet propagated.

- 9d30324: Incidents can now optionally override the health status of their affected
  systems. When creating or editing an incident you can pick "Override system
  health" (Degraded or Unhealthy); while the incident is active (not resolved)
  that status is folded into every affected system's derived health via
  worst-wins, so it shows on every health surface (status pages, dashboards,
  dependency map, catalog badges). A health check reporting a worse status still
  wins, and the override lifts automatically when the incident resolves. This
  covers components that no automated check can monitor (e.g. a running app whose
  licenses were revoked so it won't open).

  The override is a deliberate operator choice, independent of the incident's
  severity. A new service-typed incident RPC `getActiveHealthOverrides` exposes
  active overrides per system, which `@checkstack/healthcheck-backend` reads and
  folds into `getSystemHealthStatus`. The system-health response gains an optional
  `override` field naming the contributing incident so UIs can explain why a
  system reads unhealthy when its checks look fine. The system health badge uses
  it to show, on hover, when a status was forced by an incident.

  The dashboard "problem system" signal attributes an override-forced status to
  the incident ("Forced by incident: <title>") instead of misreporting
  "0 of N checks failing", while a genuinely worse health check still drives the
  signal and its detail. Public status pages reflect the forced status but never
  carry the incident title (the widget DTOs project only the status), so an
  override cannot leak the name of a hidden incident.

  Behavior change: a system's derived health now reflects active incident
  overrides in addition to its health checks. Adds a forward-only migration for
  the new nullable `incidents.health_override` column.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  that shaped this release.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
  - @checkstack/ai-backend@0.10.8
  - @checkstack/backend-api@0.30.0
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/incident-common@1.8.0
  - @checkstack/incident-backend@1.10.0
  - @checkstack/automation-backend@0.10.10
  - @checkstack/catalog-backend@1.6.8
  - @checkstack/command-backend@0.2.20
  - @checkstack/gitops-backend@0.5.20
  - @checkstack/satellite-backend@0.8.2
  - @checkstack/script-packages-backend@0.3.24
  - @checkstack/secrets-backend@0.3.2
  - @checkstack/status-page-backend@0.4.7
  - @checkstack/sdk@0.125.1

## 1.16.0

### Minor Changes

- c55d7c6: Make collector assertions analyzable: structured per-assertion outcomes on
  every run, pass/fail counts in every aggregate tier, and dedicated analysis
  surfaces. Previously a passing assertion left no trace and only the first
  failure was recorded as a string.

  - `@checkstack/healthcheck-common` adds the assertion-analytics contract:
    `AssertionOutcomeSchema`, per-bucket `BucketAssertionStats` (stored under
    the platform-owned top-level `assertions` key of `aggregatedResult`), and
    the canonical assertion identity key (`computeAssertionKey` /
    `parseAssertionKey`, a JSON tuple of field/jsonPath/operator/value).
    Editing an assertion starts a new series; identical duplicates collapse.
  - The executor evaluates ALL assertions (no first-failure short-circuit) and
    stores `_assertions` on each collector entry alongside the unchanged
    `_assertionFailed` compatibility string. Pass/fail counts are folded into
    the hourly realtime aggregation, the on-read raw tier, cross-tier bucket
    re-merges, and the daily retention rollup (assertion counts are the only
    `aggregatedResult` content that survives the rollup - they are purely
    additive), so assertion analytics do not silently end at the hourly
    retention horizon.
  - Satellite ingest now evaluates assertions on the core
    (`ingestSatelliteResult`), downgrading a satellite-reported healthy run
    whose assertions fail, and strips ephemeral result fields (e.g. raw HTTP
    bodies) at ingest for parity with local runs. BEHAVIOR CHANGE:
    satellite-executed checks previously never enforced assertions at all;
    they now do, with no satellite upgrade or wire-protocol change. Buffered
    satellite results are evaluated against the configuration current at
    ingest time.
  - The run detail gains an Assertions tab (per-collector groups, pass AND
    fail rows with expected vs actual, a legacy fallback for pre-feature
    runs), and the drawer's auto-chart grid leads each collector group with
    per-assertion pass-rate tiles (sparkline of per-bucket pass rate,
    expandable to a pass/fail StackedTimeline; currently-configured assertions
    appear before any data exists, historical-only series are flagged).

  State & scale: all new state lives in the existing `healthCheckRuns.result`
  and `healthCheckAggregates.aggregated_result` jsonb columns (durable, shared
  Postgres - no new tables, no pod-local state); reads resolve identically on
  every pod; the run-vs-bucket duplication is the platform's existing
  raw-vs-aggregate tiering with the existing single-writer upsert paths.

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [a83bcc2]
- Updated dependencies [c55d7c6]
  - @checkstack/ai-backend@0.10.7
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/automation-backend@0.10.9
  - @checkstack/catalog-backend@1.6.7
  - @checkstack/incident-backend@1.9.5
  - @checkstack/satellite-backend@0.8.1
  - @checkstack/backend-api@0.29.1
  - @checkstack/sdk@0.123.1
  - @checkstack/ai-common@0.6.5
  - @checkstack/cache-api@0.3.18
  - @checkstack/catalog-common@2.6.2
  - @checkstack/command-backend@0.2.19
  - @checkstack/gitops-backend@0.5.19
  - @checkstack/gitops-common@0.7.2
  - @checkstack/incident-common@1.7.2
  - @checkstack/maintenance-common@1.8.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/queue-api@0.3.18
  - @checkstack/script-packages-backend@0.3.23
  - @checkstack/secrets-backend@0.3.1
  - @checkstack/secrets-common@0.3.1
  - @checkstack/signal-common@0.2.16
  - @checkstack/status-page-backend@0.4.6
  - @checkstack/status-page-common@0.5.2
  - @checkstack/cache-utils@0.2.23

## 1.15.0

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
- Updated dependencies [faf98f5]
  - @checkstack/ai-backend@0.10.6
  - @checkstack/backend-api@0.29.0
  - @checkstack/secrets-backend@0.3.0
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/satellite-backend@0.8.0
  - @checkstack/automation-backend@0.10.8
  - @checkstack/catalog-backend@1.6.6
  - @checkstack/incident-backend@1.9.4
  - @checkstack/command-backend@0.2.18
  - @checkstack/gitops-backend@0.5.18
  - @checkstack/script-packages-backend@0.3.22
  - @checkstack/status-page-backend@0.4.5
  - @checkstack/gitops-common@0.7.1
  - @checkstack/sdk@0.122.1
  - @checkstack/ai-common@0.6.4
  - @checkstack/cache-api@0.3.17
  - @checkstack/catalog-common@2.6.1
  - @checkstack/incident-common@1.7.1
  - @checkstack/maintenance-common@1.8.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/queue-api@0.3.17
  - @checkstack/signal-common@0.2.15
  - @checkstack/status-page-common@0.5.1
  - @checkstack/cache-utils@0.2.22

## 1.14.0

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

### Patch Changes

- Updated dependencies [e819276]
- Updated dependencies [e819276]
  - @checkstack/ai-backend@0.10.5
  - @checkstack/backend-api@0.28.0
  - @checkstack/automation-backend@0.10.7
  - @checkstack/catalog-backend@1.6.5
  - @checkstack/incident-backend@1.9.3
  - @checkstack/satellite-backend@0.7.8
  - @checkstack/command-backend@0.2.17
  - @checkstack/gitops-backend@0.5.17
  - @checkstack/script-packages-backend@0.3.21
  - @checkstack/secrets-backend@0.2.17
  - @checkstack/status-page-backend@0.4.4

## 1.13.1

### Patch Changes

- Updated dependencies [b4e0832]
  - @checkstack/ai-backend@0.10.4
  - @checkstack/automation-backend@0.10.6
  - @checkstack/catalog-backend@1.6.4
  - @checkstack/incident-backend@1.9.2
  - @checkstack/satellite-backend@0.7.7

## 1.13.0

### Minor Changes

- 0cac684: Align the health-check run-history gates end to end. The history surfaces had a
  three-way drift: the route allowed `configuration.read`, the page required
  manage capability, and the procedures required the standalone
  `healthcheck.details` rule - so global read-rule holders reached a page that
  denied them, and team-scoped managers passed the page gate but got 403s from
  every data call.

  Detailed run history is now a MANAGER surface everywhere, with system owners
  included: access requires global `configuration.manage`, a team manage grant
  on the CONFIGURATION, or manage access to the SYSTEM - a system's owning team
  sees every run of that system, whoever owns the configuration.

  - Routes, pages, drawer links, and the anomaly/health signals gate on the
    manage capability (with `catalog.system` as the parent type); the drawer and
    chart hook check the caller's grant on the specific configuration OR system.
  - All three history procedures (`getDetailedHistory`,
    `getDetailedAggregatedHistory`, `getRunById`) are authorized in the handler
    via a shared fail-closed module (`history-access.ts`) - the triple-OR is not
    expressible with the declarative instanceAccess modes. `getRunById`
    authorizes against the fetched run's own configuration/system, and answers
    `undefined` for unauthorized callers so run ids don't leak existence.
  - The feed (`getDetailedHistory`) scopes team callers to runs of their
    configurations UNION runs of their systems, with correct pagination totals.

  BREAKING CHANGES:

  - The standalone `healthcheck.details` access rule is REMOVED. Roles that held
    `details` without `configuration.manage` lose access to detailed run data;
    grant them the manage rule (or a team grant on the configuration/system)
    instead. Stale role rows referencing the removed rule are inert.
  - `getDetailedAggregatedHistory` is `authenticated` (was `public`); anonymous
    callers could never pass its access rule anyway.

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/ai-backend@0.10.3
  - @checkstack/gitops-common@0.7.0
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/automation-backend@0.10.5
  - @checkstack/catalog-backend@1.6.3
  - @checkstack/incident-backend@1.9.1
  - @checkstack/sdk@0.119.1
  - @checkstack/gitops-backend@0.5.16
  - @checkstack/satellite-backend@0.7.6
  - @checkstack/backend-api@0.27.1
  - @checkstack/script-packages-backend@0.3.20
  - @checkstack/command-backend@0.2.16
  - @checkstack/secrets-backend@0.2.16
  - @checkstack/status-page-backend@0.4.3

## 1.12.0

### Minor Changes

- 52c55bf: Anomaly baselines are now per-environment, so the env-scoped
  `HealthCheckDrawer` shows the clicked env's baseline (not a cross-env
  one). Closes the follow-up noted in `healthcheck-per-env-rollup`.

  ## What changed

  - **`anomaly_baselines`** now carries a nullable `environment_id`
    column, and its unique constraint grew to
    `(systemId, configurationId, environmentId, fieldPath)` with
    `NULLS NOT DISTINCT` — so there is exactly one baseline per
    `(system, config, env, path)` tuple, and the env-less slice (`NULL`)
    stays a single row (the pre-feature cross-env baseline, preserved as
    the env-less row until the next analyzer tick rewrites per-env rows).
    Existing rows backfill to `environment_id = NULL` with no data work.
  - **Baseline analyzer** (`jobs/baseline-analyzer.ts`) now fans out per
    environment within each assignment: runs are grouped by
    `environmentId` (null = env-less), stats are computed per env, and
    the upsert targets the 4-tuple. The cache key gained an env segment
    (`baseline:${config}:${system}:${env ?? "<none>"}:${path}`) and the
    `ANOMALY_BASELINE_UPDATED` signal payload now carries `environmentId`.
    Previously the analyzer computed one cross-env batch per assignment.
  - **Inline detector** (`detector.ts`) resolves the per-env baseline:
    the lookup matches `environmentId` when present or `IS NULL` for the
    env-less slice, and the cache key matches the analyzer's env segment.
    `environmentId` is threaded from the `checkCompleted` hook (see
    below); it defaults to `null` (env-less) so a caller that omits it
    resolves the env-less baseline rather than failing.
  - **`getAnomalyBaselines` RPC** now accepts an optional
    `environmentId: string | null` filter and surfaces `environmentId` on
    every `AnomalyBaselineDto`. Tristate semantics, mirroring
    `getHistory`: `undefined` → all envs (no predicate), `null` → env-less
    slice (`IS NULL`), a string → that env. The service predicate is at
    the DB layer.
  - **`HealthCheckDrawer`** threads `item.environmentId` (already on its
    props) into the baselines query, so the drawer's anomaly overlay
    resolves server-side to the clicked env's baseline only — matching the
    env-scoping already applied to its history table and charts. The
    latency chart tolerates the new field (it picks the single
    `"latencyMs"` baseline, which the env filter guarantees is unique).
  - **`getRunsForAnalysis`** (healthcheck) now returns `environmentId`
    on each run so the analyzer can group by env. Additive optional
    field; only the analyzer consumes it.
  - **`checkCompleted` / `checkFailed` hooks** (healthcheck) now carry
    `environmentId: string | null` on their payloads, sourced from the
    per-env execution loop. Only the anomaly detector subscribes to
    `checkCompleted` (it was updated); the failure-path emit (rollup
    error) passes `null`.

  ## Notes

  - Anomaly _rows_ (`anomalies` table) remain cross-env by design in this
    step — only baselines are env-scoped, matching the scoped task. A
    detector run for env A and env B's normal value still share one
    `(system, config, path)` anomaly row; env-scoping the anomalies table
    is tracked as a separate follow-up so this change stays focused on
    the drawer's baseline overlay.
  - The `checkCompleted` / `checkFailed` payload change is technically
    breaking for hook subscribers that destructure the payload, but the
    only in-tree subscriber (the anomaly plugin) was updated in lockstep.
    External webhook subscribers receive an additional field and are not
    affected unless they reject unknown keys (uncommon).
  - Migration `0006_sad_retro_girl.sql` drops + recreates the unique
    constraint with `NULLS NOT DISTINCT` and adds the column. It applies
    cleanly to fresh and already-populated DBs (existing NULL-env rows
    remain unique under the new key).

- d9f4654: Fix team-scoped health-check management being invisible. Health-check
  configuration team grants are keyed on `healthcheck.healthcheck` (the RPC
  middleware derives the grant key from the configuration access rule's
  `resource`, and that rule is `accessPair("healthcheck", ...)`), but the frontend
  capability gate, the route `manageCapability`, and the Teams grant-name resolver
  all declared `healthcheck.configuration`. Because the two never matched, a user
  who could manage a health check via a team grant (without the global manage
  rule) saw none of the health-check management surfaces, and health-check grant
  names did not resolve in the Teams admin UI.

  `healthCheckResourceTypes.configuration` now resolves to `healthcheck.healthcheck`
  (with a regression test pinning it to the middleware's grant key), the resolver
  registers under the same type, and the create/edit/assignments routes gain the
  `manageCapability` they were missing so team-scoped health-check managers (and,
  for create/assign, system managers) can reach them. This is a non-breaking fix:
  no stored access-rule id or grant key changes.

- 21e0d88: Paused health-check configurations no longer contribute to their systems'
  health aggregate, pausing one now closes any open SLO downtime event it was
  keeping open, and the system overview's "Health Checks" list renders a
  "Paused" pill for paused checks instead of their stale run-evaluated status.

  Previously, pausing a configuration only skipped execution — its stale
  failing runs inside the evaluation window kept the system's rollup status
  `degraded`/`unhealthy`, which in turn kept any open SLO downtime event open
  until those runs aged out, and the system overview list still showed the
  paused check as "Unhealthy". Now:

  - `getSystemHealthStatus` excludes paused configurations from the worst-
    wins aggregate, so a system whose only failing check is paused reads
    healthy (and paused checks no longer drive the system's red badge).
  - The `pauseConfiguration` RPC recomputes the rollup `health` entity for
    every system the config is enabled-assigned to. If the recomputed
    aggregate transitions degraded → healthy, the existing `HEALTH_ENTITY_KIND`
    "recovered" edge fires and the SLO engine closes the open downtime event
    at the pause time. If the system stays degraded (other failing checks),
    the event correctly stays open.
  - `resumeConfiguration` intentionally does NOT recompute. The next actual
    run drives any degraded transition: if the check still fails, a fresh
    downtime event opens (the previous one was closed on pause, so the
    `handleSystemDown` idempotent guard doesn't suppress it); if it now
    passes, no event opens. This avoids fabricating a downtime from stale
    last-known state when the underlying condition may have been fixed
    during the pause.
  - `getSystemHealthOverview` now returns a `paused` boolean per check. The
    system overview's "Health Checks" list renders a "Paused" pill (unknown
    tone) for paused checks instead of the run-evaluated status, while still
    showing the pre-pause sparkline for context. Paused checks only appear
    under the "All" filter tab, not "Failing" or "Healthy".

- 52c55bf: Per-environment health semantics: rollup no longer masks sibling outages,
  and notifications + automation windows are env-scoped.

  ## The bug

  When a `(system, configuration)` assignment fanned out to multiple
  environments and only some of them failed, the system rollup could
  read **healthy** (masking a permanently-failing env), or **flap**
  healthy↔degraded/unhealthy tick-by-tick whenever env insertion order
  drifted, because the rollup derivation flattened every env's runs into
  one `timestamp DESC` list and handed the interleaved list to the
  threshold evaluator. The default `consecutive` mode walks newest-first
  and breaks the streak on the first interleaving env, so the rollup
  collapsed to whichever single env's status the most recent run landed
  on. Each flap fired an escalation/recovery notification + a
  `system_health_changed` trigger event.

  ## What changed

  - **`getSystemHealthStatus(systemId)` rollup** now groups the latest
    run window by `environmentId`, evaluates the threshold window PER
    ENVIRONMENT, and takes worst-wins across envs within each association
    (unhealthy > degraded > healthy) before worst-wins across associations.
    This is stable regardless of env insertion order or multi-pod racing.
    For a single-env (or env-less-only) assignment this reduces to the
    pre-existing flat-window behavior. Per-env and env-less slices
    (`environmentId: string` / `null`) are unchanged.
  - **`getSystemHealthOverview`** now groups runs per `(configurationId,
environmentId)`, evaluates each env's slice on its own monotonic run
    window, and worst-wins across envs — mirroring `getSystemHealthStatus`.
    The response carries `environmentId` on every `recentRuns[]` entry,
    and adds `perEnvironment[]` per check (one entry per env with its own
    `status` and env-scoped `recentRuns`) so a frontend can render one
    row per `(check, environment)` pair, surfacing per-env outages the
    rollup intentionally hides in the aggregate view. The top-level
    `recentRuns[]` and `status` keep their pre-existing shape for
    backwards compatibility (single-env checks are unchanged).
  - **`HealthCheckSystemOverview`** (frontend) now flattens multi-env
    assignments into one row per `(check, environment)` — each row carries
    the check name, an env pill (resolved via the same
    `getSystemEnvironments` query the drawer already uses), the per-env
    status, sparkline, and last-run. With the "Failing"/"Healthy" filter
    now scoped per env, a permanently-failing environment surfaces as its
    own failing row beside its healthy sibling, instead of being masked by
    the rollup's worst-wins / latest-wins. Single-env and env-less
    assignments render the historical single row (no env pill). Clicking
    any env row opens the check-level drawer, scoped to that env via the
    server-side env filter on the queries below — the drawer's run
    history table, charts, and tiles all see only the (check, environment)
    pair the operator clicked, never a mixed-env pool.
  - **`getHistory`, `getDetailedHistory`, `getRunStats`,
    `getAggregatedHistory`, and `getDetailedAggregatedHistory`** now accept
    an optional `environmentId: string | null` input that filters
    server-side at the DB layer (`environment_id = $X` for an env, `IS
NULL` for the env-less slice, no predicate when omitted). The drawer's
    charts and Recent Runs table pass the clicked row's `environmentId`
    so the pagination, totals, and buckets reflect only that env — a
    client-side filter would double-paginate and miscount totals; the
    filter is at the DB so the data is honest end-to-end. The aggregated
    history applies the env filter to all three tiers the cross-tier
    aggregation engine reads (raw `health_check_runs` + hourly and daily
    `health_check_aggregates`), since both tables are env-keyed. Single-env
    and env-less rows omit the filter, so historical callers are
    unchanged.
  - **Anomaly baselines are NOT yet env-scoped** — `anomaly_baselines` is
    keyed on `(systemId, configurationId, fieldPath)` with no
    `environmentId` column, and the detector computes a single baseline
    across all envs of an assignment. Scoping the drawer's anomaly overlay
    per env needs a schema migration + a per-env detector rewrite, and is
    tracked as a follow-up. The drawer continues to show the cross-env
    baseline next to the (now env-scoped) history + charts.
  - **`system_health_changed` / `system_degraded` / `system_healthy`
    triggers** now partition by `(systemId, environmentId)` instead of
    the bare `systemId` when the trigger fires from a per-env change.
    Two failing environments of one system now fire two distinct events
    with independent flapping/dwell/dedup windows — operators can author
    per-env automations and get per-env notifications. A bare rollup
    transition (`environmentId` absent) partitions on `systemId` alone,
    so existing recipes that read only `payload.systemId` keep working.
  - **`notifyStateChange`** now accepts `environmentId` +
    `environmentName`. Per-env notifications get an env-qualified title
    (`"System health critical (prod): ..."`) and body, and an
    env-qualified collapse key (`systemHealthCollapseKey(systemId, envId)`)
    so two failing envs render as two independent cards instead of
    merging into one. Suppression checks (maintenance/incident) remain
    system-scoped.

  ## Notes

  - Each failing env now fires its own `system_health_changed` event with
    its own partition — this is the documented migration away from the
    bug-report flapping cadence into a per-env flap cadence. Operators
    with existing `window:` / `dwell:` recipes on `system_health_changed`
    may see different refire cadence per env (one flapping env no longer
    drowns out its steady sibling). To opt back into the pooled
    historical behavior, an automation recipe can override its own
    `partitionBy: (p) => p.systemId`.
  - `SYSTEM_STATUS_CHANGED` remains rollup-only (one broadcast per tick
    on the rollup status transition): it drives low-noise cache
    invalidation for `SystemHealthBadge` and `DependencyBadge`, and the
    per-env trigger events above already cover per-env automation needs.

- d2d49cf: Show the environment for fanned-out runs in the dashboard Recent Activity feed.
  The `healthcheck.run.completed` signal now carries optional `environmentId` and
  `environmentName` fields, populated at the two per-environment fan-out broadcast
  sites in the run executor. The Dashboard "Recent activity" terminal feed renders
  the environment name inline (`system (config) @ env -> status`) when a run was
  fanned out to an environment. Runs that are not environment-scoped omit both
  fields and render exactly as before, so their behavior is unchanged.

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d1b71b6]
- Updated dependencies [7c18b25]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [53666a7]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/ai-backend@0.10.2
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/incident-common@1.7.0
  - @checkstack/incident-backend@1.9.0
  - @checkstack/maintenance-common@1.8.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/status-page-common@0.5.0
  - @checkstack/catalog-backend@1.6.2
  - @checkstack/sdk@0.118.1
  - @checkstack/satellite-backend@0.7.5
  - @checkstack/automation-backend@0.10.4
  - @checkstack/script-packages-backend@0.3.19
  - @checkstack/ai-common@0.6.3
  - @checkstack/cache-api@0.3.16
  - @checkstack/cache-utils@0.2.21
  - @checkstack/command-backend@0.2.15
  - @checkstack/gitops-backend@0.5.15
  - @checkstack/gitops-common@0.6.8
  - @checkstack/queue-api@0.3.16
  - @checkstack/secrets-backend@0.2.15
  - @checkstack/secrets-common@0.2.8
  - @checkstack/signal-common@0.2.14
  - @checkstack/status-page-backend@0.4.2

## 1.11.1

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ai-backend@0.10.1
  - @checkstack/automation-backend@0.10.3
  - @checkstack/catalog-backend@1.6.1
  - @checkstack/incident-backend@1.8.7
  - @checkstack/satellite-backend@0.7.4

## 1.11.0

### Minor Changes

- defb97b: fix(healthcheck): emit a realtime signal on config/assignment changes

  The health-check executor broadcasts run/status signals, but config and
  assignment CRUD (create/update/delete/pause/resume, associate/disassociate,
  create-and-assign) emitted nothing - so a check created or edited out-of-band
  (the AI assistant, GitOps, another pod/user) did not appear in an open Health
  Checks list until the first run fired a status signal, up to an interval later.

  Add a `HEALTHCHECK_CONFIG_CHANGED` (`healthcheck.config.changed`) signal,
  broadcast from every config/assignment mutation, so the frontend signal
  auto-invalidator refreshes the `[[healthcheck]]` cache on every connected client
  immediately.

- defb97b: feat(healthcheck): atomically create and assign a health check in one step

  Add a `createAndAssign` RPC that creates a health-check configuration and
  assigns it to a system in a single transaction, so the common "one system, one
  check" case can never leave a dormant, unassigned check that runs nothing. When
  the assignment is enabled it is scheduled immediately, exactly like
  `associateSystem`.

  The AI `healthcheck.propose` tool now prefers the HTTP strategy for a URL
  (instead of authoring a script health check) and, when given `assignToSystemId`,
  creates, assigns, and starts the check in the same approval.

  Also fixes a latent bug where the `associateSystem` handler silently dropped the
  per-assignment `notificationPolicy` before it reached the database.

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/ai-backend@0.10.0
  - @checkstack/catalog-backend@1.6.0
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/automation-backend@0.10.2
  - @checkstack/incident-backend@1.8.6
  - @checkstack/incident-common@1.6.4
  - @checkstack/maintenance-common@1.7.4
  - @checkstack/sdk@0.116.1
  - @checkstack/ai-common@0.6.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/cache-api@0.3.15
  - @checkstack/command-backend@0.2.14
  - @checkstack/gitops-backend@0.5.14
  - @checkstack/gitops-common@0.6.7
  - @checkstack/notification-common@1.4.2
  - @checkstack/queue-api@0.3.15
  - @checkstack/satellite-backend@0.7.3
  - @checkstack/script-packages-backend@0.3.18
  - @checkstack/secrets-backend@0.2.14
  - @checkstack/secrets-common@0.2.7
  - @checkstack/signal-common@0.2.13
  - @checkstack/status-page-backend@0.4.1
  - @checkstack/status-page-common@0.4.1
  - @checkstack/cache-utils@0.2.20

## 1.10.2

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/ai-backend@0.9.1
  - @checkstack/backend-api@0.26.0
  - @checkstack/status-page-common@0.4.0
  - @checkstack/status-page-backend@0.4.0
  - @checkstack/ai-common@0.6.1
  - @checkstack/catalog-common@2.4.3
  - @checkstack/gitops-common@0.6.6
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/incident-common@1.6.3
  - @checkstack/maintenance-common@1.7.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/secrets-common@0.2.6
  - @checkstack/signal-common@0.2.12
  - @checkstack/automation-backend@0.10.1
  - @checkstack/cache-api@0.3.14
  - @checkstack/cache-utils@0.2.19
  - @checkstack/catalog-backend@1.5.5
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/gitops-backend@0.5.13
  - @checkstack/incident-backend@1.8.5
  - @checkstack/queue-api@0.3.14
  - @checkstack/satellite-backend@0.7.2
  - @checkstack/script-packages-backend@0.3.17
  - @checkstack/sdk@0.115.1
  - @checkstack/secrets-backend@0.2.13

## 1.10.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-backend@0.10.0
  - @checkstack/ai-backend@0.9.0
  - @checkstack/incident-backend@1.8.4
  - @checkstack/satellite-backend@0.7.1
  - @checkstack/sdk@0.113.1
  - @checkstack/catalog-backend@1.5.4
  - @checkstack/script-packages-backend@0.3.16

## 1.10.0

### Minor Changes

- 8cad340: Add an AI assistant tool that lists the health checks assigned to a system.

  The assistant previously had `healthcheck.status` (every check globally) but no
  way to map a check to a system, so it had to guess which check monitored a given
  system. It now projects `getSystemConfigurations` as the read-only tool
  `healthcheck.listSystemChecks`: given a `systemId` (resolved from a name via
  `catalog.listSystems`), it returns the checks assigned to that system - id, name,
  strategy, interval, collectors/assertions, and paused state. The tool inherits
  the source procedure's system-scoped `configuration.read` gate, so it stays
  team-scoped and needs no new permission.

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

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ai-backend@0.8.0
  - @checkstack/ai-common@0.6.0
  - @checkstack/automation-backend@0.9.3
  - @checkstack/status-page-backend@0.3.0
  - @checkstack/satellite-backend@0.7.0
  - @checkstack/gitops-backend@0.5.12
  - @checkstack/secrets-backend@0.2.12
  - @checkstack/script-packages-backend@0.3.15
  - @checkstack/backend-api@0.25.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/incident-backend@1.8.3
  - @checkstack/command-backend@0.2.12
  - @checkstack/catalog-backend@1.5.3
  - @checkstack/status-page-common@0.3.0
  - @checkstack/catalog-common@2.4.2
  - @checkstack/incident-common@1.6.2
  - @checkstack/maintenance-common@1.7.2
  - @checkstack/sdk@0.112.1
  - @checkstack/cache-api@0.3.14
  - @checkstack/gitops-common@0.6.5
  - @checkstack/queue-api@0.3.14
  - @checkstack/secrets-common@0.2.5
  - @checkstack/signal-common@0.2.11
  - @checkstack/cache-utils@0.2.19

## 1.9.2

### Patch Changes

- 2ec8f64: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `hono` 4.12.23 → 4.12.25 (CVE-2026-54286, CVE-2026-54287, CVE-2026-54288, CVE-2026-54289, CVE-2026-54290)
  - `nodemailer` 9.0.0 → 9.0.1 (GHSA-p6gq-j5cr-w38f)
  - `dompurify` 3.4.3 → 3.4.11 (CVE-2026-49458, CVE-2026-49459, CVE-2026-49978, GHSA-76mc-f452-cxcm, GHSA-cmwh-pvxp-8882)
  - `protobufjs` 7.5.8 → 7.6.3 (CVE-2026-48712, CVE-2026-54269)
  - `undici` 7.24.7 → 7.28.0 (CVE-2026-9678, CVE-2026-9697)

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/catalog-backend@1.5.2
  - @checkstack/automation-backend@0.9.2
  - @checkstack/secrets-backend@0.2.11
  - @checkstack/ai-backend@0.7.2
  - @checkstack/command-backend@0.2.11
  - @checkstack/gitops-backend@0.5.11
  - @checkstack/incident-backend@1.8.2
  - @checkstack/satellite-backend@0.6.15
  - @checkstack/script-packages-backend@0.3.14
  - @checkstack/status-page-backend@0.2.1

## 1.9.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/status-page-common@0.2.0
  - @checkstack/status-page-backend@0.2.0
  - @checkstack/ai-backend@0.7.1
  - @checkstack/automation-backend@0.9.1
  - @checkstack/catalog-backend@1.5.1
  - @checkstack/command-backend@0.2.10
  - @checkstack/gitops-backend@0.5.10
  - @checkstack/incident-backend@1.8.1
  - @checkstack/satellite-backend@0.6.14
  - @checkstack/script-packages-backend@0.3.13
  - @checkstack/secrets-backend@0.2.10
  - @checkstack/catalog-common@2.4.1
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/incident-common@1.6.1
  - @checkstack/maintenance-common@1.7.1
  - @checkstack/sdk@0.109.1

## 1.9.0

### Minor Changes

- 551eaa9: AI assistant context-window management + leaner health-check history for chat.

  The assistant previously sent the full conversation history verbatim every turn
  with no size bounds, so analyzing historical health-check runs blew the model's
  context window fast. Two problems are addressed:

  **Verbosity.** Read-tool results are now shaped for the model:

  - A generic, last-resort size clamp on every read result (head-trims the largest
    arrays and adds a `_truncated` hint to narrow/paginate) so one wide pull can't
    blow the context — and, since history replays each turn, keep blowing it.
  - Projections can declare an optional `projectResult` to return a LEANER
    model-facing shape than the UI procedure (authz + audit still see the full
    result). `healthcheck.runHistory` uses it to drop the opaque ids the model
    merely echoes, keeping time/status/latency/source.
  - New `healthcheck.runStats` AI tool (backed by a new public `getRunStats`
    procedure): compact window totals (counts by status, uptime %, latency
    avg/min/max/p95) plus a small capped time series, so "how often / how much
    downtime / uptime over the last N days" questions return aggregates instead of
    thousands of rows. `runHistory`'s description now steers wide-window questions
    here.

  **Context limits.** The chat loop now estimates the prompt's tokens (a
  provider-agnostic heuristic) against a budget derived from the connection's
  context window, and COMPACTS the conversation before it overflows: the oldest
  turns are summarized into a durable running summary (persisted on the
  conversation row in shared Postgres, so any pod resumes consistently) and dropped
  from the verbatim replay, with the summary folded into the system prompt.
  Splitting at message-row boundaries keeps tool-call/result pairs intact, and the
  summarization step is fail-open. A new optional `contextWindowTokens` on the
  OpenAI-compatible connection sets the window (blank = conservative default).

  All additive: a new optional connection field, a new public read endpoint, and an
  additive `ai-backend` migration (`0009`) adding nullable `summary` /
  `summarized_through_message_id` columns to `ai_conversations`.

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

- 5c6393f: Add operator-built public Status Pages (phase 1: secure, extensible core).

  Operators compose a public status page from widgets (status banner, system
  health, group status, 90-day uptime, incidents, scheduled maintenance) plus
  content blocks (text/Markdown, heading, links, image, divider), each bound to the
  resources they choose, then publish it.

  Security model — "only published widgets reveal data":

  - A single public endpoint, `getPublishedStatusPage(slug)`, returns the layout
    plus each widget's already-resolved, field-ALLOW-LISTED DTO. The public surface
    has no generic data API, so it can only ever show what was placed on the page.
  - Three gates: edit-time (you can only bind resources you can access), publish-time
    (an audited, deliberate exposure that re-checks the editor can read every bound
    resource via a user-scoped client), and render-time (resolvers run as a trusted
    service but emit only DTO fields — never internal config, ids, or `createdBy`;
    the service re-validates each DTO against its schema, so a resolver bug fails
    closed).
  - The overall banner rolls up only the bound systems; private resources are never
    exposed beyond their public-safe status; per-binding label overrides avoid
    internal-name leaks.

  Coherence + extensibility:

  - Status pages are team-scopable resources (RLAC): created via the standard
    owning-team picker + create-capability flow, resolvable by name in the Teams
    admin.
  - Widget types come from an extension-point registry, so any plugin can contribute
    a widget (config schema + public DTO + `resolvePublic`); the public renderers
    are pure, prop-only components with no data access, so third-party widgets can
    never leak.
  - Draft vs published layouts; per-page visibility (public / authenticated-only)
    and theming (brand color, logo).

  Dependency direction: the status-page platform owns the widget-type registry and
  the content widgets, but the DOMAIN widgets are contributed by their owning
  plugins via the `statusWidgetTypeExtensionPoint` — system health / uptime /
  banner / group status by `healthcheck-backend`, incidents by `incident-backend`,
  scheduled maintenance by `maintenance-backend`. So `status-page-backend` depends
  only on `backend-api` / `common` / `status-page-common`; the owning plugins
  depend on the platform, never the reverse. `catalog-common` gains
  `assertCatalogResourcesReadable` for the publish-time access check.

  Phase 1 scope: the secure core, the admin builder, and the public page (served as
  a no-access-rule route). A fully separate public bundle, custom domains + TLS,
  drag-reorder, live-data preview, and distribution (embeds/badges/RSS/subscriptions)
  are the next phases.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/ai-backend@0.7.0
  - @checkstack/ai-common@0.5.0
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/catalog-backend@1.5.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/incident-backend@1.8.0
  - @checkstack/incident-common@1.6.0
  - @checkstack/maintenance-common@1.7.0
  - @checkstack/status-page-common@0.1.0
  - @checkstack/status-page-backend@0.1.0
  - @checkstack/satellite-backend@0.6.13
  - @checkstack/sdk@0.108.1
  - @checkstack/script-packages-backend@0.3.12
  - @checkstack/secrets-backend@0.2.9
  - @checkstack/command-backend@0.2.9
  - @checkstack/gitops-backend@0.5.9
  - @checkstack/cache-api@0.3.13
  - @checkstack/gitops-common@0.6.4
  - @checkstack/notification-common@1.3.4
  - @checkstack/queue-api@0.3.13
  - @checkstack/secrets-common@0.2.4
  - @checkstack/signal-common@0.2.10
  - @checkstack/cache-utils@0.2.18

## 1.8.1

### Patch Changes

- Updated dependencies [bb6f0fe]
- Updated dependencies [bb6f0fe]
  - @checkstack/maintenance-common@1.6.0
  - @checkstack/ai-backend@0.6.1
  - @checkstack/sdk@0.107.1
  - @checkstack/automation-backend@0.8.1
  - @checkstack/secrets-backend@0.2.8
  - @checkstack/catalog-backend@1.4.12
  - @checkstack/incident-backend@1.7.4
  - @checkstack/satellite-backend@0.6.12
  - @checkstack/script-packages-backend@0.3.11

## 1.8.0

### Minor Changes

- 4134ed9: Add a `healthcheck.runHistory` AI tool so the assistant can answer timeline and
  root-cause questions ("what issues did system X have between T1 and T2", "show
  the unhealthy runs in the last hour"). It projects the existing filtered
  `getHistory` query, exposing the `systemId`, `startDate`/`endDate`, and
  `statusFilter` filters, and is gated by the same public, default-on
  `healthcheck.status` view rule the dashboard history view uses (no extra grant
  needed). It complements `healthcheck.status`, which only reports current state.

### Patch Changes

- 079369a: Fix producing automation actions that double-prefixed their artifact type. The
  action registry qualifies `produces` with the owning plugin id, but several
  actions set `produces` to an already-qualified id, so it became
  `plugin.plugin.type` (e.g. `automation.automation.analysis`,
  `maintenance.maintenance.window`). This stored artifacts under a type that
  matched no registered artifact type, and — because the run scope exposes a
  produced artifact under its type's local name — broke the documented downstream
  reference `artifacts.<actionId>.<name>.<field>` (a `choose`/condition/template
  referencing the analysis output, a created incident/maintenance/etc. silently
  saw `undefined` and took the wrong branch).

  Fixed in `ai_analyze` (`analysis`), the built-in `notify_user`
  (`notify_user_result`), and the catalog (`system_record`), maintenance
  (`window`), notification (`send_result`), dependency (`edge`), and healthcheck
  (`assignment`) actions — each now uses the unqualified local id matching its
  artifact-type definition.

  BREAKING (beta): any automation that referenced one of these artifacts via the
  old double-prefixed scope key (e.g. `artifacts.x['automation.analysis']`) must
  switch to the documented form (`artifacts.x.analysis.<field>`). The
  double-prefixed key was never the intended/documented path.

- Updated dependencies [079369a]
- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/ai-backend@0.6.0
  - @checkstack/ai-common@0.4.0
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/catalog-backend@1.4.11
  - @checkstack/incident-backend@1.7.3
  - @checkstack/satellite-backend@0.6.11
  - @checkstack/command-backend@0.2.8
  - @checkstack/gitops-backend@0.5.8
  - @checkstack/script-packages-backend@0.3.10
  - @checkstack/secrets-backend@0.2.8
  - @checkstack/sdk@0.106.1
  - @checkstack/catalog-common@2.3.6
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/incident-common@1.5.2
  - @checkstack/maintenance-common@1.5.2

## 1.7.2

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/automation-backend@0.7.0
  - @checkstack/ai-backend@0.5.0
  - @checkstack/ai-common@0.3.0
  - @checkstack/incident-backend@1.7.2
  - @checkstack/sdk@0.105.1
  - @checkstack/catalog-backend@1.4.10
  - @checkstack/satellite-backend@0.6.10
  - @checkstack/catalog-common@2.3.5
  - @checkstack/script-packages-backend@0.3.9
  - @checkstack/secrets-backend@0.2.7
  - @checkstack/healthcheck-common@1.6.1
  - @checkstack/incident-common@1.5.1
  - @checkstack/maintenance-common@1.5.1
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7
  - @checkstack/gitops-backend@0.5.7

## 1.7.1

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [0ffe357]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-backend@0.4.0
  - @checkstack/automation-backend@0.6.0
  - @checkstack/ai-common@0.2.0
  - @checkstack/catalog-backend@1.4.9
  - @checkstack/incident-backend@1.7.1
  - @checkstack/satellite-backend@0.6.9
  - @checkstack/sdk@0.104.1
  - @checkstack/script-packages-backend@0.3.8

## 1.7.0

### Minor Changes

- 0b6f01b: feat(healthcheck): contribute health problems to the backend system.issues aggregator

  The healthcheck plugin now registers a `system.issues` contributor (sourceId
  `healthcheck`) from its backend `init`, so the AI assistant surfaces degraded
  and unhealthy systems alongside incidents, SLOs, anomalies, and dependency
  problems.

  The contributor enforces its own `healthcheck.status` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users get
  no signals), then reads the current problem rows for every system from the
  shared, durable `health_check_runs` / `system_health_checks` tables via a new
  global `getAllUnhealthySystemStatuses` service method (every system with an
  enabled check association, evaluated with the same per-system evaluator the
  dashboard uses, healthy systems omitted). The answer is therefore identical on
  every pod, and only systems with a current problem appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveHealthcheckSignals` deriver in
  `@checkstack/healthcheck-common`, shared by both the backend contributor and the
  frontend `HealthSignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

### Patch Changes

- dbb76a2: fix(ai): guide the assistant to find all issues and fix the anomaly tool

  Two assistant problems reported in production:

  1. Asked "are there any issues?", the model answered from a single source (an
     SLO breach) and missed a system with a failing health check. The chat
     system prompt now instructs the model to check ALL issue sources before
     answering - failing health checks (`healthcheck_status`), breaching/at-risk
     SLOs (`slo_listObjectives`), active anomalies (`anomaly_list`), and open
     incidents (`incident_list`) - and not to stop after the first source. It
     also tells the model that `systemId` must be a real system UUID (resolve a
     name via the catalog tool first) and to never invent ids or filter values.

  2. The anomaly tool was named `anomaly.explain` but actually LISTS anomalies
     with optional filters. The misleading name led the model to pass a
     non-existent filter value ("Type validation failed") and a system
     name/anomaly id as `systemId` ("a value was malformed"). Renamed to
     `anomaly.list` with a description that spells out the optional filters and
     their valid enum values (state: suspicious|anomaly|recovered, kind:
     spike|drift, suppression: active|suppressed|all) and that `systemId` is a
     system UUID.

  Also sharpened the `healthcheck.status` and `slo.listObjectives` tool
  descriptions to be use-case oriented ("use when asked what is failing /
  breaching").

  BREAKING: the anomaly read tool's name changes from `anomaly_explain` to
  `anomaly_list` over the MCP `tools/list` surface. MCP clients referencing it by
  the old name must update.

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/ai-backend@0.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/incident-backend@1.7.0
  - @checkstack/incident-common@1.5.0
  - @checkstack/maintenance-common@1.5.0
  - @checkstack/automation-backend@0.5.8
  - @checkstack/catalog-backend@1.4.8
  - @checkstack/satellite-backend@0.6.8
  - @checkstack/sdk@0.103.1
  - @checkstack/backend-api@0.21.6
  - @checkstack/script-packages-backend@0.3.7
  - @checkstack/command-backend@0.2.6
  - @checkstack/gitops-backend@0.5.6
  - @checkstack/secrets-backend@0.2.6

## 1.6.7

### Patch Changes

- Updated dependencies [2428bfc]
  - @checkstack/ai-backend@0.2.0
  - @checkstack/automation-backend@0.5.7
  - @checkstack/catalog-backend@1.4.7
  - @checkstack/incident-backend@1.6.7
  - @checkstack/satellite-backend@0.6.7

## 1.6.6

### Patch Changes

- Updated dependencies [f9cfdae]
  - @checkstack/ai-backend@0.1.6
  - @checkstack/sdk@0.101.1
  - @checkstack/automation-backend@0.5.6
  - @checkstack/catalog-backend@1.4.6
  - @checkstack/incident-backend@1.6.6
  - @checkstack/script-packages-backend@0.3.6
  - @checkstack/satellite-backend@0.6.6

## 1.6.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ai-backend@0.1.5
  - @checkstack/common@0.15.0
  - @checkstack/ai-common@0.1.3
  - @checkstack/gitops-common@0.6.3
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/incident-common@1.4.4
  - @checkstack/maintenance-common@1.4.4
  - @checkstack/notification-common@1.3.3
  - @checkstack/secrets-common@0.2.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/secrets-backend@0.2.5
  - @checkstack/catalog-backend@1.4.5
  - @checkstack/command-backend@0.2.5
  - @checkstack/gitops-backend@0.5.5
  - @checkstack/incident-backend@1.6.5
  - @checkstack/satellite-backend@0.6.5
  - @checkstack/script-packages-backend@0.3.5
  - @checkstack/sdk@0.100.1
  - @checkstack/cache-api@0.3.12
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9
  - @checkstack/cache-utils@0.2.17

## 1.6.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/ai-backend@0.1.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/catalog-backend@1.4.4
  - @checkstack/command-backend@0.2.4
  - @checkstack/gitops-backend@0.5.4
  - @checkstack/incident-backend@1.6.4
  - @checkstack/satellite-backend@0.6.4
  - @checkstack/script-packages-backend@0.3.4
  - @checkstack/secrets-backend@0.2.4

## 1.6.3

### Patch Changes

- Updated dependencies [00b9367]
  - @checkstack/ai-backend@0.1.3
  - @checkstack/automation-backend@0.5.3
  - @checkstack/catalog-backend@1.4.3
  - @checkstack/incident-backend@1.6.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/incident-common@1.4.3
  - @checkstack/maintenance-common@1.4.3
  - @checkstack/ai-common@0.1.2
  - @checkstack/backend-api@0.21.3
  - @checkstack/cache-api@0.3.11
  - @checkstack/cache-utils@0.2.16
  - @checkstack/command-backend@0.2.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-backend@0.5.3
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.3
  - @checkstack/notification-common@1.3.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/satellite-backend@0.6.3
  - @checkstack/script-packages-backend@0.3.3
  - @checkstack/sdk@0.98.1
  - @checkstack/secrets-backend@0.2.3
  - @checkstack/secrets-common@0.2.2
  - @checkstack/signal-common@0.2.8

## 1.6.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-backend@0.1.2
  - @checkstack/ai-common@0.1.2
  - @checkstack/automation-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/catalog-backend@1.4.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/command-backend@0.2.2
  - @checkstack/gitops-backend@0.5.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/incident-backend@1.6.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/maintenance-common@1.4.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/satellite-backend@0.6.2
  - @checkstack/script-packages-backend@0.3.2
  - @checkstack/sdk@0.96.1
  - @checkstack/secrets-backend@0.2.2
  - @checkstack/secrets-common@0.2.2
  - @checkstack/signal-common@0.2.8
  - @checkstack/cache-utils@0.2.16

## 1.6.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/queue-api@0.3.10
  - @checkstack/ai-backend@0.1.1
  - @checkstack/ai-common@0.1.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/catalog-backend@1.4.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/command-backend@0.2.1
  - @checkstack/gitops-backend@0.5.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/incident-backend@1.6.1
  - @checkstack/incident-common@1.4.1
  - @checkstack/maintenance-common@1.4.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/satellite-backend@0.6.1
  - @checkstack/script-packages-backend@0.3.1
  - @checkstack/sdk@0.95.1
  - @checkstack/secrets-backend@0.2.1
  - @checkstack/secrets-common@0.2.1
  - @checkstack/signal-common@0.2.7
  - @checkstack/cache-utils@0.2.15

## 1.6.0

### Minor Changes

- 9dcc848: Plugin-owned AI tools: every domain plugin contributes its own AI tools (chat assistant + automation AI action), and `ai-backend` is platform-only.

  Every plugin-specific AI tool is owned by the plugin whose domain it acts on, registered via that plugin's own `aiToolExtensionPoint` / `aiToolProjectionExtensionPoint` from its init - the same path an external plugin author uses. `ai-backend` no longer imports or depends on any capability plugin's `*-common`; the dependency direction is strictly plugin -> ai-platform. Pure helpers (`computeFieldDiff`, capability-summary, `ScriptContextKind`) live in `@checkstack/ai-common`.

  Tools shipped:

  - Health checks and automations: full CRUD - `healthcheck.propose` / `automation.propose` and `*.update` (`mutate`, deep-validated) and `*.delete` (`destructive`, always confirm-gated). `healthcheck.propose`'s dry-run calls the new deep `validateConfiguration` so propose-time validation matches apply-time. Assertions are validated against the collector's result schema and the canonical operator vocabulary. Capability-catalog tools (`ai.listCapabilities`, `ai.getCapabilitySchema`), script context tools (`ai.getScriptContext`, `ai.testScript`), and notify-subscriber tools (`healthcheck.notifySystemSubscribers` / `...GroupSubscribers`).
  - Catalog: `catalog.createSystem` / `updateSystem` / `createGroup` / `updateGroup` (`mutate`), `catalog.deleteSystem` / `deleteGroup` (`destructive`), membership tools (`mutate`), plus `catalog.listSystems` / `listGroups` read projections.
  - Incident: `incident.create` / `update` / `addUpdate` / `resolve` / `addLink` (`mutate`), `incident.delete` / `removeLink` (`destructive`), and `incident.get` / `incident.list` read projections.
  - Maintenance: `maintenance.create` / `update` / `addUpdate` / `close` / `addLink` (`mutate`), `maintenance.delete` / `removeLink` (`destructive`), and `maintenance.list` / `get` read projections.
  - Read projections for SLO (`slo.listObjectives`), dependency (`dependency.list`), incident (`incident.list`), healthcheck (`healthcheck.status`), and anomaly (`anomaly.explain`), each gated by the source procedure's own access rule and routed as the principal.
  - Documentation grounding: `ai.searchDocs` / `ai.getDoc` over a build-time bundled docs index (BM25-ish ranking), so the assistant grounds how-to answers in Checkstack's own docs offline.
  - URL introspection: `ai.probeUrl`, an SSRF-guarded read tool the assistant uses to inspect a real endpoint before drafting a health check. Update tools compute a before -> after field diff rendered on the confirm card (approve mode) or an "Applied" card (auto mode), so a change is never silent.

  `ai_analyze` automation action (automation-backend, with an editor connection picker + audited tool calls): runs a bounded AI agent on the run context as the automation's `runAs` service account, so it can never exceed that identity's permissions; destructive tools are never offered; mutating tools auto-apply through the service account's client. Produces an `automation.analysis` artifact downstream actions can branch on. The agent loop is exposed as a headless `aiAgentRunnerRef` service so automation-backend can drive it without depending on ai-backend.

  `notification.notifyForSubscription` is now callable by user / application principals holding `notification.send` (previously service-only). Every tool routes through the user-scoped client, so handler-side authorization is enforced exactly as a direct UI/RPC action; the resolver gate plus the propose/apply re-check at propose AND apply are the additional authority. A systemic authz regression test asserts every registered tool falls into exactly one safe authorization category.

  A new `ai_transport` enum value `automation` records the AI action's tool calls in the `ai_tool_calls` audit log. No new durable state beyond that; each tool is a thin, deterministic wrapper over an existing RPC, so every pod behaves identically.

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

- 9dcc848: Health-check strategy and collector configs now migrate-then-validate when loaded, instead of being cast/rendered raw.

  These configs declared `version: 2`/`3` migrations but the load path never ran them: stored values are persisted UNVERSIONED, and the executor cast them straight to the strategy/collector type. Both the execution path (`queue-executor`) and the read API (`mapConfig`, feeding router / frontend / gitops `getConfiguration`) now use assume-v1-on-read (`Versioned.parseAssumingV1`): wrap as version 1, run the declared chain, then validate. Order is preserved: migrate -> secret resolve -> template render -> execute. An unregistered strategy/collector or a failed migrate falls back to the raw stored blob rather than dropping the configuration. Every reshaper migration is now IDEMPOTENT, guarding on its legacy discriminator so already-current data passes through untouched.

  BREAKING CHANGE: for any config GENUINELY at version 1 in the database (e.g. an HTTP strategy still carrying `url`/`method`, or an execute collector still carrying `command`/`args`), the declared migrations now actually RUN on load, so the loaded/returned shape changes for such rows. This is the intended fix - those fields were already supposed to have been migrated away. Configs already at the current shape are unaffected. No data backfill is performed; migration is applied on every read.

  This is a beta minor.

- 9dcc848: Add a deep `validateConfiguration` RPC to the health-check plugin so propose-time validation matches apply-time validation.

  - `validateConfiguration` (`@checkstack/healthcheck-common`): a new mutation procedure gated by `healthcheck.healthcheck.manage`, taking a proposed configuration (reusing the create skeleton) and returning `{ valid, errors: [{ path, message }] }`, mirroring automation's `validateDefinition`. It persists nothing.
  - Shared deep validation (`@checkstack/healthcheck-backend`): `collectConfigurationIssues` resolves strategy + collectors by fully-qualified id then migrate-then-validate-strict each config via `parseStrictAssumingV1`. The GitOps reconcile path is refactored to call the same `validateVersionedConfigStrict`, so create / gitops-apply / the new RPC share one implementation.
  - `healthcheck.propose`'s dry-run (`@checkstack/ai-backend`) now calls `validateConfiguration` as its validation authority, so a wrong config type or a typo'd key surfaces at propose time, bringing it to the same deep-validate level `automation.propose` already has.

  State and scale: no durable state; `validateConfiguration` is a pure read against the in-process registries plus zod validation, identical on every pod.

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

- 9dcc848: Add the auto-generated, version-pinned `@checkstack/sdk` package + codegen, and serve its types live to the in-app editor.

  - A new committed workspace package `@checkstack/sdk`, generated from the platform's source of truth by `scripts/generate-sdk.ts` (`generate:sdk` / `generate:sdk:check`): a fully-typed oRPC client (`createCheckstackClient`) over the REST surface with one `InferClient` per plugin contract, real script-authoring helpers (`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`) whose runtime body is the same identity function the in-app runner injects, per-subpath `.d.ts` under the package `exports` map, and an editor-only ambient bundle. A `generate:sdk:check` CI guard fails when the committed SDK files drift from a fresh generation. The `@checkstack/sdk` version is stamped from `@checkstack/release` and MUST NOT appear in a changeset (a guard enforces this); the `@checkstack/release` bump here advances the release version so the generated SDK can be published later. The generated client also normalizes its base URL without a backtracking-prone regex, closing a CodeQL `js/polynomial-redos` finding.
  - Live editor type injection: a new version-keyed route `GET /api/script-packages/sdk-types/:releaseVersion` (raw handler in `@checkstack/script-packages-backend`) serves the generated SDK editor bundle with `Cache-Control: private, max-age=1y, immutable`; the pure path-build/parse module lives in `@checkstack/script-packages-common`, shared by backend and frontend. A mismatched version returns `409` so the editor refetches and never serves stale types after an upgrade. The frontend `useSdkTypeInjection` hook fetches the bundle once per session and mounts it into Monaco via `addExtraLib`. Schema-narrowed `context.config` / `context.event.payload` editor types stay local; the package-resolving module declarations come from the one published `@checkstack/sdk` source.

  BREAKING CHANGES: the script-authoring import surface moves from the bare `@checkstack/healthcheck` / `@checkstack/integration` virtual modules to the `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration` subpaths of the published `@checkstack/sdk` package. The old bare-name imports no longer resolve (an old import now errors in the editor, surfacing the migration). Existing scripts must update the module specifier:

      - import { defineHealthCheck } from "@checkstack/healthcheck";
      + import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

      - import { defineIntegration } from "@checkstack/integration";
      + import { defineIntegration } from "@checkstack/sdk/integration";

  The helper names and their runtime behaviour are unchanged - only the module specifier moves. The global (no-import) helper form continues to work unchanged.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Write-path hardening: post-commit side effects can no longer fail a committed write, multi-row mutations are now atomic, and retry-duplication is blocked at the database.

  **Platform-level (automatic for all current and future plugins):**

  - signal-backend: `SignalService` (broadcast / sendToUser / sendToUsers / sendToAuthorizedUsers) is now resilient by construction - a transient event-bus/queue failure is caught and logged instead of thrown. Real-time signals are best-effort UI nudges; the authoritative data is already committed by the time a mutation broadcasts, so a signal-transport blip must never turn a successful write into a client-visible error. Every plugin's broadcasts inherit this without per-call-site `try/catch` (which would inevitably be forgotten and regress). This mirrors `createCachedScope`, which already makes cache invalidation non-throwing - so the cache + signal halves of the "post-commit side effect fails the response" class are both closed at the platform seam. Durable side effects (events/hooks that drive automations, queue jobs) intentionally still surface failures. Documented in `developer-guide/backend/signals.md`.

  **Atomic multi-write mutations (each previously committed row-by-row in autocommit, so a mid-sequence failure left partial/orphaned state):**

  - slo-backend: `createObjective` now inserts the objective and its 1:1 streak row in one transaction; the post-create reconcile/status/notify steps are best-effort and can no longer fail the (committed) create.
  - incident-backend: `createIncident`, `updateIncident`, `addUpdate`, and `resolveIncident` wrap their row + system-link + timeline writes in a transaction (no more wiped system associations on a failed re-insert, or status flips with no matching timeline entry).
  - maintenance-backend: same for `createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`.
  - automation-backend: `cancelRun` marks the run cancelled and tears down its wait locks + durable state in one transaction - previously a failure after the status update could leave a wait lock behind, letting a later trigger event resume an already-cancelled run.
  - healthcheck-backend: `ingestSatelliteResult` commits the run row and its hourly-aggregate increment together (no orphaned run, no aggregate without a backing run). NOTE: this guarantees run/aggregate consistency but does not yet make a _duplicate satellite delivery_ idempotent - that needs a dedupe key on the high-volume runs table and is tracked as a follow-up.

  **Retry-duplication blocked at the DB (paired with the SQLSTATE 23505 -> 409 mapping shipped separately):**

  - catalog-backend: new unique indexes on `groups.name`, `environments.name` (consistent with `systems.name`), on `system_links (system_id, url)`, and on `system_contacts (system_id, user_id)` + `(system_id, email)` (NULLs are distinct, so user vs mailbox contacts don't interfere). Name uniqueness is CASE-INSENSITIVE: the three name indexes are functional `lower(name)` indexes (the existing `systems.name` index is rebuilt this way too), so "Api" and "api" collide while the stored value keeps its original casing. The systems pre-write name check (`getSystemByName`) is case-folded to match. Migration `0005` de-dupes any pre-existing rows first - names are preserved by suffixing later case-insensitive duplicates (" (2)", " (3)", ...), redundant contact/link rows are removed keeping the earliest. (Link URLs stay case-sensitive - URL paths are; contact emails are deduped exact-match.)
  - incident-backend / maintenance-backend: unique index on `incident_links (incident_id, url)` / `maintenance_links (maintenance_id, url)`, with a de-dupe step in the migration.

    **Behavior change:** creating a group/environment with a duplicate name, or attaching a duplicate contact/link, now returns `409 Conflict` instead of silently creating a duplicate. The migrations resolve existing duplicates on upgrade.

  This is a beta patch.

- 9dcc848: Assorted bug fixes and small hardening across the platform.

  - announcement-backend: `updateAnnouncement` now invalidates the active-announcements and admin-list caches (it was missing the `invalidateAllActive` / `invalidateListAll` calls), so an edited announcement no longer stays stale up to the 45s TTL.
  - anomaly-backend: anomaly/drift state transitions (confirmations, recoveries, self-resolutions) now log at `debug` instead of info/warn - they are already surfaced via the `ANOMALY_STATE_CHANGED` signal, so logging them louder just added noise; genuine failure paths stay `warn`.
  - backend: the `/api/:pluginId/*` dispatcher now populates `requestHeaders` on the per-request RPC context, so a handler that re-enters the router as the originating user (e.g. an AI tool's user-scoped client) can forward the caller's session cookie / bearer - previously the loopback failed with "Authentication required". Guarded by a real end-to-end integration test. The HTTP server idle timeout is also raised (default 255s, configurable via `CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS`, clamped 0-255, reset on each streamed chunk) so long AI chat SSE turns are not severed mid-stream.
  - backend: a request for an unknown plugin id (`/api/<unknown>/...`) now returns `404 Not Found` instead of `500` (and logs at warn, not error, since it is a client request) - an unknown _procedure_ on a known plugin already 404'd. The in-app docs namespace `/checkstack/*` now serves Starlight's own `404.html` with a real 404 status for a missing doc, instead of falling through to the SPA catch-all and 200-ing the app shell. Both guarded by tests.
  - automation-common: remove polynomial-time backtracking from `toShellEnvKey`'s underscore-trim (CodeQL `js/polynomial-redos`); a negative look-behind anchors the trailing run, keeping the trim linear.
  - common + script-packages-common: the pure transport-safe sandbox-policy schema (`sandboxPolicySchema` and its sub-schemas + inferred types) moved to `@checkstack/common` (the neutral base), removing two inverted deps that existed only to reach the shape; `@checkstack/backend-api` continues to re-export it. The schema is no longer exported from `@checkstack/script-packages-common`. Pure refactor, no behavior change.
  - catalog-backend: reject duplicate system names (a `CONFLICT` on create/rename, enforced by a pre-write check AND a new DB unique index on `systems.name`, migration 0004 which first resolves pre-existing duplicates by suffixing).
  - catalog-frontend: detail-page cleanups (use `<NotFound />` not `<AccessDenied />` on the not-found branch, a readable key/value metadata list via `normalizeMetadata`, runtime locale via `formatDate`); and stop the browse view re-rendering on every health report (adopt a new statuses report only when a value actually changed, via `healthStatusesEqual`, so rows stay stable and interactive).
  - healthcheck-backend: fix the daily-rollup retention step failing with an `ON CONFLICT` mismatch (SQLSTATE 42P10) after `environmentId` joined the `health_check_aggregates` unique constraint - the rollup now groups by (day, environmentId, sourceId) and uses a single exported conflict-target constant (`DAILY_AGGREGATE_CONFLICT_TARGET`) kept in lock-step with the schema by a unit test.
  - automation-frontend: the service-account picker's "Learn more" links are now absolute URLs to the deployed Astro docs site (they 404ed as in-app relative paths). The Monaco script editor double-init crash is fixed (serialized cold init, a guarded `monacoGuard` accessor, theme/type effects gated on `apiReady`).
  - auth-frontend: bound the desktop user-menu popover height (`max-h-[var(--radix-popover-content-available-height)]` + `overflow-y-auto`) so it no longer clips on short viewports, and fold the standalone `Account > Profile` item into a focusable name/email header (`profileHref` on `UserMenu`); the now-empty `Account` group no longer renders.
  - satellite-frontend: picked up via the sidebar-nav migration (account-only user menu).

  (Related UI fixes - the Monaco editor following the app theme, the `DynamicOptionsField` no-flash fix, the shared `Spinner`, GFM tables, and the user-menu popover bound - land their `@checkstack/ui` bump in the UI/perf changesets where `@checkstack/ui` is already minored.)

  This is a beta patch.

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ai-backend@0.1.0
  - @checkstack/ai-common@0.1.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/incident-backend@1.6.0
  - @checkstack/catalog-backend@1.4.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-backend@0.3.0
  - @checkstack/satellite-backend@0.6.0
  - @checkstack/command-backend@0.2.0
  - @checkstack/gitops-backend@0.5.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/incident-common@1.4.0
  - @checkstack/maintenance-common@1.4.0
  - @checkstack/secrets-backend@0.2.0
  - @checkstack/secrets-common@0.2.0
  - @checkstack/sdk@0.93.1
  - @checkstack/cache-api@0.3.9
  - @checkstack/queue-api@0.3.9
  - @checkstack/signal-common@0.2.6
  - @checkstack/cache-utils@0.2.14

## 1.5.0

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

- 0d9e5d8: fix: stop a single transient health check failure from escalating to "unhealthy"

  In consecutive threshold mode, when a run failed but the failure streak had
  not yet reached the configured degraded threshold (and there were not yet
  enough successes to confirm healthy), the evaluator fell back to the raw
  status of the latest run. A single failing run (e.g. a check timeout) that
  recovered on the next run therefore flipped the system to "unhealthy" and
  fired a spurious "System health critical" notification before the configured
  consecutive-failure count (default 2 for degraded, 5 for unhealthy) was
  reached.

  The evaluator now falls back to "healthy" in this case, matching window mode's
  behaviour and the intent of the thresholds: a transient blip below the
  degraded threshold no longer escalates the system status.

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/incident-backend@1.5.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/secrets-backend@0.1.1
  - @checkstack/cache-api@0.3.8
  - @checkstack/catalog-backend@1.3.1
  - @checkstack/command-backend@0.1.33
  - @checkstack/gitops-backend@0.4.1
  - @checkstack/queue-api@0.3.8
  - @checkstack/satellite-backend@0.5.1
  - @checkstack/script-packages-backend@0.2.1
  - @checkstack/cache-utils@0.2.13

## 1.4.0

### Minor Changes

- 270ef29: Add the health-state provider data contract (automation sensing layer, Wave 2 Phase 13).

  - New `health_check_state_transitions` table records every aggregate health-status transition for a system (all statuses, not just unhealthy), giving a reliable "in current status since" timestamp. Written wherever an aggregate transition is detected. Pruned with raw-run retention, but the single most-recent row per system is always kept so an active streak never blanks.
  - New service-typed RPCs on `HealthCheckApi`: `getHealthState({ systemId, configurationId? })` returns `{ status, inStatusSince, inStatusForMs, latencyMs?, avgLatencyMs?, p95LatencyMs?, successRate?, lastRunAt?, inMaintenance, evaluatedAt }`, and `getBulkHealthState({ systemIds })` (POST) resolves many systems against one shared timestamp.
  - New service-typed RPC on `MaintenanceApi`: `hasActiveMaintenance({ systemId })` reports whether a system is in an active maintenance window regardless of notification-suppression (suppression-agnostic), folded into `getHealthState` as `inMaintenance`.

  All reads are fail-safe: a missing transition row yields `inStatusSince: null`, and a maintenance-plugin error fails open to `inMaintenance: false`.

- 270ef29: Add a windowed transition count to the health provider - the building block for custom flapping rules (Wave 2 Phase 18).

  Flapping is already buildable today via the built-in `healthcheck.flapping_detected` trigger; this phase ships the GENERALIZATION for arbitrary "N status changes in M minutes" rules.

  - `countStateTransitionsInWindow` counts aggregate status transitions for a system over a trailing window (from the Phase 13 `health_check_state_transitions` table - all statuses, generalizing the unhealthy-only flapping detector). Fail-safe to 0.
  - `getHealthState` / `getBulkHealthState` now return `transitionsInWindow` + `transitionWindowMinutes`, and accept an optional `transitionWindowMinutes` input (default 60).
  - The automation definition gains an optional top-level `state_window_minutes` (default 60), threaded through `enrichScopeWithState` so `health.system.transitions_in_window` / `health.system.transition_window_minutes` are folded into scope per evaluation.
  - Operators author custom flapping as a `numeric_state` condition over `health.system.transitions_in_window` - no new condition variant, no editor change. The variable-scope resolver surfaces the new fields for autocomplete.

- 270ef29: Replace the hardcoded auto-incident path with default automations (Wave 2 Phase 20).

  BREAKING CHANGES: Auto-incident is now automation-driven. The hardcoded background path that opened incidents on sustained-unhealthy / flapping and closed them after a cooldown (`auto-incident.ts`, `auto-incident-close-job.ts`) is removed. On upgrade, an idempotent, threshold-preserving migration seeds equivalent default automations from each assignment's existing `NotificationPolicy`, so alerting behaviour is preserved 1:1:

  - `sustainedUnhealthyTrigger.durationMinutes` -> the `for:` dwell on a `healthcheck.system_degraded` trigger -> `incident.create`.
  - auto-close `autoCloseAfterMinutes` -> a `wait_until` (healthy continuously for the cooldown) -> `incident.resolve`.
  - `useNotificationSuppression` -> the incident's `suppressNotifications`.
  - `skipDuringMaintenance` -> a `{{ !health.system.in_maintenance }}` pre-run condition.
  - `flappingTrigger.{transitions,windowMinutes}` -> a second automation on the `healthcheck.flapping_detected` trigger -> `incident.create`.

  Auto-incidents remain ONE OPEN INCIDENT PER SYSTEM, faithful to the old behaviour. `incident.create` gains an opt-in `dedupe_open_for_system` config flag (default false, so existing/custom automations are unaffected): when true, it reuses an existing open incident on the target system instead of opening a duplicate (the old `findActiveAutoIncident(systemId)` semantic), returning the reused incident as the produced `incident` artifact. The seeded default automations set this flag, so a system with several failing checks - sustained and/or flapping - still gets a single open incident; whichever check crosses its threshold first opens it, and the rest dedupe to it. Both sustained and flapping default automations open at `critical` severity (parity with the old path). Per-system run dedup within an automation uses `concurrency_scope: "context_key"` + `mode: "single"`.

  Operators can read, edit, disable, and extend these automations (see the "Customise auto-incident" guide). Seeded automations are tagged via `managedBy` (`auto-incident:<systemId>:<configurationId>:<kind>`) so the migration is a no-op on re-runs; anything unmappable is recorded as a migration-failure row.

  Flapping DETECTION (transition recording + the `healthcheck.flapping_detected` emit) is relocated into `flapping-detector.ts` and survives; the emit now fires unconditionally on a threshold cross (no longer gated on `autoOpenIncidentOnUnhealthy`), matching the hook's documented intent and required for the flapping default automation. The legacy `health_check_auto_incidents` mapping table is no longer written or read (it will be dropped in a follow-up migration); `health_check_unhealthy_transitions` is retained for the flapping detector.

  New service-typed `HealthCheckApi.listAutoIncidentPolicies` RPC exposes each assignment's effective notification policy for the migration. `incident.create` adds the `dedupe_open_for_system` flag (additive, defaults off).

- b995afb: Make the per-system aggregated `health` a PLUGIN-BACKED, COMPUTE-ON-READ reactive entity via the Model-B entity state machine.

  Healthcheck defines a `health` entity `{ status, healthyChecks, totalChecks }` keyed by `systemId`. There is NO framework storage and NO domain table of its own: the `read` accessor DERIVES the view on demand from the same durable health data the rest of the plugin reads (`health_check_runs` via `getSystemHealthStatus`), gated on the system having at least one enabled check association (see the first-run-degradation fix changeset). Storing a second materialized copy would duplicate the engine's source of truth and risk drift, so the aggregate is computed, not mirrored.

  Each evaluation-site write drives `handle.mutate({ id: systemId, apply })`, where `apply` performs the REAL durable write (insert run + increment the hourly aggregate) and returns the freshly-computed view. The framework snapshots `prev` via `read` BEFORE the run is persisted, so a real status change still produces exactly one correct `ENTITY_CHANGED` with accurate prev to next. The write is fail-soft (a framework reactivity error after the durable write commits never breaks check execution) and diff-suppressed (an unchanged aggregate is a no-op). Raw `health_check_runs` stay intentionally non-reactive (`declareNonReactiveState`, raw-sample).

  A behavior-preserving change to trigger-event deriver maps a status transition to the existing qualified TRIGGER events (the underscore trigger ids automations match on, not the dotted hook ids):

  - recovery (`prev !== healthy` to `next === healthy`) to `healthcheck.system_healthy` + `healthcheck.system_health_changed`
  - degradation (`prev === healthy` to `next !== healthy`) to `healthcheck.system_degraded` + `healthcheck.system_health_changed`
  - any other transition to `healthcheck.system_health_changed`

  `classifyHealthChange` lets cross-plugin consumers (slo, dependency) reproduce the old directional `systemDegraded` / `systemHealthy` predicates from a `health` change read via `onEntityChanged({ kind: "health" })`. The transition history in `entity_transitions` is recorded for every change.

  BREAKING CHANGES:

  - The `health` entity's current state is computed on read from the durable `health_check_*` tables; there is no stored current-state row (no framework `entity_state`, no domain mirror). Any code reading current aggregated health must read through the entity `read` accessor / `handle.get` / `getMany`, scope enrichment, or `onEntityChanged`. Durable history in `entity_transitions` is unaffected. (The cross-plugin `healthcheck.system.degraded` / `.healthy` / `.health_changed` hooks are removed in the healthcheck/catalog hook-removal changeset; the reactive entity drives the matching trigger events so existing automations keep firing.)

- b995afb: Fix two correctness defects in the reactive `health` entity: suppressed first-run degradation, and duplicate `ENTITY_CHANGED` under concurrent N-pod evaluation.

  **First-run degradation was silently dropped (data-loss).** The compute-on-read `health` entity gated on the system having at least one persisted `health_check_runs` row, so a system's very first evaluation snapshotted `prev = null` (a create). The deriver and `classifyHealthChange` both treat a null side as "no transition", so a first-ever run that came up unhealthy fired NO `system_degraded` / `health_changed` trigger and NO `degraded` `onEntityChanged` - meaning SLO / dependency consumers never opened downtime. If the system stayed unhealthy, `prev === next` forever and the event never fired. The executor's own pre-run baseline (`getSystemHealthStatus`, no run gate) DID see the transition, so the entity and the executor disagreed.

  Fix: the existence gate is now on ENABLED check ASSOCIATIONS, not on persisted runs. A system with at least one enabled check resolves to the SAME default-`healthy` baseline `getSystemHealthStatus` returns for an empty run window (`{ status: "healthy", healthyChecks: N, totalChecks: N }`); a system with no enabled checks still has no entity. So a first-ever unhealthy run is now a real `healthy -> degraded` diff that fires `system_degraded` + `health_changed` and opens SLO / dependency downtime. The entity and the executor now agree on the pre-run baseline.

  **Concurrent evaluations of one system double-emitted (race / data-loss).** `writeHealthEntity -> handle.mutate` snapshotted `prev`, applied, and diffed with NO advisory lock. Two concurrent evaluations of one system (multiple per-config jobs across pods, or at-least-once redelivery) could both snapshot `prev = healthy`, both insert a failing run, both diff `healthy -> degraded`, and both emit - yielding two `ENTITY_CHANGED` + two `entity_transitions` rows for one logical transition (inflating `transitionCount` / flapping and re-running dependency notify).

  Fix: each system's snapshot-`prev` + `apply` + diff + emit is now serialized through a transaction-scoped advisory lock keyed `health:<systemId>` (`withXactLock` from `@checkstack/backend-api`), wired into `writeHealthEntity` via an injected `serialize` and applied at all three evaluation-write sites. Two concurrent evals of one system now collapse to exactly one emit and one transition row. The durable run/aggregate write is unchanged; only the snapshot/diff/emit window is protected.

  BREAKING CHANGES:

  - A system with an enabled health check now has a resolvable `health` entity BEFORE its first run (default-`healthy` baseline), where previously it had none until the first run persisted. Code that relied on the entity being absent for run-less-but-configured systems (e.g. treating a missing entity as "not yet monitored") should instead treat a `healthy` baseline as "configured, no failing signal yet". Systems with no enabled checks still have no entity.

- b995afb: Remove the now-unused healthcheck + catalog entity hooks; rely on the reactive entities + change derivers (reactive automation engine Phase 4, final step of §10.3 / §10.4).

  Now that every cross-plugin consumer (slo, dependency, incident, and healthcheck's own catalog-cleanup) reads these domains via `onEntityChanged`, the producers stop emitting the entity-change hooks and the trigger registrations become entity-driven (fired by the entity change deriver via Stage-1 routing, with a no-op `setup` so they stay in the editor's trigger catalog).

  - **healthcheck**: stops emitting `healthcheck.system.degraded` / `.healthy` / `.health_changed` from the queue executor (the `health` entity mirror is the single source of truth). Its own `catalog.system.deleted` consumer switched to `onEntityChanged({ kind: "catalog-system" })` on tombstones (work-queue delivery preserved). The directional/umbrella triggers are now entity-driven.
  - **catalog**: stops emitting `catalog.system.created` / `.updated` / `.deleted` and `catalog.group.created` / `.deleted` from the router + the `system.update_metadata` action (the `catalog-system` / `catalog-group` mirrors are authoritative). The system triggers are now entity-driven.

  CORRECTNESS FIX (also affects the earlier healthcheck/catalog Phase-4 steps in this branch): the change derivers now emit the TRIGGER qualifiedIds that automations actually store in `trigger.event` and that Stage-1 routing matches on (`findEnabledByTriggerEvent`), NOT the dotted hook ids. Healthcheck triggers use underscore ids, so the deriver emits `healthcheck.system_degraded` / `system_healthy` / `system_health_changed` (not `healthcheck.system.degraded`). Catalog system triggers use ids `created`/`updated`/`deleted`, so the deriver emits `catalog.created` / `catalog.updated` / `catalog.deleted` (not `catalog.system.created`). Without this fix the migrated automations would never fire.

  BREAKING CHANGES:

  - `healthcheck.system.degraded` / `healthcheck.system.healthy` / `healthcheck.system.health_changed` cross-plugin hooks are removed. The reactive `health` entity drives the matching trigger events (`healthcheck.system_degraded` / `_healthy` / `_health_changed`), so existing automations keep firing. Kept healthcheck hooks: `assignment.changed`, `check.completed`, `check.failed`, `flapping_detected`.
  - `catalog.system.created` / `.updated` / `.deleted` and `catalog.group.created` / `.deleted` cross-plugin hooks are removed. The reactive `catalog-system` / `catalog-group` entities drive the matching trigger events (`catalog.created` / `.updated` / `.deleted`); cross-plugin cleanup reactors subscribe to the `catalog-system` tombstone via `onEntityChanged`. `catalogHooks` / `healthCheckHooks` remain exported (the removed members are gone) for a stable import surface.

- b995afb: Move health-check flapping configuration from the per-assignment notification policy onto the `healthcheck.flapping_detected` automation trigger.

  Flapping thresholds (`transitions`, `windowMinutes`) are now configured on the trigger itself, next to the automation that reacts to them, instead of on each check assignment. The health-check executor still owns the windowed transition counting (it writes `health_check_unhealthy_transitions` and runs the window query), but it now SOURCES the thresholds from the subscribed automations' trigger config:

  - On a transition-to-unhealthy it records the transition unconditionally (keeping history warm), then looks up the enabled automations subscribed to `healthcheck.flapping_detected`, collects the distinct set of configured windows, counts transitions once per distinct window, and emits one `healthcheck.flapping_detected` per window. The trigger's exact-window `evaluateConfig` gate then fires each automation only for its own window and transition threshold.
  - A missing or partial flapping trigger config defaults to `{ transitions: 3, windowMinutes: 60 }`, so automations created before the trigger carried config keep working unchanged.
  - `automation-backend` exposes a new backend-only, read-only `automationSubscriptionsRef` service ref (`findEnabledByTriggerEvent`) so a plugin that owns a trigger's underlying event can discover its subscribers' trigger config. It is never browser-exposed.

  **BREAKING CHANGES**

  - The per-assignment `notificationPolicy.flappingTrigger` field is removed. `NotificationPolicy` is now `{ suppressDeEscalations }` only. Stored rows that still carry a `flappingTrigger` key parse cleanly - the key is stripped on read - so no data migration is required, but the per-check flapping toggle/threshold in the assignment Notifications tab is gone; configure flapping on the trigger instead.
  - The GitOps `System.healthcheck[].notificationPolicy.flappingTrigger` field is removed. A `flappingTrigger` block in a manifest is ignored. Move the thresholds to the `transitions` / `windowMinutes` config of your `healthcheck.flapping_detected` automation trigger.
  - The standalone `enabled` flag for flapping is gone: flapping is "enabled" precisely when at least one enabled automation subscribes to `healthcheck.flapping_detected`. With no subscriber, the transition is still recorded but nothing is counted or emitted.

- b995afb: Restore the documented domain payload fields on entity-driven automation triggers.

  Migrated triggers declare domain-named `payloadSchema`s (incident `incidentId`; health `systemId` / `previousStatus`; catalog `systemId` / `changedFields`; dependency `dependencyId`), but Stage-2 dispatch built `trigger.payload` from the generic entity-change shape (`{ kind, id, prev, next, delta, ...next }`). Operator filters and templates reading `trigger.payload.incidentId` / `.systemId` / `.previousStatus` silently resolved to `undefined` — a regression vs the legacy hook payloads.

  Changes:

  - `@checkstack/automation-backend`: `registerChangeDeriver` now accepts an optional per-kind `toPayload(changed) => Record<string, unknown>` mapper (at most one per kind; a second distinct mapper throws). Stage-2's `changedToPayload` uses the registered mapper to build `trigger.payload` so it matches the kind's declared `payloadSchema`, falling back to the generic change shape for kinds without a mapper. New exported type `EntityChangePayloadMapper`.
  - `@checkstack/incident-backend`, `@checkstack/healthcheck-backend`, `@checkstack/catalog-backend`, `@checkstack/dependency-backend`: implement and register a `toPayload` for each entity-driven kind so `trigger.payload` carries the legacy domain keys again.

  Descriptive incident payload fields not derivable from the reactive entity state (`title`, `description`, `createdAt`, `resolvedAt`) are now OPTIONAL on the incident trigger `payloadSchema`s — they were always absent from an entity-driven payload.

- b995afb: Remove the legacy per-assignment auto-incident system. Auto-incidents are now built entirely by user-authored automations; nothing is seeded or hardcoded.

  What was removed:

  - The one-time migration that auto-seeded "sustained unhealthy" and "flapping" default automations from each assignment's notification policy, plus the `listAutoIncidentPolicies` RPC it consumed.
  - The seeder-only notification-policy settings and their UI: `autoOpenIncidentOnUnhealthy`, `useNotificationSuppression`, `skipDuringMaintenance`, `sustainedUnhealthyTrigger`, and `autoCloseAfterMinutes`. The assignment **Notifications** tab now exposes only the two live settings: **Suppress de-escalation notifications** and the **flapping-detection** thresholds.
  - The dead `health_check_auto_incidents` table (no longer written or read; dropped via migration).

  What is preserved: flapping detection (`healthcheck.flapping_detected`) and de-escalation suppression are unchanged. The `flappingTrigger` and `suppressDeEscalations` policy fields stay exactly as before.

  > [!NOTE]
  > One-time cleanup: an automation-backend migration deletes the historically auto-seeded incident automations (`managed_by LIKE 'auto-incident:%'`) from existing databases. This is intentional and destructive - those automations were no longer managed by anything. If you had edited a seeded automation and want to keep it, re-create it as a normal automation before upgrading. See the "Build auto-incident automations" guide for templates.

  > [!IMPORTANT]
  > NARROWING: `NotificationPolicySchema` is narrowed to `{ suppressDeEscalations, flappingTrigger }`. Stored rows that still carry the removed legacy keys parse cleanly - zod strips the unknown keys on read - so no data migration is required for the `system_health_checks.notification_policy` column. GitOps `notificationPolicy` specs that set the removed fields are no longer accepted for those keys.

- 270ef29: Extend in-UI script testing to health-check collectors, and add
  load-from-run replay for automation script tests.

  - Health-check collectors: a new `testCollectorScript` RPC runs the
    inline-script (TypeScript) collector and the shell `script` collector
    against an editable, auto-seeded sample context using the same
    sandboxed runner the real collector uses. Surfaces beneath the
    collector script fields in the collector editor (both marked
    `x-script-testable`). Gated by `healthcheck.configuration.manage`.
  - Automation replay: a new `getRunScopeForReplay` RPC reconstructs an
    editable test context from a real run (trigger + persisted artifacts,
    plus the durable scope snapshot when the run is still in-flight), and
    the script-test panel gains a "Load from run" picker that seeds the
    sample context from a past run.

  Note: health-check executions do not persist the script / config /
  check / system that produced a result, so there is no health-check
  replay - auto-seed is the only context source for collector tests. This
  is by design; see the feature plan.

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

- b995afb: Add an optional `partitionBy` override to the windowed-count trigger gate.

  A trigger's `window` block now accepts `partitionBy`, a bare expression (same flavour as `filter`, no `{{ }}`) that controls the key the occurrence count is bucketed by. When omitted, the gate keys by the trigger's built-in context key exactly as before (per system for health triggers), so existing automations are unchanged. When set, the expression is evaluated against the same trigger scope `filter` uses and coerced to a string - e.g. `trigger.payload.severity` for a per-severity rate, or `trigger.payload.systemId + ":" + trigger.payload.checkId` for a composite key. If the expression evaluates to null/undefined/empty or fails to evaluate, the gate falls back to the built-in context key (never global counting); eval errors are logged, matching the gate's fail-open posture.

  Triggers can now declare `contextKeyLabel` (a UI hint, e.g. `"system"`) describing their built-in context dimension. It is surfaced through `TriggerInfo` so the editor's window "Partition by" field shows the default partition ("Leave blank to count per system" / "per automation" when a trigger has no context key). The healthcheck system triggers (`system_health_changed`, `system_degraded`, `system_healthy`, `check_failed`) and the built-in `numeric_state` trigger set it to `"system"`. This is a pure UI hint with no runtime behaviour.

  The automation editor's window block gains a "Partition by" expression input (reusing the trigger filter's `trigger.payload.*` autocomplete), and the collapsed trigger card summary shows the partition when set.

- b995afb: Add a generic windowed-count / rate trigger gate, and express flapping detection on it.

  Any trigger can now carry a `window: { count, minutes, refire }` block: the automation engine records each qualifying occurrence (after the structured config gate and the operator's `filter`) in a durable append log and counts rows within the trailing sliding window, scoped per context key (e.g. per system). `refire: "every"` (default) fires on every occurrence at/over the threshold; `refire: "once"` fires only on the crossing edge and re-arms as old occurrences age out. The gate runs in `maybeStartRun` after `filter` and before the `for:` dwell, so it composes with both.

  Flapping is now an instance of this mechanism rather than a bespoke detector. The healthcheck `system_health_changed` raw change event plus a `filter` (`trigger.payload.newStatus != "healthy"`) plus `window: { count: 3, minutes: 60, refire: "once" }` reproduces flapping in the engine.

  State-and-scale: window state lives in the new `automation_window_events` Postgres table (FK-cascade on the automation, the same delete-lifecycle as `automation_dwell_timers`). The count is read with pure SQL so every pod computes the same answer; the work-queue claim gives exactly one INSERT per emission, so there is no double-count. Rows older than the 24h schema cap are pruned by the existing stalled-sweeper. The `once` policy is best-effort under at-least-once redelivery (a redelivered emission can skip the exact crossing edge; `every` is redelivery-tolerant).

  **BREAKING CHANGES:**

  - The `healthcheck.flapping_detected` automation trigger and the `healthcheck.flapping_detected` hook are REMOVED. Flapping is now detected by the windowed-count gate on the `healthcheck.system_health_changed` trigger (`window` block, `refire: "once"`).
  - Flapping is now PER-SYSTEM (the aggregated `health` entity), not per-`(system, configuration)`. Subscribe to `check_failed` with a `window` instead if you need per-check rate detection.
  - The healthcheck `health_check_unhealthy_transitions` table is DROPPED (the per-check flapping audit log is no longer kept; counting moved into the engine).
  - The backend-only `automation.subscriptions` service ref (`automationSubscriptionsRef` / `AutomationSubscriptions`) is REMOVED. The engine enumerates subscribers internally and the window gate runs per-automation inside `maybeStartRun`, so the external read-ref is no longer needed.
  - Existing user-created flapping automations are AUTO-MIGRATED on boot: any trigger on `healthcheck.flapping_detected` is rewritten to `healthcheck.system_health_changed` + the canonical unhealthy-transition filter + `window: { count: transitions ?? 3, minutes: windowMinutes ?? 60, refire: "once" }`, dropping the old `config`. A pre-existing trigger filter is replaced with the canonical one (logged per row). An enabled automation that still references the removed event after migration logs a warning.

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/automation-backend@0.3.0
  - @checkstack/gitops-common@0.5.0
  - @checkstack/gitops-backend@0.4.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/maintenance-common@1.3.0
  - @checkstack/incident-backend@1.4.0
  - @checkstack/catalog-backend@1.3.0
  - @checkstack/secrets-backend@0.1.0
  - @checkstack/satellite-backend@0.5.0
  - @checkstack/script-packages-backend@0.2.0
  - @checkstack/secrets-common@0.1.0
  - @checkstack/cache-api@0.3.7
  - @checkstack/command-backend@0.1.32
  - @checkstack/queue-api@0.3.7
  - @checkstack/cache-utils@0.2.12

## 1.3.0

### Minor Changes

- 41c77f4: feat(automation): type enum-able trigger/artifact fields as enums for editor value autocompletion

  The automation editor's staged completion offers concrete values after a
  comparator (`{{ trigger.payload.severity == "high" }}`) only when the
  field's JSON Schema carries an `enum`. Several trigger payload + artifact
  schemas declared closed-set fields as loose `z.string()`, so no values
  were suggested. Tightened them to the canonical enums that already
  existed in each plugin's `-common` package (and matched the hook payload
  types in lockstep so the trigger's `payloadSchema` and `hook` keep the
  same `TPayload`):

  - **incident** — trigger payloads: `severity` → `IncidentSeverityEnum`,
    `status` / `statusChange` → `IncidentStatusEnum`.
  - **healthcheck** — trigger payloads: `previousStatus` / `newStatus` /
    `status` → `HealthCheckStatusSchema` (across systemDegraded,
    systemHealthy, systemHealthChanged, checkFailed; plus checkCompleted's
    hook type).
  - **dependency** — trigger + artifact: `impactType` → `ImpactTypeSchema`;
    impactPropagated `previousState` / `newState` → `DerivedStateSchema`.
    Also deduped the inline `impactTypeSchema` action-config enum to reuse
    the canonical `ImpactTypeSchema`.
  - **maintenance** — trigger + artifact: `status` →
    `MaintenanceStatusEnum`; deduped the inline `maintenanceStatusEnum`
    (used by `add_update.statusChange`) to the canonical one.
  - **slo** — `achievement.unlocked` trigger + hook: `achievement` →
    `AchievementTypeSchema`.

  Runtime behaviour is unchanged — these fields always carried valid enum
  values (the underlying records are enum-constrained); only the schema
  types were loose. The hook payload generics are now precise too, which
  caught one stale test fixture asserting an invalid `impactType: "soft"`.

  Fields that look enum-ish but are genuinely free-form were intentionally
  left as `z.string()`: satellite `region` (user-entered), Jira issue
  `status` (per-instance workflow name), notification `strategyQualifiedId`
  / `errorMessage`, healthcheck collector `result`, and script
  `stdout` / `stderr`.

- 41c77f4: feat(healthcheck): Phase 9 — run_now / enable / disable actions + umbrella health-changed trigger

  - New hook `healthCheckHooks.systemHealthChanged`, an umbrella variant
    of `systemDegraded` + `systemHealthy` that fires on **every**
    aggregated-health transition (with both `previousStatus` and
    `newStatus`). Emitted alongside the directional hooks at both
    emission sites in `queue-executor.ts`, so existing subscribers keep
    working unchanged.
  - New hook `healthCheckHooks.checkFailed` — fires alongside the
    existing `checkCompleted` whenever an individual run's status
    isn't `healthy`. Exists as a narrow alternative so an automation
    doesn't need "trigger on completion → filter by status" — useful
    for incident-style flows.
  - New hook `healthCheckHooks.flappingDetected` — fires from inside
    the auto-incident evaluator whenever the unhealthy-transition count
    crosses `policy.flappingTrigger.transitions` within
    `policy.flappingTrigger.windowMinutes`, regardless of whether
    `autoOpenIncidentOnUnhealthy` is enabled. Carries the observed
    count + window so subscribers can reason about both. Re-fires on
    every additional transition past the threshold while the check
    stays flapping — debounce on `(systemId, configurationId)` if
    "page once and only once" is wanted.
  - Triggers `healthcheck.system_degraded`,
    `healthcheck.system_healthy`, the umbrella
    `healthcheck.system_health_changed`, plus the new
    `healthcheck.check_failed` and `healthcheck.flapping_detected`.
    Inline trigger registrations moved out of `register()` into
    `automations.ts`.
  - Actions `healthcheck.run_now` (enqueues a one-off job on the
    shared `HEALTH_CHECK_QUEUE`), `healthcheck.enable_assignment`, and
    `healthcheck.disable_assignment`. The enable/disable actions use a
    new service method `setAssignmentEnabled(systemId, configurationId,
enabled)` that flips just the `enabled` flag without touching
    thresholds / satellite assignment / notification policy. Both fire
    the existing `assignmentChanged` hook so the satellite config relay
    picks up the change.
  - Artifact type `healthcheck.assignment` for downstream steps to
    consume.

  `HEALTH_CHECK_QUEUE` is exported so the `run_now` action can enqueue
  without re-importing the recurring-job factory.

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

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/incident-backend@1.3.0
  - @checkstack/catalog-backend@1.2.0
  - @checkstack/satellite-backend@0.4.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/incident-common@1.3.1
  - @checkstack/maintenance-common@1.2.3
  - @checkstack/command-backend@0.1.31
  - @checkstack/gitops-backend@0.3.7
  - @checkstack/gitops-common@0.4.2
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5
  - @checkstack/cache-api@0.3.6
  - @checkstack/queue-api@0.3.6
  - @checkstack/cache-utils@0.2.11

## 1.2.0

### Minor Changes

- ba07ae2: Quiet down notification spam on flapping systems, auto-open incidents when a check goes critical, and let operators land directly on the broken checks.

  Notification policy lives **per healthcheck assignment** (one row per `system × configuration`). Different checks on the same system are fully independent — disabling a setting on one check does not affect the others. Defaults preserve existing behaviour for `suppressDeEscalations`; **auto-incident defaults to on** for new and existing assignments.

  - **`suppressDeEscalations`** (off by default). When on, transitions from a worse state to a better-but-still-failing state (e.g. `unhealthy → degraded`) no longer fire a notification. Escalations and full recoveries to `healthy` are unaffected. Resolved per assignment (the just-ran check is the one driving any aggregate transition).
  - **`autoOpenIncidentOnUnhealthy`** (on by default). Either of two independent triggers can open the auto-incident:
    - **`sustainedUnhealthyTrigger`** (default 30 min) — opens when the check stays continuously unhealthy for the configured duration. Catches real outages.
    - **`flappingTrigger`** (default 3 transitions in 60 min) — opens when the check flips to unhealthy that many times in the window. Catches persistent flapping where each unhealthy phase is too brief for the sustained trigger.
      Each trigger can be individually disabled. One incident per system: triggering checks attach to an existing active auto-incident.
  - **`useNotificationSuppression`** (on by default, only meaningful when auto-open is on). Controls whether the auto-opened incident is created with `suppressNotifications: true` — leaving this off opens the incident but still pings operators on each transition.
  - **`skipDuringMaintenance`** (on by default). No auto-incident is opened while the system has an active maintenance window with suppression. The system is intentionally down and shouldn't trip the on-call.
  - **`autoCloseAfterMinutes`** (default 30). Auto-close cooldown is now per-assignment and snapshotted per-incident at open time — later policy edits don't alter in-flight incidents. Setting `null` ("Never auto-close") leaves the incident for manual resolution.
  - **Require-recovery rule.** After any auto-incident closes (manual or auto), no new auto-incident can open until the check has logged at least one healthy run. Prevents a "operator dismissed but it's still broken" loop.
  - **Auto-close worker** ticks every 60s and resolves auto-opened incidents whose systems have been healthy for their per-row `cooldownMinutes`. Rows with `null` cooldown are skipped entirely. Per-incident: failed close attempts are logged but never abort the sweep.
  - **`incidentResolved` hook subscriber** syncs the auto-incident mapping when an operator manually resolves the incident, so the require-recovery rule sees the close immediately.
  - **Platform-wide defaults.** New admin RPCs `getPlatformNotificationDefaults` / `setPlatformNotificationDefaults` (under the existing `healthcheck.configuration.{read,manage}` access rules) let operators set notification policy once for the whole instance. Per-assignment rows with `notificationPolicy: null` inherit the platform defaults at read time. UI: a "Notification defaults" button in the Assignment IDE opens a modal editor. The per-assignment Notifications panel shows an inheritance banner — "Using platform defaults" (read-only) with an "Override" button, or "Custom override" with a "Use platform defaults" button to revert. The all-or-nothing model keeps the mental model simple: each assignment is either fully inherited or fully overridden.
  - **New service-level RPCs** on the incident plugin (`createAutoIncident`, `resolveAutoIncident`) let other plugins open/close incidents without a user context. Reused by the healthcheck auto-incident flow.
  - **Health-state notification CTA** now deep-links to `?filter=failing` on the system detail page for non-recovery transitions (label changes to "View failing checks"). The system overview gains an `All / Failing / Healthy` segmented filter wired to the same `?filter=…` param.
  - **Notification bell badge** now counts collapse groups instead of raw rows, so the number matches what the user sees in the notifications list. Built on `COUNT(DISTINCT COALESCE(collapse_key, id))` — notifications without a collapse key still each count as one.
  - **`statusFilter` on `getHistory` / `getDetailedHistory`** lets the run-history page and the drawer's Recent Runs panel filter to `All / Healthy / Failing` via shared pills, with the page resetting to the first page on filter change.
  - **Pagination defaults aligned with selector options.** Several pages defaulted to a page size (5 or 20) that wasn't in the dropdown's options (`[10, 25, 50, 100]`), so the page-size `<Select>` rendered empty. The drawer's Recent Runs now defaults to 10; the Run History, History List, and Delivery Logs pages now default to 25.

  Includes Drizzle migrations adding the `notification_policy` jsonb column to `system_health_checks`, plus two new tables: `health_check_unhealthy_transitions` (for threshold counting) and `health_check_auto_incidents` (for mapping back to incident ids during auto-close).

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/incident-common@1.3.0
  - @checkstack/incident-backend@1.2.0
  - @checkstack/backend-api@0.17.1
  - @checkstack/satellite-backend@0.3.6
  - @checkstack/cache-api@0.3.5
  - @checkstack/catalog-backend@1.1.6
  - @checkstack/command-backend@0.1.30
  - @checkstack/gitops-backend@0.3.6
  - @checkstack/integration-backend@0.1.30
  - @checkstack/queue-api@0.3.5
  - @checkstack/cache-utils@0.2.10

## 1.1.4

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
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/catalog-backend@1.1.5
  - @checkstack/command-backend@0.1.29
  - @checkstack/gitops-backend@0.3.5
  - @checkstack/integration-backend@0.1.29
  - @checkstack/satellite-backend@0.3.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/gitops-common@0.4.1
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/incident-common@1.2.2
  - @checkstack/maintenance-common@1.2.2
  - @checkstack/signal-common@0.2.4
  - @checkstack/cache-api@0.3.4
  - @checkstack/queue-api@0.3.4
  - @checkstack/cache-utils@0.2.9

## 1.1.3

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/notification-common@1.1.1
  - @checkstack/cache-api@0.3.3
  - @checkstack/catalog-backend@1.1.4
  - @checkstack/command-backend@0.1.28
  - @checkstack/gitops-backend@0.3.4
  - @checkstack/integration-backend@0.1.28
  - @checkstack/queue-api@0.3.3
  - @checkstack/satellite-backend@0.3.4
  - @checkstack/catalog-common@2.2.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/incident-common@1.2.1
  - @checkstack/maintenance-common@1.2.1
  - @checkstack/cache-utils@0.2.8

## 1.1.2

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
  - @checkstack/catalog-backend@1.1.3
  - @checkstack/command-backend@0.1.27
  - @checkstack/gitops-backend@0.3.3
  - @checkstack/integration-backend@0.1.27
  - @checkstack/satellite-backend@0.3.3
  - @checkstack/cache-api@0.3.2
  - @checkstack/queue-api@0.3.2
  - @checkstack/cache-utils@0.2.7

## 1.1.1

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/catalog-backend@1.1.2
  - @checkstack/gitops-backend@0.3.2
  - @checkstack/satellite-backend@0.3.2

## 1.1.0

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
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/maintenance-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/satellite-backend@0.3.1
  - @checkstack/backend-api@0.15.2
  - @checkstack/catalog-backend@1.1.1
  - @checkstack/command-backend@0.1.26
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/integration-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 1.0.4

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/satellite-backend@0.3.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/maintenance-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/catalog-backend@1.1.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/integration-backend@0.1.25
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2
  - @checkstack/cache-utils@0.2.5

## 1.0.3

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
  - @checkstack/catalog-backend@1.0.2
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/gitops-backend@0.2.8
  - @checkstack/gitops-common@0.2.2
  - @checkstack/maintenance-common@1.0.1
  - @checkstack/queue-api@0.2.18
  - @checkstack/satellite-backend@0.2.21
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/incident-common@1.0.1
  - @checkstack/integration-backend@0.1.24
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 1.0.2

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/catalog-backend@1.0.1
  - @checkstack/command-backend@0.1.23
  - @checkstack/gitops-backend@0.2.7
  - @checkstack/integration-backend@0.1.23
  - @checkstack/queue-api@0.2.17
  - @checkstack/satellite-backend@0.2.20
  - @checkstack/cache-utils@0.2.3
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/gitops-common@0.2.1
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 1.0.1

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

  - @checkstack/satellite-backend@0.2.19

## 1.0.0

### Major Changes

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

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/gitops-backend@0.2.6
  - @checkstack/integration-backend@0.1.22
  - @checkstack/satellite-backend@0.2.18
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/queue-api@0.2.16
  - @checkstack/cache-utils@0.2.2

## 0.18.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/maintenance-common@0.5.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/integration-backend@0.1.21
  - @checkstack/satellite-backend@0.2.17
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/gitops-backend@0.2.5
  - @checkstack/queue-api@0.2.15
  - @checkstack/cache-utils@0.2.1

## 0.18.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

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

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/satellite-backend@0.2.16
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/gitops-backend@0.2.4
  - @checkstack/gitops-common@0.2.1
  - @checkstack/incident-common@0.4.9
  - @checkstack/integration-backend@0.1.20
  - @checkstack/maintenance-common@0.4.11
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.17.1

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.
  - @checkstack/catalog-common@1.5.1
  - @checkstack/incident-common@0.4.8
  - @checkstack/maintenance-common@0.4.10
  - @checkstack/satellite-backend@0.2.15
  - @checkstack/catalog-backend@0.6.1

## 0.17.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0
  - @checkstack/satellite-backend@0.2.14

## 0.16.5

### Patch Changes

- 9a320fe: Fixed an issue where GitOps-provisioned health checks were not added to the background execution queue immediately upon association.
  - @checkstack/satellite-backend@0.2.13

## 0.16.4

### Patch Changes

- Updated dependencies [adc89a8]
  - @checkstack/gitops-backend@0.2.3
  - @checkstack/catalog-backend@0.5.4
  - @checkstack/satellite-backend@0.2.12

## 0.16.3

### Patch Changes

- b53a40e: Fix GitOps entity update failures due to pending error records

  - Ensured the `existingEntityId` parameter in the Reconciler engine is set to `undefined` instead of a `"pending-UUID"` when handling entities that failed to sync initially.
  - Hardened the `Healthcheck` GitOps kind logic to explicitly ignore `"pending-"` IDs, preventing SQL update errors on synthetic provenance IDs.
  - Fixed a bug where resolving YAML syntax errors would cause the subsequent sync to fail with `failed query: update [...]` because it attempted to update the nonexistent `"pending-"` entity instead of creating a new one.

- Updated dependencies [b53a40e]
  - @checkstack/gitops-backend@0.2.2
  - @checkstack/catalog-backend@0.5.3
  - @checkstack/satellite-backend@0.2.11

## 0.16.2

### Patch Changes

- 57d54de: Fix GitOps Healthcheck reconciliation engine and Kind Registry UI

  - Mandated fully qualified IDs for all healthcheck strategies and collector definitions.
  - Refactored the Kind Registry UI to display schema documentation in beautifully formatted, interactive YAML examples.
  - Entity Envelope Fields and Base Spec Schema are now displayed in collapsed accordions.
  - Fixed condition logic that broke the collector documentation display.
  - Enhanced UX by dynamically injecting fully-qualified strategy variants directly into the YAML examples.

- Updated dependencies [57d54de]
  - @checkstack/gitops-backend@0.2.1
  - @checkstack/catalog-backend@0.5.2
  - @checkstack/satellite-backend@0.2.10

## 0.16.1

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/satellite-backend@0.2.9

## 0.16.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/catalog-backend@0.5.0
  - @checkstack/satellite-backend@0.2.8

## 0.15.1

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/satellite-backend@0.2.7

## 0.15.0

### Minor Changes

- 8ef367a: Added `registerSpecSchemaDocumentation` to EntityKindRegistry to allow plugins to provide detailed JSON Schemas for specific configurations. The frontend now displays these registered schemas as dropdown alternatives, improving the developer experience when authoring GitOps configurations.

### Patch Changes

- cb65e9d: ### Schema-driven secret resolution, rotation invalidation, and security hardening

  **Breaking**: Replaced `{ secretRef: "..." }` object syntax with `${{ secrets.NAME }}` template interpolation. The `secretField()`, `secretRefSchema`, `isSecretRef`, `SecretRef`, and `ResolvedSecretField` exports have been removed from `@checkstack/gitops-common`.

  **Breaking**: `ReconcileContext.resolveSecretsBySchema()` now returns `{ resolved: T; warnings: string[] }` instead of `T` directly. Plugins must destructure the result. Warnings contain messages for `${{ secrets.NAME }}` templates found in non-secret fields (fields without `x-secret` annotation).

  **New features**:

  - Secrets can be referenced in **any string field** using `${{ secrets.NAME }}` syntax
  - Inline interpolation is supported: `"postgres://user:${{ secrets.DB_PASS }}@host/db"`
  - Resolution is **schema-driven** — reuses the existing `configString({ "x-secret": true })` pattern from DynamicForm
  - Secret rotation now automatically invalidates affected entities, triggering re-reconciliation on the next sync cycle
  - New `getSecretUsage` RPC endpoint to look up which entities reference a given secret
  - Secrets UI now shows an expandable usage panel per secret showing referencing entities
  - Reconciliation warnings: templates in non-secret fields are detected and surfaced in the provenance UI
  - New `secretNameSchema` and `SECRET_NAME_REGEX` exports for validating secret names

  **Security**:

  - Secret names are validated at creation: must start with a letter, contain only `[a-zA-Z0-9_-]`, max 63 chars
  - Secrets are validated to exist at sync time but **not pre-resolved** into the spec
  - Templates in `metadata` fields are **rejected** to prevent secret leaks via display fields
  - Only fields with `x-secret` schema annotations get resolved — no escape hatch
  - Templates in non-secret fields emit warnings (stored in provenance, visible in UI) instead of silently passing

  **Migration**: Update YAML descriptors to use `${{ secrets.NAME }}` instead of `secretRef: name`. Remove `secretField()` imports from plugin schemas — use `configString({ "x-secret": true })` to annotate secret fields. Destructure `const { resolved } = await context.resolveSecretsBySchema({ value, schema })` (return type changed from `T` to `{ resolved: T; warnings: string[] }`).

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-common@0.2.0
  - @checkstack/gitops-backend@0.2.0
  - @checkstack/catalog-backend@0.4.3
  - @checkstack/satellite-backend@0.2.6

## 0.14.3

### Patch Changes

- Updated dependencies [79cf5f8]
  - @checkstack/gitops-backend@0.1.2
  - @checkstack/catalog-backend@0.4.2
  - @checkstack/satellite-backend@0.2.5

## 0.14.2

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-backend@0.1.1
  - @checkstack/gitops-common@0.1.1
  - @checkstack/catalog-backend@0.4.1
  - @checkstack/satellite-backend@0.2.4

## 0.14.1

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/satellite-backend@0.2.3

## 0.14.0

### Minor Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/gitops-backend@0.1.0
  - @checkstack/gitops-common@0.1.0
  - @checkstack/satellite-backend@0.2.2

## 0.13.1

### Patch Changes

- aa2b3aa: fix: remove arbitrary hardcoded assertions in jenkins collectors (queue-info, node-health, job-status) to prevent silent fallback assertion failures, instead properly threading transport execution errors directly to the SingleRunChartGrid UI display widget via a new `_collectorError` result payload property.
  - @checkstack/satellite-backend@0.2.1

## 0.13.0

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

- 26d8bae: Source attribution and filtering for satellite health checks

  **Source Attribution**

  - Fixed satellite result attribution: runs from satellites now correctly display their source instead of defaulting to "Local"
  - Added `sourceId` and `sourceLabel` to both public and detailed history API responses

  **Source Filtering**

  - Added `sourceFilter` parameter to `getHistory`, `getDetailedHistory`, and `getDetailedAggregatedHistory` RPC endpoints
  - Source filter supports "local" (core-only), specific satellite UUID, or all sources
  - Filter applies to all three aggregation tiers (raw, hourly, daily)

  **Frontend**

  - System detail accordion shows source filter buttons (All / Local / per-satellite) next to date range filter
  - Filter applies to both charts and recent runs table
  - Source column added to the recent runs table with Local/Remote badges
  - Health check history detail page includes per-satellite source filter buttons

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/satellite-backend@0.2.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24
  - @checkstack/command-backend@0.1.19
  - @checkstack/integration-backend@0.1.19
  - @checkstack/queue-api@0.2.13

## 0.12.1

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
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/integration-backend@0.1.18
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/incident-common@0.4.7
  - @checkstack/maintenance-common@0.4.9
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.12.0

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
  - @checkstack/backend-api@0.11.0
  - @checkstack/catalog-backend@0.2.22
  - @checkstack/command-backend@0.1.17
  - @checkstack/integration-backend@0.1.17
  - @checkstack/queue-api@0.2.11

## 0.11.0

### Minor Changes

- 1f191cf: Add SYSTEM_STATUS_CHANGED signal and dependency-driven notification improvements

  **healthcheck-common:**

  - New `SYSTEM_STATUS_CHANGED` signal that fires only on system-level health status transitions (healthy ↔ degraded ↔ unhealthy), providing a low-noise alternative to `HEALTH_CHECK_RUN_COMPLETED` for coarse-grained reactivity

  **healthcheck-backend:**

  - Broadcast `SYSTEM_STATUS_CHANGED` signal at both status transition code paths in the queue executor

  **healthcheck-frontend:**

  - Switch `SystemHealthBadge` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` to reduce unnecessary refetch noise

  **dashboard-frontend:**

  - Switch `SystemBadgeDataProvider` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` for more efficient badge updates

  **maintenance-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

  **incident-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

### Patch Changes

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/catalog-backend@0.2.21
  - @checkstack/command-backend@0.1.16
  - @checkstack/integration-backend@0.1.16
  - @checkstack/queue-api@0.2.10

## 0.10.7

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/catalog-backend@0.2.20
  - @checkstack/command-backend@0.1.15
  - @checkstack/integration-backend@0.1.15
  - @checkstack/queue-api@0.2.9

## 0.10.6

### Patch Changes

- @checkstack/catalog-backend@0.2.19

## 0.10.5

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/catalog-backend@0.2.18
  - @checkstack/command-backend@0.1.14
  - @checkstack/integration-backend@0.1.14
  - @checkstack/queue-api@0.2.8
  - @checkstack/catalog-common@1.2.11

## 0.10.4

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/backend-api@0.8.2
  - @checkstack/catalog-backend@0.2.17
  - @checkstack/catalog-common@1.2.10
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/incident-common@0.4.6
  - @checkstack/integration-backend@0.1.13
  - @checkstack/maintenance-common@0.4.8
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-common@0.1.8

## 0.10.3

### Patch Changes

- @checkstack/catalog-backend@0.2.16

## 0.10.2

### Patch Changes

- @checkstack/catalog-common@1.2.9
- @checkstack/incident-common@0.4.5
- @checkstack/maintenance-common@0.4.7
- @checkstack/catalog-backend@0.2.15

## 0.10.1

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12
  - @checkstack/catalog-backend@0.2.14
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-backend@0.1.12
  - @checkstack/queue-api@0.2.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/incident-common@0.4.4
  - @checkstack/maintenance-common@0.4.6
  - @checkstack/signal-common@0.1.7

## 0.10.0

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

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/catalog-backend@0.2.13
  - @checkstack/command-backend@0.1.11
  - @checkstack/integration-backend@0.1.11
  - @checkstack/queue-api@0.2.5

## 0.9.0

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

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/catalog-backend@0.2.12
  - @checkstack/command-backend@0.1.10
  - @checkstack/integration-backend@0.1.10
  - @checkstack/queue-api@0.2.4

## 0.8.3

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
  - @checkstack/catalog-backend@0.2.11
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/incident-common@0.4.3
  - @checkstack/integration-backend@0.1.9
  - @checkstack/maintenance-common@0.4.5
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.8.2

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/incident-common@0.4.2
  - @checkstack/maintenance-common@0.4.4
  - @checkstack/catalog-backend@0.2.10

## 0.8.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-backend@0.2.9
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/incident-common@0.4.1
  - @checkstack/integration-backend@0.1.8
  - @checkstack/maintenance-common@0.4.3
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-common@0.1.5

## 0.8.0

### Minor Changes

- d6f7449: Add availability statistics display to HealthCheckSystemOverview

  - New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
  - Availability is calculated as `(healthyRuns / totalRuns) * 100`
  - Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
  - Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
  - Shows total run counts for each period

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.7.0

### Minor Changes

- 1f81b60: ### Clickable Run History with Deep Linking

  **Backend (`healthcheck-backend`):**

  - Added `getRunById` service method to fetch a single health check run by ID

  **Schema (`healthcheck-common`):**

  - Added `getRunById` RPC procedure for fetching individual runs
  - Added `historyRun` route for deep linking to specific runs (`/history/:systemId/:configurationId/:runId`)

  **Frontend (`healthcheck-frontend`):**

  - Table rows in Recent Runs and Run History now navigate to detailed view instead of expanding inline
  - Added "Selected Run" card that displays when navigating to a specific run
  - Extracted `ExpandedResultView` into reusable component
  - Fixed layout shift during table pagination by preserving previous data while loading
  - Removed accordion expansion in favor of consistent navigation UX

### Patch Changes

- 090143b: ### Health Check Aggregation & UI Fixes

  **Backend (`healthcheck-backend`):**

  - Fixed tail-end bucket truncation where the last aggregated bucket was cut off at the interval boundary instead of extending to the query end date
  - Added `rangeEnd` parameter to `reaggregateBuckets()` to properly extend the last bucket
  - Fixed cross-tier merge logic (`mergeTieredBuckets`) to prevent hourly aggregates from blocking fresh raw data

  **Schema (`healthcheck-common`):**

  - Added `bucketEnd` field to `AggregatedBucketBaseSchema` so frontends know the actual end time of each bucket

  **Frontend (`healthcheck-frontend`):**

  - Updated all components to use `bucket.bucketEnd` instead of calculating from `bucketIntervalSeconds`
  - Fixed aggregation mode detection: changed `>` to `>=` so 7-day queries use aggregated data when `rawRetentionDays` is 7
  - Added ref-based memoization in `useHealthCheckData` to prevent layout shift during signal-triggered refetches
  - Exposed `isFetching` state to show loading spinner during background refetches
  - Added debounced custom date range with Apply button to prevent fetching on every field change
  - Added validation preventing start date >= end date in custom ranges
  - Added sparkline downsampling: when there are 60+ data points, they are aggregated into buckets with informative tooltips

  **UI (`ui`):**

  - Fixed `DateRangeFilter` presets to use true sliding windows (removed `startOfDay` from 7-day and 30-day ranges)
  - Added `disabled` prop to `DateRangeFilter` and `DateTimePicker` components
  - Added `onCustomChange` prop to `DateRangeFilter` for debounced custom date handling
  - Improved layout: custom date pickers now inline with preset buttons on desktop
  - Added responsive mobile layout: date pickers stack vertically with down arrow
  - Added validation error display for invalid date ranges

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0

## 0.6.0

### Minor Changes

- 11d2679: Add ability to pause health check configurations globally. When paused, health checks continue to be scheduled but execution is skipped for all systems using that configuration. Users with manage access can pause/resume from the Health Checks config page.
- cce5453: Add notification suppression for incidents

  - Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
  - When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
  - Mirrors the existing maintenance notification suppression pattern
  - Added toggle UI in the IncidentEditor dialog
  - Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries

### Patch Changes

- Updated dependencies [11d2679]
- Updated dependencies [cce5453]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/incident-common@0.4.0

## 0.5.0

### Minor Changes

- 095cf4e: ### Cross-Tier Data Aggregation

  Implements intelligent cross-tier querying for health check history, enabling seamless data retrieval across raw, hourly, and daily storage tiers.

  **What changed:**

  - `getAggregatedHistory` now queries all three tiers (raw, hourly, daily) in parallel
  - Added `NormalizedBucket` type for unified bucket format across tiers
  - Added `mergeTieredBuckets()` to merge data with priority (raw > hourly > daily)
  - Added `combineBuckets()` and `reaggregateBuckets()` for re-aggregation to target bucket size
  - Raw data preserves full granularity when available (uses target bucket interval)

  **Why:**

  - Previously, the API only queried raw runs, which are retained for a limited period (default 7 days)
  - For longer time ranges, data was missing because hourly/daily aggregates weren't queried
  - The retention job only runs periodically, so we can't assume tier boundaries based on config
  - Querying all tiers ensures no gaps in data coverage

  **Technical details:**

  - Additive metrics (counts, latencySum) are summed correctly for accurate averages
  - p95 latency uses max of source p95s as conservative upper-bound approximation
  - `aggregatedResult` (strategy-specific) is preserved for raw-only buckets

- ac3a4cf: ### Dynamic Bucket Sizing for Health Check Visualization

  Implements industry-standard dynamic bucket sizing for health check data aggregation, following patterns from Grafana/VictoriaMetrics.

  **What changed:**

  - Replaced fixed `bucketSize: "hourly" | "daily" | "auto"` with dynamic `targetPoints` parameter (default: 500)
  - Bucket interval is now calculated as `(endDate - startDate) / targetPoints` with a minimum of 1 second
  - Added `bucketIntervalSeconds` to aggregated response and individual buckets
  - Updated chart components to use dynamic time formatting based on bucket interval

  **Why:**

  - A 24-hour view with 1-second health checks previously returned 86,400+ data points, causing lag
  - Now returns ~500 data points regardless of timeframe, ensuring consistent chart performance
  - Charts still preserve visual fidelity through proper aggregation

  **Breaking Change:**

  - `bucketSize` parameter removed from `getAggregatedHistory` and `getDetailedAggregatedHistory` endpoints
  - Use `targetPoints` instead (defaults to 500 if not specified)

  ***

  ### Collector Aggregated Charts Fix

  Fixed issue where collector auto-charts (like HTTP request response time charts) were not showing in aggregated data mode.

  **What changed:**

  - Added `aggregatedResultSchema` to `CollectorDtoSchema`
  - Backend now returns collector aggregated schemas via `getCollectors` endpoint
  - Frontend `useStrategySchemas` hook now merges collector aggregated schemas
  - Service now calls each collector's `aggregateResult()` when building buckets
  - Aggregated collector data stored in `aggregatedResult.collectors[uuid]`

  **Why:**

  - Previously only strategy-level aggregated results were computed
  - Collectors like HTTP Request Collector have their own `aggregateResult` method
  - Without calling these, fields like `avgResponseTimeMs` and `successRate` were missing from aggregated buckets

- db1f56f: Add ephemeral field stripping to reduce database storage for health checks

  - Added `x-ephemeral` metadata flag to `HealthResultMeta` for marking fields that should not be persisted
  - All health result factory functions (`healthResultString`, `healthResultNumber`, `healthResultBoolean`, `healthResultArray`, `healthResultJSONPath`) now accept `x-ephemeral`
  - Added `stripEphemeralFields()` utility to remove ephemeral fields before database storage
  - Integrated ephemeral field stripping into `queue-executor.ts` for all collector results
  - HTTP Request collector now explicitly marks `body` as ephemeral

  This significantly reduces database storage for health checks with large response bodies, while still allowing assertions to run against the full response at execution time.

### Patch Changes

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-backend@0.2.8
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/integration-backend@0.1.7
  - @checkstack/maintenance-common@0.4.2
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.4.2

### Patch Changes

- 66a3963: Fix 500 error on `getDetailedAggregatedHistory` and update to SafeDatabase type

  - Fixed runtime error caused by usage of Drizzle relational query API (`db.query`) in `getAggregatedHistory`
  - Replaced `db.query.healthCheckConfigurations.findFirst()` with standard `db.select()` query
  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase`

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/catalog-backend@0.2.7
  - @checkstack/integration-backend@0.1.6
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.4.1

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/maintenance-common@0.4.1
  - @checkstack/catalog-backend@0.2.6
  - @checkstack/command-backend@0.1.5
  - @checkstack/integration-backend@0.1.5
  - @checkstack/queue-api@0.1.3
  - @checkstack/signal-common@0.1.3

## 0.4.0

### Minor Changes

- 18fa8e3: Add notification suppression toggle for maintenance windows

  **New Feature:** When creating or editing a maintenance window, you can now enable "Suppress health notifications" to prevent health status change notifications from being sent for affected systems while the maintenance is active (in_progress status). This is useful for planned downtime where health alerts are expected and would otherwise create noise.

  **Changes:**

  - Added `suppressNotifications` field to maintenance schema
  - Added new service-to-service API `hasActiveMaintenanceWithSuppression`
  - Healthcheck queue executor now checks for suppression before sending notifications
  - MaintenanceEditor UI includes new toggle checkbox

  **Bug Fix:** Fixed migration system to correctly set PostgreSQL search_path when running plugin migrations. Previously, migrations could fail with "relation does not exist" errors because the schema context wasn't properly set.

### Patch Changes

- db9b37c: Fixed 500 errors on healthcheck `getHistory` and `getDetailedHistory` endpoints caused by the scoped database proxy not handling Drizzle's `$count()` utility method.

  **Root Cause:** The `$count()` method returns a Promise directly (not a query builder), bypassing the chain-replay mechanism used for schema isolation. This caused queries to run without the proper `search_path`, resulting in database errors.

  **Changes:**

  - Added explicit `$count` method handling in `scoped-db.ts` to wrap count operations in transactions with proper schema isolation
  - Wrapped `$count` return values with `Number()` in healthcheck service to handle BigInt serialization

- Updated dependencies [18fa8e3]
  - @checkstack/maintenance-common@0.4.0

## 0.3.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/catalog-backend@0.2.5
  - @checkstack/command-backend@0.1.4
  - @checkstack/integration-backend@0.1.4
  - @checkstack/queue-api@0.1.2
  - @checkstack/catalog-common@1.2.2
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/signal-common@0.1.2

## 0.3.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/catalog-backend@0.2.4
  - @checkstack/command-backend@0.1.3
  - @checkstack/integration-backend@0.1.3
  - @checkstack/queue-api@0.1.1

## 0.3.3

### Patch Changes

- @checkstack/catalog-common@1.2.1
- @checkstack/catalog-backend@0.2.3

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
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/integration-backend@0.1.2
  - @checkstack/catalog-backend@0.2.2
  - @checkstack/command-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1
  - @checkstack/integration-backend@0.1.1
  - @checkstack/catalog-backend@0.2.1
  - @checkstack/command-backend@0.1.1

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
  - @checkstack/backend-api@0.3.0
  - @checkstack/catalog-backend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/integration-backend@0.1.0
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

- 97c5a6b: Add UUID-based collector identification for better multiple collector support

  **Breaking Change**: Existing health check configurations with collectors need to be recreated.

  - Each collector instance now has a unique UUID assigned on creation
  - Collector results are stored under the UUID key with `_collectorId` and `_assertionFailed` metadata
  - Auto-charts correctly display separate charts for each collector instance
  - Charts are now grouped by collector instance with clear headings
  - Assertion status card shows pass/fail for each collector
  - Renamed "Success" to "HTTP Success" to clarify it's about HTTP request success
  - Fixed deletion of collectors not persisting to database
  - Fixed duplicate React key warnings in auto-chart grid

### Patch Changes

- 97c5a6b: Fix collector lookup when health check is assigned to a system

  Collectors are now stored in the registry with their fully-qualified ID format (ownerPluginId.collectorId) to match how they are referenced in health check configurations. Added `qualifiedId` field to `RegisteredCollector` interface to avoid re-constructing the ID at query time. This fixes the "Collector not found" warning that occurred when executing health checks with assigned systems.

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/integration-backend@0.0.4
  - @checkstack/queue-api@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.1.0

### Minor Changes

- f5b1f49: Extended health check system with per-collector assertion support.

  - Added `collectors` column to `healthCheckConfigurations` schema for storing collector configs
  - Updated queue-executor to run configured collectors and evaluate per-collector assertions
  - Added `CollectorAssertionSchema` to healthcheck-common for assertion validation
  - Results now stored with `metadata.collectors` containing per-collector result data

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
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/catalog-backend@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.3

### Patch Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.2.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/catalog-common@0.1.2
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/signal-common@0.1.1

## 0.1.1

### Patch Changes

- @checkstack/catalog-common@0.1.1
- @checkstack/catalog-backend@0.0.3

## 0.1.0

### Minor Changes

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

- 0babb9c: Add public health status access and detailed history for admins

  **Permission changes:**

  - Added `healthcheck.status.read` permission with `isPublicDefault: true` for anonymous access
  - `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` now public
  - `getHistory` no longer returns `result` field (security)

  **New features:**

  - Added `getDetailedHistory` endpoint with `healthcheck.manage` permission
  - New `/healthcheck/history` page showing paginated run history with expandable result JSON

### Patch Changes

- e4d83fc: Add BullMQ queue plugin with orphaned job cleanup

  - **queue-api**: Added `listRecurringJobs()` method to Queue interface for detecting orphaned jobs
  - **queue-bullmq-backend**: New plugin implementing BullMQ (Redis) queue backend with job schedulers, consumer groups, and distributed job persistence
  - **queue-bullmq-common**: New common package with queue permissions
  - **queue-memory-backend**: Implemented `listRecurringJobs()` for in-memory queue
  - **healthcheck-backend**: Enhanced `bootstrapHealthChecks` to clean up orphaned job schedulers using `listRecurringJobs()`
  - **test-utils-backend**: Added `listRecurringJobs()` to mock queue factory

  This enables production-ready distributed queue processing with Redis persistence and automatic cleanup of orphaned jobs when health checks are deleted.

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
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/integration-backend@0.0.2
