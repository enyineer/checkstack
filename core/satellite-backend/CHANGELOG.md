# @checkstack/satellite-backend

## 0.10.3

### Patch Changes

- Updated dependencies [68ef4b2]
  - @checkstack/backend-api@0.35.2
  - @checkstack/healthcheck-backend@1.23.3
  - @checkstack/automation-backend@0.11.12
  - @checkstack/secrets-backend@0.3.12
  - @checkstack/command-backend@0.3.2
  - @checkstack/gitops-backend@0.5.30
  - @checkstack/script-packages-backend@0.4.9
  - @checkstack/healthcheck-common@1.19.3
  - @checkstack/satellite-common@0.12.2

## 0.10.2

### Patch Changes

- @checkstack/automation-backend@0.11.11
- @checkstack/healthcheck-backend@1.23.2

## 0.10.1

### Patch Changes

- @checkstack/automation-backend@0.11.10
- @checkstack/healthcheck-backend@1.23.1
- @checkstack/healthcheck-common@1.19.2
- @checkstack/backend-api@0.35.1
- @checkstack/satellite-common@0.12.1
- @checkstack/script-packages-backend@0.4.8
- @checkstack/command-backend@0.3.1
- @checkstack/gitops-backend@0.5.29
- @checkstack/secrets-backend@0.3.11

## 0.10.0

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

- 88f4333: Cover the features that shipped on logic-only tests

  Inline mentions shipped completely inert while ~90 unit tests passed, because
  those tests proved the pure functions and nothing proved the render path. Four
  features carried exactly the same shape of coverage. Each now has a guard that
  was VERIFIED to fail when the thing it guards is broken.

  - **HTTP proxy.** `fetch({ proxy })` had never run: every test covered the URL
    we build, the SSRF host we guard and the field contracts, but no test routed a
    request through an actual proxy. A real proxy server now proves the request
    arrives there, that credentials are sent, that a 407 is a COMPLETED request
    (not a transport failure), that an unreachable proxy IS a transport failure,
    and that an empty templated proxy falls back to a direct connection.
  - **Status-coloured timeline dots.** The feature was `StatusUpdateTimeline`
    forwarding a caller's `renderDot`; the colour helpers were tested but the
    one-line forward was not. Now pinned, including per-item independence and the
    newest-first ordering a dot renderer must not assume away.
  - **System custom-field preview.** `SystemPreviewPicker` had no render coverage
    at all. Now covers the empty case, that the SELECTION is displayed, and that
    "No system" reports `null` rather than leaking the internal sentinel.
  - **Per-satellite offline threshold.** `computeStatus` is called from five
    places and a site that forgets the per-satellite value silently falls back to
    the global default, so the admin list, the entity read and the monitor
    disagree about the same satellite. A behavioural drift guard now drives the
    real reads with a heartbeat stale by the global default but fresh by the
    satellite's own threshold - and the shorter-threshold direction too.

  Tests only; no runtime behaviour changes.

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/automation-common@0.10.3
  - @checkstack/command-backend@0.3.0
  - @checkstack/notification-common@1.9.0
  - @checkstack/backend-api@0.35.0
  - @checkstack/satellite-common@0.12.0
  - @checkstack/healthcheck-backend@1.23.0
  - @checkstack/automation-backend@0.11.9
  - @checkstack/secrets-backend@0.3.10
  - @checkstack/cache-api@0.3.21
  - @checkstack/gitops-backend@0.5.28
  - @checkstack/gitops-common@0.7.5
  - @checkstack/queue-api@0.4.1
  - @checkstack/script-packages-backend@0.4.7
  - @checkstack/script-packages-common@0.4.3
  - @checkstack/secrets-common@0.3.4
  - @checkstack/signal-common@0.3.2

## 0.9.4

### Patch Changes

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

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/healthcheck-backend@1.22.0
  - @checkstack/satellite-common@0.11.0
  - @checkstack/automation-backend@0.11.8
  - @checkstack/secrets-backend@0.3.9
  - @checkstack/script-packages-backend@0.4.6
  - @checkstack/backend-api@0.34.1
  - @checkstack/command-backend@0.2.27
  - @checkstack/gitops-backend@0.5.27

