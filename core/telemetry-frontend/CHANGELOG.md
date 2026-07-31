# @checkstack/telemetry-frontend

## 0.2.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/auth-frontend@0.16.1
  - @checkstack/telemetry-common@0.2.1
  - @checkstack/satellite-common@0.12.1

## 0.2.0

### Minor Changes

- 56e5375: Migrate the frontend from react-router-dom v7 to react-router v8

  Resolves GHSA-qwww-vcr4-c8h2 (HIGH): React Router before 8.3.0 has an RSC-mode
  CSRF bypass that lets an action execute before the 400 response. Checkstack runs
  a client-side SPA (`<BrowserRouter>`) and does not use RSC mode, so the platform
  was not exploitable through it - but the advisory kept the dependency-graph
  security gate red on every pull request, and the fix is only available in the 8.x
  line, which the auto-remediation deliberately will not reach (it refuses major
  bumps).

  `react-router-dom` has no v8: it was folded into `react-router` in v7 and v8
  ships as `react-router` only. So this is a package swap rather than a range bump:

  - 31 packages now depend on `react-router@^8.3.0` instead of
    `react-router-dom@^7.16.0`, and 97 source files import from `react-router`.
  - The Module Federation host share, `optimizeDeps` and `dedupe` entries move to
    `react-router` (shared singleton `requiredVersion` `^8.0.0`). Remotes never
    shared the router, so the remote contract is unchanged.
  - The syncpack unified-range group tracks `react-router`, keeping the enforced
    single-range guarantee that a past four-range regression motivated.

  The API surface Checkstack uses is unchanged between v7 and v8 - `BrowserRouter`,
  `MemoryRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useLocation`,
  `useNavigate`, `useParams` and `useSearchParams` are all exported by v8 with the
  same signatures - so no routing code changed beyond the import specifier. v8
  requires React >= 19.2.7, which the workspace already pins.

### Patch Changes

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

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
  - @checkstack/auth-frontend@0.16.0
  - @checkstack/common@0.24.0
  - @checkstack/ui@1.31.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/satellite-common@0.12.0
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/signal-common@0.3.2

## 0.1.1

### Patch Changes

- be74b01: Stop anonymous page loads from logging authentication errors in the backend

  Opening the app unauthenticated printed an error-level stack trace per stream
  plugin:

  ```
  error: [core] RPC /api/metricstream/listLinkedStreamStatuses failed: Authentication required
  error: [core] Stack trace: Error: Authentication required ...
  ```

  Two independent causes, both fixed:

  - The dashboard is reachable anonymously (the catalog read is public, as are
    the health-check, incident, SLO and anomaly signal sources), but the three
    stream plugins' `listLinkedStreamStatuses` is authenticated-only. Their
    dashboard signal fillers queried it regardless of the caller, so every
    anonymous page load fired three requests that could only ever come back 401.
    The fillers now gate the lookup on the caller being authenticated.
  - A contract-level 4xx (401/403/404/409/...) was logged at error level with a
    full stack trace. That is the authorization layer working as designed, not a
    server fault, and the access-log middleware already reports every 4xx
    response at warn with its method, path and status. Contract 4xx responses now
    log at debug without a stack; a 5xx stays as loud as before.

  The three fillers were byte-for-byte the same component apart from their
  client, source id and deriver, so the fetch/chunk/merge/report machinery moved
  into a shared `useLinkedStreamSignals` hook exported by
  `@checkstack/telemetry-frontend`. As a side effect the tracestream filler's
  query is now namespaced under its plugin id like the other two, so the plugin's
  signal auto-invalidator actually refreshes it.

- Updated dependencies [be74b01]
- Updated dependencies [be5c907]
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
  - @checkstack/ui@1.30.0
  - @checkstack/auth-frontend@0.15.0
  - @checkstack/satellite-common@0.11.0
  - @checkstack/frontend-api@0.17.0
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

- 6c8b36b: Edit forms stay stable while you are typing. Previously, editing a system's
  description (and many other edit dialogs/settings pages) would reset the field
  mid-edit whenever a webhook update or realtime signal refetched the underlying
  query: the form re-seeded its local state from the fresh query result on every
  refetch. Forms now seed their local state ONCE - on the dialog's open
  transition, or once per record via a stable key - and ignore background
  refetches while you are editing.

  New shared primitive `useSeedFormOnOpen(open, onInit)` in `@checkstack/ui`
  (alongside the existing `useInitOnceForKey`) seeds a dialog form once per
  open transition, StrictMode-safe. Fixed surfaces include the catalog
  system/environment/group editors, the healthcheck platform-defaults dialog,
  the SLO / gitops-provider / telemetry-source / satellite / announcement /
  role edit dialogs, and the cache / queue / notification / secrets / anomaly /
  profile / strategies settings pages (query-seeded pages also drop their loader
  cache via `gcTime: 0` so a warm cache cannot race the one-shot seed).

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
  - @checkstack/ui@1.29.0
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/common@0.23.0
  - @checkstack/satellite-common@0.10.1
  - @checkstack/signal-common@0.3.1
