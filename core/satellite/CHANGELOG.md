# @checkstack/satellite

## 0.9.1

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/metricstream-common@0.2.2
  - @checkstack/tracestream-common@0.1.2
  - @checkstack/logstream-common@0.4.2
  - @checkstack/backend-api@0.35.0
  - @checkstack/satellite-common@0.12.0
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/healthcheck-execution@0.35.1
  - @checkstack/k8s-events-common@0.1.2
  - @checkstack/script-packages-backend@0.4.7
  - @checkstack/secrets-common@0.3.4
  - @checkstack/ingest-utils@0.2.1
  - @checkstack/otlp-wire@0.1.1

## 0.9.0

### Minor Changes

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

### Patch Changes

- be74b01: Fix satellite crash-loop on startup (ENOENT reading `@checkstack/k8s-events-common`)

  Thanks to @stuajnht for reporting: satellite releases 134 and 135 crash-loop at
  startup with `error: ENOENT reading ".../@checkstack/k8s-events-common"`, while
  133 works. The k8s-events telemetry pull executor (added in 134) imports
  `@checkstack/k8s-events-common` eagerly at module load, but the satellite Docker
  image pruned it away, so the agent crashed before any check could run.

  Two root causes, both fixed:

  - `k8s-events-common` lived under `plugins/`, unlike its sibling telemetry
    contracts (`metricstream-common`, `logstream-common`, `tracestream-common`),
    which are in `core/`. A `core/` package (the satellite) importing a
    `plugins/` package is a dependency-direction violation; the package now lives
    in `core/` alongside its siblings.
  - The satellite image prune deleted every plugin except the `healthcheck-*` /
    `collector-*` backends by name pattern, which silently dropped any other
    package the satellite needs. The prune is now driven by the dependency graph:
    it keeps the transitive runtime-dependency closure of the satellite plus every
    plugin it loads dynamically at runtime (using those backends as extra roots,
    so they are never pruned by accident). The "which plugins does the satellite
    load" rule is now a single shared predicate consumed by both the runtime
    loader and the build-time prune, so they cannot drift.

  Verified by building `Dockerfile.satellite` and starting the image: it loads all
  15 strategies + 28 collectors, runs the k8s-events executor registration without
  `ENOENT`, and reaches normal core-connection retries instead of crash-looping.

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

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/satellite-common@0.11.0
  - @checkstack/k8s-events-common@0.1.1
  - @checkstack/healthcheck-execution@0.35.0
  - @checkstack/script-packages-backend@0.4.6
  - @checkstack/backend-api@0.34.1
  - @checkstack/logstream-common@0.4.1
  - @checkstack/telemetry-common@0.1.1
  - @checkstack/tracestream-common@0.1.1
  - @checkstack/metricstream-common@0.2.1

## 0.8.0

### Minor Changes

- 6c8b36b: New Kubernetes events source (`k8s-events.k8s-events`): an interval-pull
  source that lists cluster events from the modern `events.k8s.io/v1` API
  (request shapes verified against the official Kubernetes API reference)
  and ingests them as log records - Warning events as warnings, with the
  event's reason/note as the body and the regarding-object identity,
  reporting controller, and a stable `k8s.event.uid` in the attributes.
  Auth is a service-account bearer token (encrypted at rest, resolved
  just-in-time on satellites); namespace, fieldSelector and labelSelector
  scope the pull. Time-window pulls overlap slightly by design
  (`lookbackSeconds`), so rare duplicates are possible and documented -
  the stable event identity enables future dedupe. Supports satellite
  execution via a statically-linked pull executor.

  `maxEventsPerPull` caps EMITTED in-window records (the list API returns
  events roughly oldest-first, so the scan pages past out-of-window
  backlog to reach recent events); the scan itself is bounded by a
  40-page budget, and a busy cluster that exhausts it yields a partial
  window with an operator warning (core and satellite) recommending a
  namespace or fieldSelector, while a server that pages forever without
  items fails as a transport error.