## 0.9.3

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/backend-api@0.34.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/healthcheck-backend@1.21.3
  - @checkstack/queue-api@0.4.0
  - @checkstack/common@0.23.0
  - @checkstack/automation-backend@0.11.7
  - @checkstack/script-packages-backend@0.4.5
  - @checkstack/command-backend@0.2.26
  - @checkstack/gitops-backend@0.5.26
  - @checkstack/secrets-backend@0.3.8
  - @checkstack/satellite-common@0.10.1
  - @checkstack/automation-common@0.10.2
  - @checkstack/gitops-common@0.7.4
  - @checkstack/script-packages-common@0.4.2
  - @checkstack/secrets-common@0.3.3
  - @checkstack/signal-common@0.3.1

## 0.9.2

### Patch Changes

- @checkstack/automation-backend@0.11.6
- @checkstack/healthcheck-backend@1.21.2
- @checkstack/automation-common@0.10.1
- @checkstack/backend-api@0.33.0
- @checkstack/command-backend@0.2.25
- @checkstack/common@0.22.0
- @checkstack/gitops-backend@0.5.25
- @checkstack/gitops-common@0.7.3
- @checkstack/healthcheck-common@1.17.0
- @checkstack/queue-api@0.3.19
- @checkstack/satellite-common@0.10.0
- @checkstack/script-packages-backend@0.4.4
- @checkstack/script-packages-common@0.4.1
- @checkstack/secrets-backend@0.3.7
- @checkstack/secrets-common@0.3.2
- @checkstack/signal-common@0.3.0

## 0.9.1

### Patch Changes

- @checkstack/automation-backend@0.11.5
- @checkstack/healthcheck-backend@1.21.1
- @checkstack/secrets-backend@0.3.7

## 0.9.0

### Minor Changes

- 4568dcc: Add satellite telemetry for metric streams: forward push telemetry through
  satellites and scrape Prometheus targets FROM a satellite instead of core.

  metricstream-backend now contributes two handlers to satellite-backend's
  capability extension point (dependency inversion - the domain plugin
  contributes; satellite-backend never imports metricstream):

  - **kind `metricstream`**: a satellite receiver forwards push telemetry it
    accepted for one or more streams (payload is an array of `{ streamToken,
datapoints }` groups). Authorized end to end by each stream's `ckms_` source
    token (verified on core exactly like the HTTP push path); a bad/revoked token
    drops that group non-retryably. Forwarded datapoints go through the SAME
    ingest sink the HTTP push + scrape paths use (no duplicated fold logic).
  - **kind `metric-scrape`**: a scrape target can be BOUND to a satellite
    (`metric_scrape_targets.satellite_id`). `buildCapabilityConfig` tells each
    satellite which targets to scrape (`{ targets: [{ id, name, url,
intervalSeconds, timeoutMs, maxSeries, hasBearer }] }`). Forwarded scrape
    batches (`[{ targetId, datapoints }]`) are authorized by the target BINDING:
    core accepts an entry only when the target belongs to the sending satellite,
    rejecting mismatched/unknown targets. `handleCapabilityStatus`
    (`[{ targetId, lastScrapeAt, lastError, consecutiveFailures? }]`) mirrors
    per-target scrape health and fires the `scrape_failing` event on the threshold
    crossing, reusing the core reconciler's one-event-per-episode semantics.

  BEARER SECRETS: the bearer NEVER rides the config push. The config only flags
  `hasBearer`; the agent fetches the token just-in-time via a
  `capability_secret_request`, which the core handler's `resolveSecret` answers -
  binding-authorized (resolved ONLY when the target is bound to the requesting
  satellite) and returned over the authenticated channel, never persisted or
  logged. This reuses the health-check JIT secret pattern.

  The core Prometheus scrape reconciler EXCLUDES satellite-bound targets from its
  scheduling (they are scraped on the satellite) and cancels a target's core job
  when it rebinds core -> satellite; a rebind back reschedules it. Scrape-target
  CRUD notifies BOTH the old and new satellite so each converges its scrape set.

  Two new forward-only migrations: `metric_scrape_targets.satellite_id` (+ index),
  and `metric_stream_activity.dropped_in_transit_count` - a new counter of
  telemetry a SATELLITE dropped from its bounded buffer during a disconnect /
  slow-consumer episode (reported per stream via each batch's `droppedByGroup`,
  keyed by scrape target id for the scrape path and stream token for the forward
  path), surfaced on the `StreamActivity` / overview read model (distinct from
  cardinality-cap and buffer-full drops).

  metricstream-common gains: an optional `satelliteId` on the scrape-target DTOs
  (create/update/read); the shared satellite capability wire schemas
  (`MetricScrapeConfigSchema`, `MetricScrapeBatchSchema`, `MetricScrapeStatusSchema`,
  `MetricstreamForwardBatchSchema`, `WireDatapoint` + `wireDatapointToNormalized`)
  so the agent and frontend validate the same payloads; and the pure
  `parseOtlpMetricsJson` (moved from metricstream-backend so the satellite agent's
  `/v1/metrics` receiver can import it - backend now re-exports it).

  `@checkstack/satellite-backend` (minor, additive): the `handleTelemetryBatch`
  capability-handler ctx now carries the envelope's optional per-group
  `droppedByGroup`, and the WS handler forwards it, so a domain handler can
  attribute in-transit drops to the exact stream that lost data.

  SECURITY: authorize the caller-supplied `satelliteId` when creating/updating a
  scrape target. Previously the only gate was the stream `manage` grant, so a
  team-scoped stream manager could bind their target to another team's satellite +
  an internal URL in that satellite's zone, turning core into a cross-zone SSRF
  pivot. Binding a non-null satellite now requires (over a caller-scoped RPC) that
  the satellite EXISTS, the CALLER can READ it (`satellite.read`, else FORBIDDEN),
  and it advertises the `scrape` capability (else BAD_REQUEST) - applied on both
  create and update (rebind). A null binding (scrape from core) is unaffected.

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

