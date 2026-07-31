# @checkstack/telemetry-common

## 0.2.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/frontend-api@0.19.0

## 0.2.0

### Minor Changes

- 1deaac5: Split telemetry "Test connection" so its authorization is contract-declared

  `testSourceConfig` used to accept an optional `sourceId` (to reuse an existing
  source's stored secrets) and verified MANAGE on that source with a hand-rolled
  check in the handler - the one telemetry endpoint whose authorization was not
  declared on the contract. It is now split into two procedures, each fully
  declared:

  - `testSourceConfig` - the fresh-editor dry run (no stored secrets), `typeScoped`
    at manage level, as before but with `sourceId` removed from its input.
  - `testExistingSource` - the secret-reuse dry run, `sourceId` required and
    authorized by the `idParam` instanceAccess mode (MANAGE on that source),
    enforced by the middleware. The hand-rolled `assertCanManageSource` handler
    check is deleted.

  The "Test connection" button calls whichever procedure fits (it has a `sourceId`
  or not), so the UI is unchanged.

  BREAKING CHANGE: `testSourceConfig` no longer accepts a `sourceId` - callers that
  reused stored secrets by passing one must call the new `testExistingSource`
  instead. Authorization behaviour is unchanged (still MANAGE on the referenced
  source), only the endpoint split.

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/signal-common@0.3.2

## 0.1.1

### Patch Changes

- Updated dependencies [be74b01]
  - @checkstack/frontend-api@0.17.0

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

- 6c8b36b: Explicit stream-to-system links and AI tool projections for all three
  observability streams:

  - Every stream plugin declares the same four link procedures over its own
    junction table (shared schemas in `@checkstack/telemetry-common`):
    list/replace a stream's linked systems - the write verifies the caller
    can READ every NEWLY ADDED system (one user-scoped catalog `getSystems`
    membership pass before anything persists; retained or removed links need
    no readability, so a manager is never dead-locked by a link a
    broader-privileged user authorized) - plus two read-filtered reverse
    lookups powering the catalog system page and the dashboard (chunked
    client-side, so deployments beyond the 500-system lookup cap keep their
    signals).
  - catalog-frontend ships the shared `StreamSystemLinksEditor`: a
    controlled system picker with "suggested from observed service names"
    chips that a human explicitly applies - suggestions are never
    auto-linked. Suggestion sources: tracestream's service catalog,
    metricstream label values, and logstream's new bounded
    `listServiceNames` scan.
  - The catalog system page gains self-hiding Logs/Metrics/Traces cards
    (SystemDetailsSlot) and the dashboard gains conservative per-stream
    signals (SystemSignalsSlot, one bulk query per plugin).
  - AI tool projections: logstream (`searchLogs` slimmed, `severityStats`,
    `listStreams`), metricstream (`listStreams`, `listMetricNames`,
    `metricBuckets` - the unbounded raw-series read is deliberately not
    projected), tracestream (`searchTraces`, `getTraceSummary` with spans
    reduced to seven scalar fields, `serviceStats`, `listServices`). All
    read-only, RLAC-enforced by routed re-entry as the caller.

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

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1