- 6c8b36b: Prometheus scraping now runs on the telemetry platform as the pull source
  type `metricstream.prometheus-scrape` - the canonical reference for
  external source types. Existing scrape targets are migrated in place: a
  guarded cross-schema data migration copies every target into
  `telemetry_sources` (bindings, interval, satellite assignment, state), and
  a one-shot re-keys encrypted bearer tokens under the platform's secret
  store; `${{ secrets.NAME }}` references pass through unchanged. The
  per-stream Sources tab keeps one UX: the platform's sources section.

  Parity and correctness details: the telemetry pull seam gains optional
  `onRunFailure`/`onRunRecovery` health hooks (invoked with the stored
  consecutive-failure count on both core-scheduled and satellite-reported
  runs), which the scrape source type uses to keep emitting the
  `scrape_failing` important event exactly when three consecutive
  failures are crossed - once per outage episode, as before the
  migration. Satellite execution honors the instance's own `timeoutMs`
  (previously hard-capped at the platform's 30s default), resolves
  just-in-time secrets fresh per run so a rotated `${{ secrets.NAME }}`
  reference takes effect on the next scrape, and shares one
  size/series-capped response reader with the core path. The bearer
  re-key pass isolates per-source failures so one broken source cannot
  stall the rest, and a satellite still configured with the removed
  `CHECKSTACK_SATELLITE_SCRAPE` env var logs an explicit startup warning.
  Telemetry listener sources additionally only bind on the DEFAULT
  instance, so a namespaced secondary instance (PR preview) can never
  race the primary for listener ports.

  BREAKING CHANGES (platform is BETA): metricstream's private source
  extension point (`metricSourceExtensionPoint`) and the scrape-target CRUD
  procedures, schemas, and UI are REMOVED outright - manage scrape targets
  as telemetry sources instead. The satellite `scrape` capability
  (`CHECKSTACK_SATELLITE_SCRAPE`) is removed; satellites execute Prometheus
  scrapes through the `telemetry-pull` capability
  (`CHECKSTACK_SATELLITE_TELEMETRY_PULL`) via the statically-linked pull
  executor - update satellite deployment env accordingly. The legacy
  `metric_scrape_targets` table is DROPPED in the same release: plugin
  migrations run in dependency order, so the platform's promotion migration
  is guaranteed to precede metricstream's drop, and the bearer re-key
  one-shot now also deletes each migrated internal secret after re-keying
  it, leaving no orphans.

- 6c8b36b: Add the `telemetry-pull` capability to the satellite agent: satellite-bound
  telemetry pull-source instances execute at the edge. The agent receives a
  per-satellite instance config (secrets excluded - fetched just-in-time per
  field over the authenticated socket and cached only between config pushes),
  schedules one timer per instance with a concurrency cap, runs the source
  type's statically-linked `SatellitePullExecutor`, drops records for unbound
  signals, forwards batches for binding-authorized re-ingestion on core, and
  mirrors per-instance run status. A source type with no executor registered in
  this satellite build reports a per-instance status error instead of failing.
  Advertised via `CHECKSTACK_SATELLITE_TELEMETRY_PULL`.
- 6c8b36b: Tracestream health checks and satellite forwarding:

  - New reader-only OBSERVABILITY health strategy (`tracestream`) with two
    collectors: `trace-window` (windowed span/trace totals, error counts,
    error rate per minute, seconds since last span) and the repeatable
    `operation-latency` (per service/operation `p95Ms`/`avgMs`/`maxMs` and
    error rate; the window p95 merges the minute buckets' t-digest states
    before computing the percentile). The check editor gets
    stream/service/operation dropdowns via shared resolver constants.
  - Fast-path re-evaluation: a flush that persists error spans enqueues the
    affected checks ahead of schedule (pod-local debounce + deterministic
    cluster-wide job id), and a new `error_spike` important event records
    trailing-average error spikes at most once per stream per 10 minutes.
  - Satellite trace forwarding: satellites with
    `CHECKSTACK_SATELLITE_TRACE_RECEIVERS=1` expose local `/v1/traces`
    (OTLP protobuf + JSON) and `/ingest/traces` (native) receivers; spans
    ride the new `tracestream` telemetry-channel wire schema (ISO dates,
    decimal-string nanosecond timestamps) and re-enter the core through a
    satellite capability handler that verifies the forwarded `cktr_` token
    with the same authenticator as direct pushes and re-clamps span times
    against the core clock before feeding the identical ingest pipeline.

### Patch Changes

- 6c8b36b: Satellite forwarding hardening:

  - tracestream now persists per-stream satellite in-transit drop counts at
    parity with logstream/metricstream: a `dropped_in_transit_count` column
    on the activity table (additive migration) incremented durably by the
    capability handler (best-effort; an accounting failure can never change
    a batch's ack).
  - The satellite receivers' batch chunking and byte-budget estimation now
    live once in `@checkstack/ingest-utils` (`chunkTelemetryBatchItems`,
    `estimateTelemetryItemBytes`); the log/metric/trace receivers keep only
    their per-signal item shapes and caps. Behavior is pinned unchanged by
    the receivers' existing tests.

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
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/backend-api@0.34.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/k8s-events-common@0.1.0
  - @checkstack/logstream-common@0.4.0
  - @checkstack/metricstream-common@0.2.0
  - @checkstack/tracestream-common@0.1.0
  - @checkstack/otlp-wire@0.1.1
  - @checkstack/ingest-utils@0.2.0
  - @checkstack/common@0.23.0
  - @checkstack/script-packages-backend@0.4.5
  - @checkstack/satellite-common@0.10.1
  - @checkstack/secrets-common@0.3.3

## 0.7.2

### Patch Changes

- Updated dependencies [56af572]
  - @checkstack/logstream-common@0.3.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/common@0.22.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/ingest-utils@0.1.0
  - @checkstack/metricstream-common@0.1.0
  - @checkstack/otlp-wire@0.1.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/script-packages-backend@0.4.4
  - @checkstack/secrets-common@0.3.2

## 0.7.1

### Patch Changes

- Updated dependencies [099045f]
  - @checkstack/logstream-common@0.2.0

## 0.7.0

### Minor Changes

- 4568dcc: Satellite telemetry forwarding, agent side + the logstream core handler.

  `@checkstack/satellite` gains the local telemetry receivers and the metric
  scraper, each behind its capability env flag and forwarding into the ONE
  credit-window telemetry client (nothing touches the health-result path):

  - HTTP receivers on one port (`CHECKSTACK_SATELLITE_RECEIVER_PORT`, default 4318) when `CHECKSTACK_SATELLITE_LOG_RECEIVERS=1`: OTLP logs `/v1/logs`,
    native logs `/ingest`, OTLP metrics `/v1/metrics`, native metrics
    `/ingest/metrics`. The agent parses with the shared parsers, requires a
    `ckls_`/`ckms_`-SHAPED token (401 otherwise) and answers 202 after buffering;
    it does not (cannot) verify the token - the core handler does, so a
    core-rejected token is a documented "202-then-drop" surfaced as a counted
    drop.
  - A TCP/TLS syslog listener when `CHECKSTACK_SATELLITE_SYSLOG=1`
    (`CHECKSTACK_SATELLITE_SYSLOG_PORT` + `_TLS_CERT`/`_TLS_KEY`/`_HOST`), reusing
    the shared RFC 6587 framer + RFC 5424 parser and forwarding lines grouped by
    the token each message carried.
  - A metric-scrape scheduler when `CHECKSTACK_SATELLITE_SCRAPE=1`: consumes the
    `metric-scrape` capability config the core pushes (the targets bound to this
    satellite), reconciles one interval timer per target, and runs an SSRF-guarded
    scrape executor (same `resolveAndValidateHost` egress guard, timeout, size cap,
    and `capScrapeSeries` shaping as the core reconciler), forwarding datapoints
    and per-target status. Concurrent scrapes are capped (default 4); a transport
    failure is reported as `lastError` (never a metric).

  `@checkstack/logstream-backend` registers the "logstream" satellite capability
  handler against `satelliteCapabilityExtensionPoint`: it verifies each forwarded
  group's `ckls_` token with the existing ingest authenticator (revocation
  intact), re-clamps timestamps against the core clock, re-applies the stream's
  severity `valueMap`, and feeds the SAME ingest pipeline the HTTP endpoints use.
  Ack semantics mirror HTTP - a token rejection is terminal (dropped + counted);
  a whole-batch saturation that wrote nothing is retryable (safe, nothing was
  buffered); any partial accept is terminal so a resend never double-writes.

  `@checkstack/logstream-common` gains the shared `satellite-relay` wire contract
  (`SatelliteLogLine`/`SatelliteLogBatch` + `toWireLogLine`) used by both the
  agent receivers and the core handler.

- 4568dcc: Add the satellite telemetry protocol + capability foundation (log/metric
  forwarding and satellite-side scraping build on this). All additions are
  additive and version-skew safe - every new field is optional and old peers
  ignore unknown message types and fields, so mixed-version fleets keep working.
  The existing health-result path is untouched.

  - `@checkstack/satellite-common`: new generic telemetry envelopes on the WS
    protocol - `telemetry_batch` / `capability_status` (satellite -> core) and
    `telemetry_ack` / `capability_config` (core -> satellite). `authenticate` and
    `heartbeat` gain an optional `capabilities` list. New flow-control constants
    (max in-flight, batch item/byte caps, per-connection dedupe window and
    bytes/min budget, ack timeout, pump interval).
  - `@checkstack/satellite-backend`: a `satellite.capability` extension point so
    domain plugins contribute a handler per `kind` (ingest a batch, build the
    pushed config, handle a status update) without satellite-backend depending on
    any domain plugin. The WS handler routes telemetry by kind, dedupes resent
    batchIds per connection, enforces a per-connection byte budget (over-budget =
    retryable ack, never a disconnect), acks every batch, and pushes
    `capability_config` on connect and on `notifyCapabilityConfigChanged`
    (cross-pod via a broadcast domain event). Advertised capabilities are
    persisted on a new `satellites.capabilities` column and surfaced on the read
    model.
  - `@checkstack/satellite` (agent): a `TelemetryClient` that buffers per-kind
    (bounded, drop-oldest, counted) and forwards over a credit window (at most N
    unacked batches, chunked to the item/byte caps, monotonic per-connection
    batchId, resend-until-ack, drop-and-count on a terminal ack). Capabilities are
    advertised from env flags; an agent capability registry routes pushed
    `capability_config` to a consumer and sources `capability_status` back.
  - `@checkstack/ingest-utils`: `IngestBuffer` gains an opt-in `dropOldest` mode
    (evict oldest to admit new items, report how many were dropped) and a
    `drainChunk` for bounded FIFO draining. The default reject-new behavior the
    backend ingest endpoints rely on is unchanged.

  BREAKING CHANGE: none. The platform is in beta; this is purely additive.

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

- 4568dcc: Harden parsing and dispatch flagged by CodeQL (5 high-severity alerts):

  - Ingest-token extraction (`ckls_`/`ckms_`/generic source tokens) matched the
    `Authorization` header with `^Bearer\s+(.+)$`, whose `\s+` and `.+` overlap on
    whitespace and backtrack polynomially on crafted input (ReDoS). It now matches
    only the `Bearer ` scheme prefix and slices the remainder - linear time, same
    behavior.
  - The Prometheus text parser's `# TYPE`/`# HELP` line regex had the same
    overlapping-quantifier shape (`\s*(.*)$`); it now matches through the metric
    name and slices the rest.
  - The satellite client resolved a pending capability-secret callback from a map
    keyed by the untrusted `requestId` and invoked it directly, which reads as an
    unvalidated dynamic dispatch. The pending entry is now an object with a
    statically-named `settle` method, so the invocation is never a callee derived
    purely from external input.

- 4568dcc: Attribute satellite in-transit telemetry drops PER STREAM instead of a single
  connection-level count. Previously a satellite reported one aggregate
  `droppedSinceLast` per batch, and each core handler charged that full count to
  every stream the batch touched - so a multi-stream batch over-counted the loss
  on every stream, and a drop that belonged to one stream was smeared across the
  others.

  - Wire: `telemetry_batch.droppedSinceLast` (a single number) is replaced by
    `droppedByGroup` - a map of per-group drop counts, keyed by an opaque domain
    group string the capability handler interprets (the stream token for the
    forward paths, the scrape target id for `metric-scrape`). The whole satellite
    telemetry feature is unreleased, so this is a clean replacement, not a
    breaking change to any shipped agent.
  - Agent (`@checkstack/satellite`): the telemetry client buckets buffered items
    by a caller-supplied `groupKeyOf`, so drop-oldest eviction is naturally
    per-group; the loss rides the next batch's `droppedByGroup`. A terminal ack's
    `rejected` is no longer folded back into the agent's drop counter - that is a
    core-side outcome the core attributes itself, and folding it double-counted
    the loss and (for a bad token) misattributed it to unrelated streams.
  - `@checkstack/ingest-utils`: `IngestBuffer` (drop-oldest mode) now reports
    `droppedByKey` alongside the aggregate `dropped`, so a caller can attribute
    each eviction to the key it belonged to.
  - Core handlers (logstream forward, metricstream forward + scrape) resolve each
    `droppedByGroup` key to its stream - reusing the same token-verdict / target
    -binding lookups the payload uses - and record the loss against that stream
    alone. A key that no longer resolves to a stream (unknown/revoked token,
    unbound target) is left unattributed rather than charged elsewhere.

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/ingest-utils@0.1.0
  - @checkstack/logstream-common@0.1.0
  - @checkstack/metricstream-common@0.1.0
  - @checkstack/otlp-wire@0.1.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/common@0.22.0
  - @checkstack/script-packages-backend@0.4.4
  - @checkstack/secrets-common@0.3.2

## 0.6.6

### Patch Changes

- @checkstack/healthcheck-common@1.16.2
- @checkstack/script-packages-backend@0.4.3
- @checkstack/backend-api@0.32.1
- @checkstack/satellite-common@0.9.6

## 0.6.5

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/script-packages-backend@0.4.2
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/satellite-common@0.9.5

## 0.6.4

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/backend-api@0.31.1
  - @checkstack/satellite-common@0.9.4
  - @checkstack/script-packages-backend@0.4.1

## 0.6.3

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/script-packages-backend@0.4.0
  - @checkstack/satellite-common@0.9.3
  - @checkstack/secrets-common@0.3.2

## 0.6.2

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
  - @checkstack/backend-api@0.30.0
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/script-packages-backend@0.3.24
  - @checkstack/satellite-common@0.9.2

## 0.6.1

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/satellite-common@0.9.1
  - @checkstack/script-packages-backend@0.3.23
  - @checkstack/secrets-common@0.3.1

## 0.6.0

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
  - @checkstack/backend-api@0.29.0
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/satellite-common@0.9.0
  - @checkstack/script-packages-backend@0.3.22

## 0.5.21

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/script-packages-backend@0.3.21

## 0.5.20

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/satellite-common@0.8.14
- @checkstack/script-packages-backend@0.3.20

## 0.5.19

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/satellite-common@0.8.13
  - @checkstack/script-packages-backend@0.3.19

## 0.5.18

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/satellite-common@0.8.12
  - @checkstack/script-packages-backend@0.3.18

## 0.5.17

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/satellite-common@0.8.11
  - @checkstack/common@0.17.0
  - @checkstack/script-packages-backend@0.3.17

## 0.5.16

### Patch Changes

- @checkstack/script-packages-backend@0.3.16

## 0.5.15

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
  - @checkstack/script-packages-backend@0.3.15
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/satellite-common@0.8.10

## 0.5.14

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/script-packages-backend@0.3.14

## 0.5.13

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/script-packages-backend@0.3.13
  - @checkstack/satellite-common@0.8.9

## 0.5.12

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/satellite-common@0.8.8
  - @checkstack/script-packages-backend@0.3.12

## 0.5.11

### Patch Changes

- @checkstack/script-packages-backend@0.3.11

## 0.5.10

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0
  - @checkstack/script-packages-backend@0.3.10
  - @checkstack/satellite-common@0.8.7

## 0.5.9

### Patch Changes

- @checkstack/script-packages-backend@0.3.9
- @checkstack/backend-api@0.21.7
- @checkstack/satellite-common@0.8.6

## 0.5.8

### Patch Changes

- @checkstack/script-packages-backend@0.3.8

## 0.5.7

### Patch Changes

- @checkstack/backend-api@0.21.6
- @checkstack/satellite-common@0.8.5
- @checkstack/script-packages-backend@0.3.7

## 0.5.6

### Patch Changes

- @checkstack/script-packages-backend@0.3.6

## 0.5.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/satellite-common@0.8.4
  - @checkstack/script-packages-backend@0.3.5

## 0.5.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/script-packages-backend@0.3.4

## 0.5.3

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/satellite-common@0.8.3
- @checkstack/script-packages-backend@0.3.3

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/satellite-common@0.8.2
  - @checkstack/script-packages-backend@0.3.2

## 0.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/satellite-common@0.8.1
  - @checkstack/script-packages-backend@0.3.1

## 0.5.0

### Minor Changes

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-backend@0.3.0
  - @checkstack/satellite-common@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/script-packages-backend@0.2.1

## 0.4.0

### Minor Changes

- 270ef29: Satellite-side script-package reconciliation over the WS channel.

  - `satellite-common`: WS request/reply messages for pulling the manifest +
    blobs from core (`request_script_package_manifest` /
    `request_script_package_blob` -> `script_package_manifest` /
    `script_package_blob`).
  - `satellite-backend`: the WS handler answers those requests from the
    script-packages store (satellites pull from core, never the registry).
  - `@checkstack/satellite`: the client gains request/reply plumbing + a
    `SatelliteScriptPackages` manager that reuses the Phase 2 reconciler
    (`reconcileToHash` + `createReconcileFsDeps`) over the WS transport. It
    reconciles on a `refresh_script_packages` push and on the
    assignment-carried hash (startup / reconnect backstop), pulls only missing
    blobs (delta), materializes via `bun install --offline`, atomically flips
    `current`, reports sync state back, and degrades cleanly (error state, no
    stale tree, no registry access) when a blob can't be fetched. Reconciles
    are serialized + coalesced + idempotent.

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
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/script-packages-backend@0.2.0
  - @checkstack/satellite-common@0.7.0

## 0.3.0

### Minor Changes

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
  - @checkstack/backend-api@0.18.0
  - @checkstack/satellite-common@0.6.0

## 0.2.11

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/satellite-common@0.5.3

## 0.2.10

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/satellite-common@0.5.2

## 0.2.9

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/satellite-common@0.5.1

## 0.2.8

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3

## 0.2.7

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/satellite-common@0.5.0
  - @checkstack/backend-api@0.15.2

## 0.2.6

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
  - @checkstack/common@0.9.0
  - @checkstack/satellite-common@0.4.0
  - @checkstack/backend-api@0.15.1

## 0.2.5

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/satellite-common@0.3.2

## 0.2.4

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/common@0.7.0
  - @checkstack/satellite-common@0.3.1

## 0.2.3

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/satellite-common@0.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/satellite-common@0.3.0
  - @checkstack/backend-api@0.13.1

## 0.2.1

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/satellite-common@0.2.1

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
  - @checkstack/satellite-common@0.2.0
  - @checkstack/backend-api@0.12.0