### Patch Changes

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
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/healthcheck-backend@1.21.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/automation-backend@0.11.4
  - @checkstack/automation-common@0.10.1
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/gitops-backend@0.5.25
  - @checkstack/gitops-common@0.7.3
  - @checkstack/queue-api@0.3.19
  - @checkstack/script-packages-backend@0.4.4
  - @checkstack/script-packages-common@0.4.1
  - @checkstack/secrets-backend@0.3.7
  - @checkstack/secrets-common@0.3.2

## 0.8.6

### Patch Changes

- @checkstack/automation-backend@0.11.3
- @checkstack/healthcheck-backend@1.20.1
- @checkstack/healthcheck-common@1.16.2
- @checkstack/script-packages-backend@0.4.3
- @checkstack/backend-api@0.32.1
- @checkstack/satellite-common@0.9.6
- @checkstack/command-backend@0.2.24
- @checkstack/gitops-backend@0.5.24
- @checkstack/secrets-backend@0.3.6

## 0.8.5

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/healthcheck-backend@1.20.0
  - @checkstack/automation-backend@0.11.2
  - @checkstack/command-backend@0.2.23
  - @checkstack/gitops-backend@0.5.23
  - @checkstack/script-packages-backend@0.4.2
  - @checkstack/secrets-backend@0.3.5
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/satellite-common@0.9.5

## 0.8.4

### Patch Changes

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
  - @checkstack/automation-backend@0.11.1
  - @checkstack/healthcheck-backend@1.19.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/backend-api@0.31.1
  - @checkstack/gitops-backend@0.5.22
  - @checkstack/secrets-backend@0.3.4
  - @checkstack/satellite-common@0.9.4
  - @checkstack/command-backend@0.2.22
  - @checkstack/script-packages-backend@0.4.1

## 0.8.3

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/healthcheck-backend@1.18.0
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/automation-common@0.10.0
  - @checkstack/automation-backend@0.11.0
  - @checkstack/script-packages-common@0.4.0
  - @checkstack/script-packages-backend@0.4.0
  - @checkstack/satellite-common@0.9.3
  - @checkstack/command-backend@0.2.21
  - @checkstack/gitops-backend@0.5.21
  - @checkstack/gitops-common@0.7.3
  - @checkstack/queue-api@0.3.19
  - @checkstack/secrets-backend@0.3.3
  - @checkstack/secrets-common@0.3.2
  - @checkstack/signal-common@0.2.17

## 0.8.2

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
  - @checkstack/backend-api@0.30.0
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/healthcheck-backend@1.17.0
  - @checkstack/automation-backend@0.10.10
  - @checkstack/command-backend@0.2.20
  - @checkstack/gitops-backend@0.5.20
  - @checkstack/script-packages-backend@0.3.24
  - @checkstack/secrets-backend@0.3.2
  - @checkstack/satellite-common@0.9.2

## 0.8.1

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-backend@1.16.0
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/automation-backend@0.10.9
  - @checkstack/backend-api@0.29.1
  - @checkstack/satellite-common@0.9.1
  - @checkstack/automation-common@0.9.2
  - @checkstack/command-backend@0.2.19
  - @checkstack/gitops-backend@0.5.19
  - @checkstack/gitops-common@0.7.2
  - @checkstack/queue-api@0.3.18
  - @checkstack/script-packages-backend@0.3.23
  - @checkstack/script-packages-common@0.3.10
  - @checkstack/secrets-backend@0.3.1
  - @checkstack/secrets-common@0.3.1
  - @checkstack/signal-common@0.2.16

