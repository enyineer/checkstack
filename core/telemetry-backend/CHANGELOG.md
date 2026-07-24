# @checkstack/telemetry-backend

## 0.1.1

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/satellite-common@0.11.0
  - @checkstack/satellite-backend@0.9.4
  - @checkstack/auth-common@0.16.0
  - @checkstack/secrets-backend@0.3.9
  - @checkstack/backend-api@0.34.1
  - @checkstack/telemetry-common@0.1.1

## 0.1.0

### Minor Changes

- 6c8b36b: Signal-to-signal DERIVE sources: the telemetry platform gains a fourth
  source mode - a derive source consumes one signal's already-ingested
  records from a configured input stream and emits another signal. Two
  built-in types ship: `log-to-metric` (count matching lines per flush as a
  delta counter, or extract a numeric attribute as a gauge; substring +
  severity filters only - no user regex on the ingest hot path) and
  `log-to-trace` (logs already carrying full W3C trace context become
  spans; span ids are never synthesized). Sink-owning plugins feed the
  dispatcher through a buffered record tap; logstream connects its
  post-flush batches (best-effort and error-isolated - a deriver can never
  fail or slow ingest: the dispatch is detached from the flush cycle, and
  the tap passes records as a lazy thunk the dispatcher only materializes
  when a derive instance actually matches the stream, so streams without
  derive sources pay zero conversion cost). The dispatcher's pod-local
  source cache is generation-guarded so an invalidation during an
  in-flight rebuild can never wedge a pod on a stale derive set, and
  `log-to-metric` caps distinct label tuples per batch (100) so a
  high-cardinality attribute path cannot mint unbounded series. The
  source editor gets bespoke config forms with a proper input-stream
  picker.
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

- 6c8b36b: Push ingestion becomes a first-class telemetry PUSH source mode: a stream's
  OTLP/native push access is now a "Push (OTLP / native)" source instance on
  the stream's Sources tab - one instance per token, created with the token
  shown once, rotatable from the source row, revoked by disabling or deleting
  the instance, with "last received" liveness on the list. The seam is a
  generic platform surface any plugin can adopt for its own inbound endpoint:
  declare `push: { tokenPrefix, endpoints }` on the source type, and verify
  presented bearers with `createPushTokenLookup` (scoped to the source type -
  a token minted for one push type never authenticates another) composed with
  the shared ingest authenticator; cache convergence rides the new
  `telemetry.push-token.invalidated` cross-pod hook, which also fixes
  tracestream's previous mint-vs-negative-cache race.

  EXISTING SHIPPER TOKENS KEEP WORKING: every non-revoked stream token is
  promoted in place to a push source instance (same id, same sha256 hash,
  same `ckls_`/`ckms_`/`cktr_` prefixes), so nothing needs re-minting. A
  one-shot grant backfill mirrors each bound stream's team relations (and
  public visibility) onto the promoted instances, so team-scoped users who
  managed a stream's tokens keep managing its migrated push and scrape
  sources.

  Lifecycle correctness that shipped with the review round: deleting a
  stream now CASCADES through the platform (`handleStreamDeleted`) - bound
  sources lose that binding, sources left binding-less are fully deleted
  (secrets, schedule, team grants, push token revoked), so a deleted
  stream's shippers get 401s instead of black-holing data; a push
  instance's cached ingest verdict is evicted cluster-wide on any binding
  change, not only on disable/rotate.

  BREAKING CHANGES (platform is BETA): the per-plugin token CRUD procedures
  (`listTokens`/`mintToken`/`revokeToken`), their schemas, and the bespoke
  token UI (TokensSection, MintTokenDialog, PushEndpointsCard, ship-snippet
  components) are REMOVED from logstream, metricstream, and tracestream -
  manage push access as telemetry sources instead. The legacy
  `log_stream_tokens`/`metric_stream_tokens`/`trace_stream_tokens` tables are
  DROPPED (safe: plugin migrations run in dependency order, so the platform's
  promotion always precedes the owner's drop). All three stream detail pages
  now have a dedicated Sources tab.

- 6c8b36b: Add the multi-signal binding editor and a global Sources management page.

  - The telemetry sink contract gains an optional `listBindableStreams({ user })`
    method: the owning plugin lists its streams and FILTERS them to the ones the
    caller may manage, so the binding editor only offers streams a bind will
    accept. logstream and metricstream implement it through the shared
    `createStreamBindAuthorizer` factory (service bypass, global rule, then a
    per-resource team-grant filter via `auth.listAccessibleObjectIds`), keeping
    the authorization rule in one place. A sink without the method yields an empty
    picker, so adoption is incremental.
  - The frontend add/edit dialogs route each emitted signal through a per-signal
    stream picker: at most one stream per signal, at least one binding overall, a
    signal may be left unrouted, and a bound-but-no-longer-listable stream stays
    visible as a synthetic option. The single-signal fast path (opened from a
    stream section) collapses to the embedding-stream preset with no extra
    interaction.
  - A new global Sources page (Reliability nav group) lists every source instance
    the caller may read with per-row enable/edit/rotate/delete gating, and "Add
    source" opens the full catalog with no preset binding.

- 6c8b36b: Introduce the telemetry platform: a signal-agnostic source/sink abstraction for
  pluggable telemetry ingestion.

  - `telemetry-common`: the signal model (`logs`/`metrics`/`traces`), OTel-shaped
    normalized record schemas (the lingua franca between sources and sinks),
    source instance + source type descriptor schemas, the team-scopable
    `telemetry.source` access pair, the oRPC contract (source CRUD, source-type
    catalog, webhook secret rotation, config dry-run testing), the
    `TELEMETRY_SOURCE_CHANGED` signal and the `SourceConfigSlot`.
  - `telemetry-backend`: `telemetrySourceExtensionPoint` (any plugin contributes
    pull-, webhook- or listener-mode source types) and
    `telemetrySinkExtensionPoint` (the plugin owning a signal's streams
    contributes one sink per signal and the bind-time authorization for its
    streams), source instance storage with encrypted-at-rest secret config
    fields (boot-time validation of secret field shapes), the pull reconciler,
    the per-pod listener lifecycle manager with cross-pod convergence,
    per-instance webhook endpoints with hash-only secrets and rate limiting,
    an SSRF-guarded fetch for source implementations, and the `telemetry-pull`
    satellite capability (edge execution of satellite-bound pull instances with
    just-in-time secret resolution and binding-authorized re-ingestion).
  - `telemetry-frontend`: the `StreamSourcesSection` embed (source catalog,
    schema-driven config dialogs with keep-existing secret semantics, webhook
    secret shown once, connection testing) that stream frontends mount on their
    settings/sources surfaces. The section self-hides while no source types are
    installed for the signal.

### Patch Changes

- 6c8b36b: Add `reconcileRecurringJobs`, a shared convergence helper for recurring queue
  jobs. It (re-)schedules a desired set of jobs by stable jobId and cancels every
  existing recurring job the caller owns (`ownsJobId`) that is no longer desired,
  running schedules and cancels concurrently. The metricstream Prometheus scrape
  scheduler and the telemetry pull reconciler now both use it instead of
  hand-rolling the same list/schedule/cancel dance, with identical behaviour.
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
  - @checkstack/auth-common@0.15.0
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/backend-api@0.34.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/ingest-utils@0.2.0
  - @checkstack/common@0.23.0
  - @checkstack/satellite-backend@0.9.3
  - @checkstack/secrets-backend@0.3.8
  - @checkstack/satellite-common@0.10.1
  - @checkstack/cache-api@0.3.20
  - @checkstack/secrets-common@0.3.3
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1