## 0.8.0

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
  - @checkstack/secrets-backend@0.3.0
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-backend@1.15.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/satellite-common@0.9.0
  - @checkstack/automation-backend@0.10.8
  - @checkstack/command-backend@0.2.18
  - @checkstack/gitops-backend@0.5.18
  - @checkstack/script-packages-backend@0.3.22
  - @checkstack/gitops-common@0.7.1
  - @checkstack/automation-common@0.9.1
  - @checkstack/queue-api@0.3.17
  - @checkstack/script-packages-common@0.3.9
  - @checkstack/signal-common@0.2.15

## 0.7.8

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/healthcheck-backend@1.14.0
  - @checkstack/backend-api@0.28.0
  - @checkstack/automation-backend@0.10.7
  - @checkstack/command-backend@0.2.17
  - @checkstack/gitops-backend@0.5.17
  - @checkstack/script-packages-backend@0.3.21
  - @checkstack/secrets-backend@0.2.17

## 0.7.7

### Patch Changes

- @checkstack/automation-backend@0.10.6
- @checkstack/healthcheck-backend@1.13.1

## 0.7.6

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/gitops-common@0.7.0
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/healthcheck-backend@1.13.0
  - @checkstack/automation-backend@0.10.5
  - @checkstack/gitops-backend@0.5.16
  - @checkstack/backend-api@0.27.1
  - @checkstack/satellite-common@0.8.14
  - @checkstack/script-packages-backend@0.3.20
  - @checkstack/command-backend@0.2.16
  - @checkstack/secrets-backend@0.2.16

## 0.7.5

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
  - @checkstack/healthcheck-backend@1.12.0
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/automation-common@0.9.0
  - @checkstack/automation-backend@0.10.4
  - @checkstack/satellite-common@0.8.13
  - @checkstack/script-packages-backend@0.3.19
  - @checkstack/command-backend@0.2.15
  - @checkstack/gitops-backend@0.5.15
  - @checkstack/gitops-common@0.6.8
  - @checkstack/queue-api@0.3.16
  - @checkstack/script-packages-common@0.3.8
  - @checkstack/secrets-backend@0.2.15
  - @checkstack/secrets-common@0.2.8
  - @checkstack/signal-common@0.2.14

## 0.7.4

### Patch Changes

- @checkstack/automation-backend@0.10.3
- @checkstack/healthcheck-backend@1.11.1

## 0.7.3

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/healthcheck-backend@1.11.0
  - @checkstack/automation-backend@0.10.2
  - @checkstack/automation-common@0.8.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/gitops-backend@0.5.14
  - @checkstack/gitops-common@0.6.7
  - @checkstack/queue-api@0.3.15
  - @checkstack/satellite-common@0.8.12
  - @checkstack/script-packages-backend@0.3.18
  - @checkstack/script-packages-common@0.3.7
  - @checkstack/secrets-backend@0.2.14
  - @checkstack/secrets-common@0.2.7
  - @checkstack/signal-common@0.2.13

## 0.7.2

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/automation-common@0.8.1
  - @checkstack/gitops-common@0.6.6
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/satellite-common@0.8.11
  - @checkstack/script-packages-common@0.3.6
  - @checkstack/secrets-common@0.2.6
  - @checkstack/signal-common@0.2.12
  - @checkstack/automation-backend@0.10.1
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/gitops-backend@0.5.13
  - @checkstack/healthcheck-backend@1.10.2
  - @checkstack/queue-api@0.3.14
  - @checkstack/script-packages-backend@0.3.17
  - @checkstack/secrets-backend@0.2.13

## 0.7.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-common@0.8.0
  - @checkstack/automation-backend@0.10.0
  - @checkstack/healthcheck-backend@1.10.1
  - @checkstack/script-packages-backend@0.3.16

## 0.7.0

### Minor Changes

- 8cad340: fix(satellite-backend): authorize satellite result messages per assignment

  A satellite's `result` message is now authorized against the satellite's actual
  assignment set, not just authenticated. The core accepts a result only when its
  `(configId, systemId)` pair is in the satellite's current assignments; an
  out-of-scope result is logged and dropped without closing the connection.

  Previously the WebSocket handshake authenticated WHICH satellite was connected
  but never authorized WHAT it could report for, so a compromised or malicious
  satellite could forge health data for any system (suppress a real outage, raise
  false alarms, or inject payloads into charts and aggregates). The authorization
  set is seeded on connect and refreshed on every assignment push, so a
  reassignment takes effect immediately.

### Patch Changes

- 8cad340: Widen Cmd+K command-palette coverage to every top-level sidebar destination.

  The command palette previously only surfaced commands from a handful of plugins,
  so large feature areas were silently unreachable from search. Each of these
  plugins now registers a "navigate to <feature>" command per top-level route via
  `registerSearchProvider`, so every sidebar destination they own is reachable
  from Cmd+K (entity search can come later):

  - dependency: "Dependency Map"
  - status-page: "Status pages"
  - satellite: "Satellites"
  - gitops: "GitOps", "Kind Registry"
  - secrets: "Secrets"
  - notification: "Notification Settings"
  - script-packages: "Script Packages", "Script Sandbox"

  Each command reuses the plugin's own route helper (`resolveRoute`) for its href
  and carries the same access rule that gates its sidebar nav entry, so palette
  visibility matches sidebar visibility. The notification command carries no
  access rule, matching its authenticated-only nav entry.

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
  - @checkstack/automation-backend@0.9.3
  - @checkstack/gitops-backend@0.5.12
  - @checkstack/secrets-backend@0.2.12
  - @checkstack/script-packages-backend@0.3.15
  - @checkstack/backend-api@0.25.0
  - @checkstack/healthcheck-backend@1.10.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/satellite-common@0.8.10
  - @checkstack/automation-common@0.7.1
  - @checkstack/gitops-common@0.6.5
  - @checkstack/queue-api@0.3.14
  - @checkstack/script-packages-common@0.3.5
  - @checkstack/secrets-common@0.2.5
  - @checkstack/signal-common@0.2.11

## 0.6.15

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/healthcheck-backend@1.9.2
  - @checkstack/automation-backend@0.9.2
  - @checkstack/secrets-backend@0.2.11
  - @checkstack/gitops-backend@0.5.11
  - @checkstack/script-packages-backend@0.3.14

## 0.6.14

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/automation-backend@0.9.1
  - @checkstack/gitops-backend@0.5.10
  - @checkstack/healthcheck-backend@1.9.1
  - @checkstack/script-packages-backend@0.3.13
  - @checkstack/secrets-backend@0.2.10
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/satellite-common@0.8.9

## 0.6.13

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-backend@1.9.0
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/automation-common@0.7.0
  - @checkstack/satellite-common@0.8.8
  - @checkstack/script-packages-backend@0.3.12
  - @checkstack/secrets-backend@0.2.9
  - @checkstack/gitops-backend@0.5.9
  - @checkstack/gitops-common@0.6.4
  - @checkstack/queue-api@0.3.13
  - @checkstack/script-packages-common@0.3.4
  - @checkstack/secrets-common@0.2.4
  - @checkstack/signal-common@0.2.10

## 0.6.12

### Patch Changes

- @checkstack/healthcheck-backend@1.8.1
- @checkstack/automation-backend@0.8.1
- @checkstack/secrets-backend@0.2.8
- @checkstack/script-packages-backend@0.3.11

## 0.6.11

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/automation-common@0.6.0
  - @checkstack/healthcheck-backend@1.8.0
  - @checkstack/gitops-backend@0.5.8
  - @checkstack/script-packages-backend@0.3.10
  - @checkstack/secrets-backend@0.2.8
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/satellite-common@0.8.7

## 0.6.10

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/automation-backend@0.7.0
  - @checkstack/automation-common@0.5.0
  - @checkstack/healthcheck-backend@1.7.2
  - @checkstack/script-packages-backend@0.3.9
  - @checkstack/secrets-backend@0.2.7
  - @checkstack/healthcheck-common@1.6.1
  - @checkstack/backend-api@0.21.7
  - @checkstack/satellite-common@0.8.6
  - @checkstack/gitops-backend@0.5.7

## 0.6.9

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/automation-backend@0.6.0
  - @checkstack/healthcheck-backend@1.7.1
  - @checkstack/script-packages-backend@0.3.8

## 0.6.8

### Patch Changes

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
  - @checkstack/healthcheck-backend@1.7.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/automation-backend@0.5.8
  - @checkstack/backend-api@0.21.6
  - @checkstack/satellite-common@0.8.5
  - @checkstack/script-packages-backend@0.3.7
  - @checkstack/gitops-backend@0.5.6
  - @checkstack/secrets-backend@0.2.6

## 0.6.7

### Patch Changes

- @checkstack/automation-backend@0.5.7
- @checkstack/healthcheck-backend@1.6.7

## 0.6.6

### Patch Changes

- @checkstack/automation-backend@0.5.6
- @checkstack/healthcheck-backend@1.6.6
- @checkstack/script-packages-backend@0.3.6

## 0.6.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/automation-common@0.4.3
  - @checkstack/gitops-common@0.6.3
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/satellite-common@0.8.4
  - @checkstack/script-packages-common@0.3.3
  - @checkstack/secrets-common@0.2.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/secrets-backend@0.2.5
  - @checkstack/gitops-backend@0.5.5
  - @checkstack/healthcheck-backend@1.6.5
  - @checkstack/script-packages-backend@0.3.5
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9

## 0.6.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/gitops-backend@0.5.4
  - @checkstack/healthcheck-backend@1.6.4
  - @checkstack/script-packages-backend@0.3.4
  - @checkstack/secrets-backend@0.2.4

## 0.6.3

### Patch Changes

- @checkstack/automation-backend@0.5.3
- @checkstack/healthcheck-backend@1.6.3
- @checkstack/automation-common@0.4.2
- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/gitops-backend@0.5.3
- @checkstack/gitops-common@0.6.2
- @checkstack/healthcheck-common@1.5.3
- @checkstack/queue-api@0.3.11
- @checkstack/satellite-common@0.8.3
- @checkstack/script-packages-backend@0.3.3
- @checkstack/script-packages-common@0.3.2
- @checkstack/secrets-backend@0.2.3
- @checkstack/secrets-common@0.2.2
- @checkstack/signal-common@0.2.8

## 0.6.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/automation-backend@0.5.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/gitops-backend@0.5.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-backend@1.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/satellite-common@0.8.2
  - @checkstack/script-packages-backend@0.3.2
  - @checkstack/script-packages-common@0.3.2
  - @checkstack/secrets-backend@0.2.2
  - @checkstack/secrets-common@0.2.2
  - @checkstack/signal-common@0.2.8

## 0.6.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/queue-api@0.3.10
  - @checkstack/automation-backend@0.5.1
  - @checkstack/automation-common@0.4.1
  - @checkstack/gitops-backend@0.5.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/healthcheck-backend@1.6.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/satellite-common@0.8.1
  - @checkstack/script-packages-backend@0.3.1
  - @checkstack/script-packages-common@0.3.1
  - @checkstack/secrets-backend@0.2.1
  - @checkstack/secrets-common@0.2.1
  - @checkstack/signal-common@0.2.7

## 0.6.0

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/healthcheck-backend@1.6.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/automation-common@0.4.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-common@0.3.0
  - @checkstack/script-packages-backend@0.3.0
  - @checkstack/satellite-common@0.8.0
  - @checkstack/gitops-backend@0.5.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/secrets-backend@0.2.0
  - @checkstack/secrets-common@0.2.0
  - @checkstack/queue-api@0.3.9
  - @checkstack/signal-common@0.2.6

## 0.5.1

### Patch Changes

- Updated dependencies [a57f7db]
- Updated dependencies [0d9e5d8]
  - @checkstack/backend-api@0.20.0
  - @checkstack/healthcheck-backend@1.5.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/secrets-backend@0.1.1
  - @checkstack/gitops-backend@0.4.1
  - @checkstack/queue-api@0.3.8
  - @checkstack/script-packages-backend@0.2.1

## 0.5.0

### Minor Changes

- b995afb: Make `satellite-connection` a plugin-backed, COMPUTE-ON-READ reactive entity over the DURABLE, globally-readable `satellites` table via the Model-B entity state machine.

  Satellite defines a `satellite-connection` entity `{ status: "online" | "offline", name, region, lastSeenAt, lastEvent }` keyed by satellite id. Its `status` is COMPUTED on read from the durable `last_heartbeat_at` column (via `computeStatus` / `OFFLINE_THRESHOLD_MS` - the SAME single liveness source of truth the admin satellite list uses), not stored. The only extra durable connection column is `last_connection_event` (`connected` / `disconnected` / `heartbeat_lost`), which the change-deriver reads as `lastEvent`. `lastSeenAt` is derived from `last_heartbeat_at` (null after a clean disconnect). There is no `entity_state` mirror and no stored status copy. `defineEntity({ kind: "satellite-connection", read })` resolves via `SatelliteService.getManyConnectionStates`. The three lifecycle sites - WS authentication (sets `last_heartbeat_at = now`, event `connected`), WS socket close (clears `last_heartbeat_at = null` so status flips offline immediately, event `disconnected`), and the heartbeat monitor's online->offline edge (flips only the event to `heartbeat_lost`) - drive `handle.mutate({ id: satelliteId, apply })`, where `apply` UPDATEs the satellite row's liveness columns and returns the computed view. The platform still records full transition HISTORY in `entity_transitions` for every change. `last_heartbeat_at` is the reactive liveness input now, so the `declareNonReactiveState` escape-hatch is retained for raw bookkeeping but the status it drives is the entity's.

  This fixes a horizontal-scaling defect twice over. (a) Connection state originally lived in a process-local in-memory map, so a satellite connected to pod A was invisible to pod B's reads. (b) A prior fix made the STATUS durable but left the online->offline (`heartbeat_lost`) transition DETECTION pod-local: the heartbeat-check job runs under one consumer group claimed by a VARYING pod, and a pod with an empty in-memory `previousStatuses` map never observed the satellite online, so it never fired `heartbeat_lost` - leaving the stored `connection_status` stuck `online` forever after a pod crash. Computing status on read removes the stored copy that could get stuck (a stale row self-heals to `offline` once `last_heartbeat_at` ages past the threshold, from any pod), and the heartbeat monitor now detects the lost edge from DURABLE state alone - any pod, idempotent across pods + redelivery: it reads every satellite's `(last_heartbeat_at, last_connection_event)`, computes status, and for any that is `offline` while still marked `connected` drives the `heartbeat_lost` mutate; once `last_connection_event = "heartbeat_lost"`, re-runs are no-ops (a small in-memory set is kept ONLY as a per-pod broadcast-dedup optimisation, never as the source of truth). A new env-gated cross-pod IT (`heartbeat-monitor.it.test.ts`) proves a `heartbeat_lost` detected by a fresh "pod" that never saw the satellite online, so the pod-local-baseline bug cannot recur. `toSatelliteWithStatus` / `getOnlineSatelliteIds` and the entity now derive from the same `last_heartbeat_at` - one source of truth, no disagreement.

  A registered change-deriver maps these entity changes back to the `satellite.connected` / `satellite.disconnected` / `satellite.heartbeat_lost` trigger events, so existing automations keep firing. The three-way distinction is preserved by an explicit `lastEvent` discriminator on the entity state: a bare `status` diff cannot tell a socket drop (`disconnected`) apart from the heartbeat-lost offline edge (`heartbeat_lost`), so the deriver reads `lastEvent` to fire the exact original event. The old connection hooks are removed in favor of the reactive entity.

  BREAKING CHANGES:

  - DROPPED the `satellites.connection_status` and `satellites.last_seen_at` columns added by the prior fix (migration `0002_graceful_mac_gargan.sql`, forward-only). Status is now computed on read from `last_heartbeat_at` (no stored copy to drift or get stuck), and `lastSeenAt` is derived from `last_heartbeat_at`. The `last_connection_event` column is KEPT (the deriver's event discriminator + the monitor's idempotency key). Existing rows with a non-null `last_connection_event` keep reading their derived status; rows that never connected (null `last_connection_event`) report no current state until their next lifecycle edge.
  - Removed the `satellite.connected`, `satellite.disconnected`, and `satellite.heartbeat_lost` hooks (`createHook`). Use the `satellite-connection` entity's auto-emitted change events (subscribe via the `automation.entity` extension point's `onEntityChanged`, or author automations against the derived trigger events). The `satellite.removed` deletion/cleanup hook is unaffected and stays.
  - The `connected` / `disconnected` / `heartbeat_lost` automation triggers are now ENTITY-DRIVEN instead of hook-backed: they are fired by the `satellite-connection` entity change-deriver (Stage-1 routing) rather than a `createHook`, but stay REGISTERED in the automation editor's trigger catalog (a no-op `setup` via `makeEntityDrivenTriggerSetup`), so they remain offered as picker entries and payload-introspectable. Already-authored automations referencing them continue to fire. A registered `toPayload` mapper keeps the runtime `trigger.payload` matching each trigger's declared `payloadSchema` (`satelliteId`, `name`, `region`, `status`, `lastSeenAt` (nullable - `null` after a clean disconnect)), rather than degrading to the generic entity-change shape.
  - The `satellite-connection` entity's current state is COMPUTED on read from the durable `satellites.last_heartbeat_at` (+ `last_connection_event`), NOT a framework `entity_state` row and NOT a stored status column. Any code reading current connection state must read through the entity `read` accessor / `handle.get` / `getMany`. Durable history in `entity_transitions` is unaffected.

- 270ef29: Core-side satellite script-package distribution.

  - `satellite-backend`: the WS handler now carries the desired script-package
    lockfile hash in `authenticated` / `config_updated` payloads (the durable
    backstop), exposes `pushRefreshScriptPackagesToAll` (wired to the
    `script-packages.changed` broadcast hook in `mode: "broadcast"`, so each
    core instance fans the refresh out to its own connected satellites), and
    persists `script_package_sync_state` reports from satellites.
  - `script-packages-*`: new `reportSatelliteSyncState` RPC + store method so
    satellite-backend can record per-satellite reconcile state for the admin
    UI. Satellites pull blobs from core via the existing `getManifest` /
    `downloadBlob` endpoints, never the registry.

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

- b995afb: Extract a shared `withEntityWrite` / `withEntityRemove` guard for PLUGIN-BACKED (Model B) reactive entities and refactor the per-domain copies onto it.

  Every plugin-backed domain (incident, catalog, dependency, maintenance, slo, satellite) reimplemented the same "no handle wired → run the plugin write directly; handle wired → route through `handle.mutate` / `handle.remove`" guard, varying only in the id-key name. `@checkstack/automation-backend` now exports `withEntityWrite` / `withEntityRemove` (from the entity barrel) and each domain's thin, well-named wrappers (`writeIncidentEntity`, `writeMaintenanceEntity`, satellite's `mirror`, …) delegate to it, so the branch lives in exactly one place. Behavior is unchanged.

  `writeHealthEntity` (healthcheck-backend) is intentionally NOT migrated onto the helper — it is genuinely bespoke (closure-captured durable state, distinct rethrow-vs-fail-soft branches, a per-system serializer, and it returns the computed state). SLO keeps its fail-soft `onError` wrapper around the shared guard.

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
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
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
  - @checkstack/automation-common@0.3.0
  - @checkstack/healthcheck-backend@1.4.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/secrets-backend@0.1.0
  - @checkstack/script-packages-backend@0.2.0
  - @checkstack/script-packages-common@0.2.0
  - @checkstack/satellite-common@0.7.0
  - @checkstack/secrets-common@0.1.0
  - @checkstack/queue-api@0.3.7

## 0.4.0

### Minor Changes

- 41c77f4: feat(satellite): Phase 9 — connection lifecycle triggers

  - New hooks `satelliteHooks.connected`, `satelliteHooks.disconnected`,
    and `satelliteHooks.heartbeatLost`. `connected` and `disconnected`
    fire from the WS handler at auth completion and `onClose`
    respectively; `heartbeatLost` fires from the heartbeat monitor on
    the `online → offline` edge only (the opposite edge is observable
    via `connected`).
  - Triggers `satellite.connected`, `satellite.disconnected`,
    `satellite.heartbeat_lost` registered against the Automation
    Platform. All carry `contextKey: (p) => p.satelliteId` so a
    long-running automation can resume on the same satellite.
  - No mutation actions in this chunk — connection lifecycle is
    observed only, not commanded.

  Plumbing: `SatelliteWsHandler` and `HeartbeatMonitor` both take an
  optional hook sink in their constructor. The sink is provided from
  `afterPluginsReady` where `emitHook` is available; until then, the
  classes behave exactly as before (no hooks fired, no behavioural
  change).

### Patch Changes

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
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/healthcheck-backend@1.3.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/satellite-common@0.6.0
  - @checkstack/gitops-backend@0.3.7
  - @checkstack/gitops-common@0.4.2
  - @checkstack/signal-common@0.2.5
  - @checkstack/queue-api@0.3.6

## 0.3.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/healthcheck-backend@1.2.0
  - @checkstack/backend-api@0.17.1
  - @checkstack/satellite-common@0.5.3
  - @checkstack/gitops-backend@0.3.6
  - @checkstack/queue-api@0.3.5

## 0.3.5

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
  - @checkstack/gitops-backend@0.3.5
  - @checkstack/healthcheck-backend@1.1.4
  - @checkstack/gitops-common@0.4.1
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/satellite-common@0.5.2
  - @checkstack/signal-common@0.2.4
  - @checkstack/queue-api@0.3.4

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
