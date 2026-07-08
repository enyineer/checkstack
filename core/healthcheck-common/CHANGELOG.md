# @checkstack/healthcheck-common

## 1.15.0

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

- f93ee7a: Fix a class of 403s where team-scoped managers were blocked from endpoints they
  needed. A repo-wide audit of every `instanceAccess: { global: true }` procedure
  found more instances of the same bug behind the health-check editor fix: an
  endpoint on a team-scopable resource type, gated so only the GLOBAL access rule
  (never a team grant) authorizes it.

  Automation: the editor utilities and catalogs (`validateDefinition`,
  `listTriggers`, `listActions`, `listArtifactTypes`, `listAutomationGroups`,
  `listAutomationTemplates`, `renderTemplate`, `testScript`) now use `typeScoped`
  so a team-scoped automation manager can author without the global rule. The run
  endpoints (`listRuns`, `getRun`, `cancelRun`, `getRunScopeForReplay`) are scoped
  to their parent automation via `parentScope` on `automationId`; `getRun`,
  `cancelRun`, and `getRunScopeForReplay` now take the owning `automationId`
  (always available in the run URL/editor) and the handler filters the run fetch by
  it, so a run id cannot be paired with a foreign automation the caller happens to
  hold a grant on. The two migration-admin endpoints stay `global: true` (genuine
  platform-admin actions).

  Health check: `validateConfiguration` (editor deep-validate) and
  `getPlatformNotificationDefaults` (fetched on every assignment-editor mount) move
  to `typeScoped`. The paired WRITE `setPlatformNotificationDefaults` stays
  `global: true` on purpose - it rewrites instance-wide defaults for every team, so
  a single team grant must not authorize it. Because that write stays global-only,
  the assignment editor's "Notification defaults" button is now gated on the global
  `configuration.manage` rule (`healthcheck-frontend`), so a team-scoped manager no
  longer sees an editor whose Save always 403'd.

  Anomaly: the anomaly settings panels embedded in the health-check editor
  (`updateAnomalyConfig` / `getAnomalyConfig` and `updateAnomalyAssignmentConfig` /
  `getAnomalyAssignmentConfig`) were authorized against the non-team-scopable
  `anomaly_feed` type (via `global: true` or an `idParam` that could never match a
  team grant), so a team-scoped manager who owns the check/system saw "Save
  Defaults" / "Save Exceptions" buttons whose Save always 403'd. They now
  `parentScope` on the owning health-check configuration (`healthcheck.healthcheck`)
  and catalog system (`catalog.system`) respectively, so managing the check/system
  authorizes reading and editing its anomaly settings. The frontend needed no
  change: those buttons were already disabled for non-managers, and the panels are
  only reachable inside the manager-gated editor. Also, the automation "New
  automation" template picker (`automation-frontend`) gated its page on the bare
  global manage rule; it now uses the create capability, so a team-scoped creator
  (whom the route already reveals the page to) is no longer shown a blocked page.

  Incident & maintenance: `removeLink` was `global: true` because its input carried
  only the link id. It now takes the owning `incidentId` / `maintenanceId`
  (mirroring `addLink`), authorizes per-instance via `idParam`, and the service
  scopes the delete by that parent id so a link cannot be removed by pairing its id
  with a different incident/maintenance the caller manages. The AI `removeLink`
  tools carry the parent id too.

  BREAKING CHANGES: `automation.getRun`, `automation.cancelRun`,
  `automation.getRunScopeForReplay`, `incident.removeLink`, and
  `maintenance.removeLink` now require a parent id (`automationId` /
  `incidentId` / `maintenanceId`) in their input. Endpoints previously gated by a
  global rule alone now also accept the owning team's grant; no endpoint became
  more permissive for a user who lacks both the global rule and a relevant team
  grant.

  Not team-scopable, so intentionally left `global: true` (verified by the audit):
  catalog environments, anomaly config, SLO list/streak/milestone reads and
  health-check history/stats (their read rules are public/default), and every
  hand-rolled HTTP route (global admin/infra or already team-aware).

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

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/notification-common@1.5.3
  - @checkstack/secrets-common@0.3.2
  - @checkstack/signal-common@0.2.17

## 1.14.0

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

## 1.13.0

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
  - @checkstack/common@0.21.0
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/secrets-common@0.3.1
  - @checkstack/signal-common@0.2.16

## 1.12.0

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
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/catalog-common@2.6.1
  - @checkstack/frontend-api@0.13.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/signal-common@0.2.15

## 1.11.0

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

## 1.10.0

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
- 0d912a3: Make the frontend fully RLAC-aware so team-scoped users see and can use exactly
  what the backend already authorises - no more, no less. Previously every nav
  entry, route, management page, create button, per-row action, and resource
  picker gated purely on a user's GLOBAL access rule, so a user whose team manages
  a system saw none of the surfaces the backend would happily let them use, and
  (where a page did render) could select systems they don't manage and only fail
  after submit.

  Platform primitives (on `AccessApi`, from `@checkstack/frontend-api`, implemented
  in `@checkstack/auth-frontend`). Each ORs the global RBAC rule with team-derived
  (ReBAC) grants, so a global-rule holder always sees everything:

  - `useCanCreate({ accessRule, objectType, parentType? })` - may the user create
    this type (global rule, a team `creator` grant, or managing a parent resource).
  - `useCanAccessType({ accessRule, objectType, parentType? })` - may the user
    reach a management SURFACE for this type at all (create capability OR managing
    any existing object of the type / its parent). Powers route guards, sidebar
    entries, and a management page's top-level `allowed`.
  - `useResourceAccess({ accessRule, objectType, resourceIds })` - a `canAccess(id)`
    predicate for per-row controls and for filtering resource pickers.

  Backed by three authenticated `auth` RPC procedures - `canCreate`,
  `myManageableTypes`, and `listMyAccessibleResources` - the frontend-facing
  mirrors of the existing S2S authorization endpoints, resolved against the
  caller's own team grants.

  Route/nav gating is now capability-aware: a route may declare
  `manageCapability: { objectType, parentType? }`; the route guard and sidebar then
  show/allow it for team-scoped users via `myManageableTypes`. Applied to the
  catalog, incident, maintenance, SLO, healthcheck, automation, and status-page
  management routes. The route guard resolves this through a single
  `useRouteAccess` hook with a constant hook count, since the guard is reconciled
  in place as the URL changes (a conditional hook there would trip the rules of
  hooks).

  Resource types are now typed, plugin-qualified constants. A new
  `resourceType(pluginMetadata, localType)` factory in `@checkstack/common` mints a
  nominal `ResourceType`, and each `*-common` package exports its constants (e.g.
  `catalogResourceTypes.system`, `incidentResourceTypes.incident`). The capability
  APIs accept `ResourceType`, so a mistyped `"catalog.system"` string now fails
  typecheck instead of silently breaking a gate.

  Resource pickers now offer only what the backend will accept:

  - Incident and maintenance "Affected Systems" pickers show only systems the user
    manages (or all with the global rule), matching the backend's requirement of
    MANAGE on every referenced system.
  - SLO creation is now system-scoped end to end: `createObjective` gains a
    `catalog.system` parent gate (managing the target system authorises creating an
    SLO for it, like incident/maintenance), and the SLO editor's system picker is
    filtered to manageable systems.
  - Catalog group and environment membership (add-to-group / add-to-environment,
    per-row and bulk) is gated on managing the system being (re)assigned.
  - The health-check assignment surface (Assignment IDE + the system-detail
    "Health Checks" action) requires MANAGE on the target system.

  Catalog membership chips only render a removable "x" for systems the user
  manages (removing a group/environment membership requires managing the system),
  and the Dependency Map only lets a user originate an edge from a system they
  manage (the source is access-checked; the target is not).

  Owning-team correctness: a parent-gated creator (team member, no global rule)
  who left the owning team unset previously created an object with no team grant -
  which they then could not edit. The `authorizeCreate` parent-gate path now
  resolves an owning team instead of silently orphaning the object (auto-assigns
  when the caller belongs to exactly one team, requires an explicit choice when
  several), and the `TeamOwnershipPicker` marks the field required and
  auto-selects the sole eligible team.

  Dependency writes are fixed to authorize on the SOURCE system. `createDependency`
  / `updateDependency` / `deleteDependency` previously used `instanceAccess:
{ idParam: "systemId" }`, which made the middleware look for a `dependency` grant
  keyed by the system id - a grant that never exists - so every team-scoped source
  manager was denied ("Access denied to resource dependency:<systemId>"). They now
  `parentScope` on `catalog.system` manage, so managing the source system
  authorises editing its dependencies (the target is not access-checked), matching
  health-check assignment.

  The backend authorization changes are limited to: the new read-only capability
  procedures (`canCreate` / `myManageableTypes` / `listMyAccessibleResources`), the
  SLO create parent gate, the `authorizeCreate` owning-team resolution, and the
  dependency source-scope fix. Everything else only aligns the UI with
  authorization the backend already enforced.

### Patch Changes

- Updated dependencies [d1b71b6]
- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [53666a7]
- Updated dependencies [0d912a3]
  - @checkstack/notification-common@1.5.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/signal-common@0.2.14

## 1.9.0

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
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/frontend-api@0.12.1
  - @checkstack/notification-common@1.4.2
  - @checkstack/signal-common@0.2.13

## 1.8.1

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/common@0.17.0

## 1.8.0

### Minor Changes

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
  - @checkstack/notification-common@1.4.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/catalog-common@2.4.2
  - @checkstack/signal-common@0.2.11

## 1.7.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/catalog-common@2.4.1

## 1.7.0

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

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/frontend-api@0.10.0
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-common@0.2.10

## 1.6.2

### Patch Changes

- @checkstack/catalog-common@2.3.6

## 1.6.1

### Patch Changes

- @checkstack/catalog-common@2.3.5

## 1.6.0

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

## 1.5.4

### Patch Changes

- 56e7c75: Fix frontend access checks to use FULLY-QUALIFIED access-rule ids, and resolve
  the anonymous role on the frontend.

  Granted access-rule ids are stored fully-qualified as `{pluginId}.{ruleId}` (e.g.
  `incident.incident.read`) so two plugins defining the same short rule id never
  collide. The frontend, however, was checking the UNqualified id (`incident.read`)
  via `isAccessRuleSatisfied`, so every check failed for any user without the `*`
  (admin) grant - masked in development because dev-auth grants `*`. This silently
  broke ALL non-admin frontend gating (route guards, sidebar entries, and
  `useAccess`-based button/link gating).

  - **`@checkstack/common`**: `AccessRule` now carries a REQUIRED owning `pluginId`;
    `access()` / `accessPair()` require and stamp it; `isAccessRuleSatisfied`
    qualifies the rule (`{pluginId}.{id}`, plus the manage->read escalation) and
    matches ONLY the qualified form. There is intentionally NO unqualified fallback
    - matching a bare id would let one plugin's grant satisfy another plugin's
      identically-named rule (a cross-plugin privilege-escalation flaw). Every plugin
      that defines access rules now passes its own `pluginId`.
  - **`@checkstack/backend`**: `pluginManager.getAllAccessRules()` no longer strips
    the `pluginId` field (the rule `id` is already fully-qualified for the DB sync).
  - **Route guard** (`@checkstack/frontend` / `@checkstack/frontend-api`) now
    checks the FULL rule object (so it qualifies and escalates), not a bare id.
  - **Anonymous role on the frontend**: the `accessRules` procedure is now
    `public`, returning the configurable anonymous role's grants to unauthenticated
    callers; `useAccessRules` fetches them for guests instead of returning an empty
    set. So anonymous UI now reflects exactly what the anonymous role is allowed -
    which an admin can change (`isPublic` is only the seeded default).
  - Incident / maintenance / SLO detail routes are now read-gated (their read rule
    is an `isPublic` default, so the anonymous role holds it unless an admin
    revokes it); their dashboard status signals carry that rule and render as a
    link only when the viewer may open it.

  **BREAKING (`@checkstack/common`):** `AccessRule.pluginId` is now REQUIRED, and
  `access()` / `accessPair()` require a `pluginId` option. `isAccessRuleSatisfied`
  matches ONLY the fully-qualified `{pluginId}.{ruleId}` form - the previous
  unqualified fallback is removed, because it was a cross-plugin
  privilege-escalation flaw. Any code constructing an `AccessRule` or calling
  `access()`/`accessPair()` must supply the owning `pluginId`.

  Verified live against an anonymous caller: read pages resolve (qualified match),
  manage actions are denied, manage->read escalation and `*` still work.

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/catalog-common@2.3.4
  - @checkstack/common@0.15.0
  - @checkstack/notification-common@1.3.3
  - @checkstack/signal-common@0.2.9

## 1.5.3

### Patch Changes

- @checkstack/catalog-common@2.3.3
- @checkstack/common@0.14.1
- @checkstack/notification-common@1.3.2
- @checkstack/signal-common@0.2.8

## 1.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/catalog-common@2.3.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/signal-common@0.2.7

## 1.5.0

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

- 9dcc848: Add a deep `validateConfiguration` RPC to the health-check plugin so propose-time validation matches apply-time validation.

  - `validateConfiguration` (`@checkstack/healthcheck-common`): a new mutation procedure gated by `healthcheck.healthcheck.manage`, taking a proposed configuration (reusing the create skeleton) and returning `{ valid, errors: [{ path, message }] }`, mirroring automation's `validateDefinition`. It persists nothing.
  - Shared deep validation (`@checkstack/healthcheck-backend`): `collectConfigurationIssues` resolves strategy + collectors by fully-qualified id then migrate-then-validate-strict each config via `parseStrictAssumingV1`. The GitOps reconcile path is refactored to call the same `validateVersionedConfigStrict`, so create / gitops-apply / the new RPC share one implementation.
  - `healthcheck.propose`'s dry-run (`@checkstack/ai-backend`) now calls `validateConfiguration` as its validation authority, so a wrong config type or a typo'd key surfaces at propose time, bringing it to the same deep-validate level `automation.propose` already has.

  State and scale: no durable state; `validateConfiguration` is a pure read against the in-process registries plus zod validation, identical on every pod.

  This is a beta minor.

### Patch Changes

- 9dcc848: Input-validation and error-mapping hardening found by a fuzzing pass against the built container.

  - backend: a Postgres driver error caused by bad client input no longer surfaces as a `500`. The `/api` and `/rest` dispatchers now map the relevant SQLSTATE classes to the correct status - `22P02`/`22003`/`22001`/`22007` (malformed/out-of-range/over-long/bad-date value), `23502`/`23503`/`23514` (missing/dangling/check-failed) to `400`, and `23505` (unique violation) to `409` - and log them at `warn` (client mistake), not `error`. The client-facing message is generic so column/constraint names are never leaked; genuine unknown faults still log at `error` and 500. Previously a `where id = $1` with a non-uuid `$1` (or an over-long string, or a foreign-key miss in `addSystemToGroup`) reached the driver and 500'd, making routine probing look like a server outage and burying real 500s.
  - slo-common: **fixes a stored cluster-wide DoS.** `windowDays` was accepted up to `2^53`, but the SLO engine derives window boundaries with `Date(now - windowDays * 86_400_000)` - a large value overflows past the max representable `Date` and yields `Invalid Date`. That objective committed fine, then every subsequent read of the system's objectives threw `RangeError: Invalid time value` during serialization (a 500 readable by anyone with SLO read access, on any pod). `windowDays` is now bounded to 1..3650 days at the contract, the GitOps `kind: SLO` spec, and the update path via a single shared `SloWindowDaysSchema`, so the poison row can never be created.
  - slo-common + healthcheck-common: SLO `getDailySnapshots` and the healthcheck history endpoints (`getHistory`, `getDetailedHistory`, `getAggregatedHistory`, `getDetailedAggregatedHistory`, `getRunsForAnalysis`) declared their `startDate`/`endDate` params as `z.date()`, which a `/rest/...` string param can never satisfy - so those endpoints 400'd on the entire REST surface. They now use `z.coerce.date()`, accepting both the REST string shape and the native RPC `Date`.
  - healthcheck-common: `intervalSeconds` was `z.number().min(1)` with no `.int()` and no upper bound, so a fractional or out-of-range value reached the DB and failed at insert (the column is a 32-bit int). It is now `.int().min(1).max(2_592_000)` (1 second .. 30 days), applied to both create and update (the update schema is the create partial).
  - catalog-common: system/group/environment names were bare `z.string()` (environment was `.min(1)` only), so empty, whitespace-only, and 100KB+ names reached the DB - the huge ones surfaced as 500s when parameter binding blew up. Names are now `trim().min(1).max(200)` via a shared schema.

    **BREAKING:** `getSystemContacts` is now `userType: "authenticated"` (was `"public"`). System contacts carry PII (user id, name, email); the public read leaked them to anonymous status-page visitors. Anonymous callers now receive `401` for this one endpoint; the system detail page already renders "No contacts assigned" for anonymous viewers, so the UI degrades gracefully. All other catalog reads remain public.

  - catalog-frontend: the system detail page skips the `getSystemContacts` request entirely for anonymous viewers (it would now `401`) and falls back to the empty state.

  This is a beta release: the breaking contact-visibility change ships as a minor bump per the beta versioning policy, not a major.

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
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/signal-common@0.2.6

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

- b995afb: Move health-check flapping configuration from the per-assignment notification policy onto the `healthcheck.flapping_detected` automation trigger.

  Flapping thresholds (`transitions`, `windowMinutes`) are now configured on the trigger itself, next to the automation that reacts to them, instead of on each check assignment. The health-check executor still owns the windowed transition counting (it writes `health_check_unhealthy_transitions` and runs the window query), but it now SOURCES the thresholds from the subscribed automations' trigger config:

  - On a transition-to-unhealthy it records the transition unconditionally (keeping history warm), then looks up the enabled automations subscribed to `healthcheck.flapping_detected`, collects the distinct set of configured windows, counts transitions once per distinct window, and emits one `healthcheck.flapping_detected` per window. The trigger's exact-window `evaluateConfig` gate then fires each automation only for its own window and transition threshold.
  - A missing or partial flapping trigger config defaults to `{ transitions: 3, windowMinutes: 60 }`, so automations created before the trigger carried config keep working unchanged.
  - `automation-backend` exposes a new backend-only, read-only `automationSubscriptionsRef` service ref (`findEnabledByTriggerEvent`) so a plugin that owns a trigger's underlying event can discover its subscribers' trigger config. It is never browser-exposed.

  **BREAKING CHANGES**

  - The per-assignment `notificationPolicy.flappingTrigger` field is removed. `NotificationPolicy` is now `{ suppressDeEscalations }` only. Stored rows that still carry a `flappingTrigger` key parse cleanly - the key is stripped on read - so no data migration is required, but the per-check flapping toggle/threshold in the assignment Notifications tab is gone; configure flapping on the trigger instead.
  - The GitOps `System.healthcheck[].notificationPolicy.flappingTrigger` field is removed. A `flappingTrigger` block in a manifest is ignored. Move the thresholds to the `transitions` / `windowMinutes` config of your `healthcheck.flapping_detected` automation trigger.
  - The standalone `enabled` flag for flapping is gone: flapping is "enabled" precisely when at least one enabled automation subscribes to `healthcheck.flapping_detected`. With no subscriber, the transition is still recorded but nothing is counted or emitted.

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

## 1.3.0

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
  - @checkstack/common@0.12.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5

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

## 1.1.2

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/notification-common@1.2.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/signal-common@0.2.4

## 1.1.1

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/catalog-common@2.2.1

## 1.1.0

### Minor Changes

- 9016526: Add a `/rest/:pluginId/*` HTTP mount that serves every plugin's oRPC contract
  through the REST/OpenAPI shape described by `/api/openapi.json`. Queries are
  `GET` with query parameters, mutations are `POST` with the input as the raw
  JSON body. The existing `/api/:pluginId/*` mount continues to serve oRPC's
  native wire protocol unchanged, so existing clients are not affected.

  The OpenAPI spec at `/api/openapi.json` now reflects the real mount: every
  `paths` entry is prefixed with `/rest` instead of `/api`.

  Also fixes a SPA-fallback bug: the backend's `/api-docs` route previously
  returned 404 on production deployments because the static-file middleware
  skipped any path starting with `/api`, capturing `/api-docs` along with real
  API routes. The skip now requires a trailing slash (`/api/`, `/rest/`).

  Required access rules are now visible in the API Docs UI. The OpenAPI spec
  generator was reading a non-existent `accessRules` field on procedure
  metadata; the real field is `access: AccessRule[]`. Each procedure's access
  rules are now flattened to fully-qualified IDs (e.g. `catalog.system.read`)
  and emitted under `x-orpc-meta.accessRules`, which the existing
  `Required Access Rules` section in the docs UI already knew how to render.

  The API Docs schema renderer now handles record types (zod `z.record`),
  `$ref`s into `components.schemas`, `oneOf`/`anyOf`/`allOf`, nullable union
  types (`type: ["string", "null"]`), and `format` qualifiers. Previously
  record outputs like `{ statuses: object }` masked the actual value type;
  they now render as `{ [key]: <ResolvedType> { ... } }` with the inner
  schema expanded, capped at 12 levels with cycle detection.

  **REST method conventions.** `proc()` now defaults to `GET` for queries and
  `POST` for mutations on the `/rest` mount, using bracket-notation query
  params (`?filter[status]=active&ids[0]=a`) for GET inputs. Existing
  procedures were updated to follow REST semantics:

  - `update*` mutations → `PATCH`
  - `delete*` / `remove*` mutations → `DELETE`
  - `getBulk*` queries and any query taking a large array input → `POST`
    (because `@orpc/openapi@1.13.x` has no GET→POST URL-length fallback)

  GET endpoints require an `object` input — bare scalars like
  `.input(z.string())` are not valid on GET. `getSystemConfigurations` was
  refactored from `.input(z.string())` to `.input(z.object({ systemId: ... }))`
  to fit the GET shape; the only call-site update was the in-process router
  unpacking `input.systemId` instead of passing `input` directly.

  The API Docs UI now renders query parameters (path/query/header/cookie) in a
  dedicated table for GET endpoints, and the fetch example shows them in the
  URL with `<required>` / `<optional>` placeholders.

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/signal-common@0.2.3

## 1.0.2

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [1ef2e79]
  - @checkstack/common@0.9.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 1.0.1

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

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

### Minor Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-common@2.0.0

## 0.13.0

### Minor Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0

## 0.12.0

### Minor Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/signal-common@0.1.10

## 0.11.0

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

## 0.10.1

### Patch Changes

- 3c34b07: Complete SLO Reliability Engine frontend and backend

  **Frontend** — 7 new visualization components:

  - `StreakCounter`: Fire-themed compliance streak counter with color-coded flame and best-streak trophy
  - `AchievementBadge`: Emoji-labeled badges for 9 achievement types with hover tooltip
  - `AttributionChart`: Horizontal stacked bar showing error budget split (self/upstream/remaining)
  - `DowntimeTimeline`: Dot-and-line timeline with attribution badges and timestamps
  - `SloTrendChart`: Pure SVG availability trend line chart from daily snapshots
  - `MilestoneFeed`: Organization-wide milestone feed on the SLO overview sidebar
  - `DependencyExclusionConfig`: Interactive upstream dependency picker for SLO editor

  **Backend** — Weekly digest scheduled integration event:

  - `weekly-digest.ts`: Cron job (Monday 09:00 UTC) emitting SLO performance summary
  - Top/worst performers, breach counts, and streak data delivered via configured notification channels
  - New `sloWeeklyDigest` hook registered as integration event

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/signal-common@0.1.9

## 0.10.0

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

## 0.9.0

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

## 0.8.4

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4
  - @checkstack/signal-common@0.1.8

## 0.8.3

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3
  - @checkstack/signal-common@0.1.7

## 0.8.2

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2
  - @checkstack/signal-common@0.1.6

## 0.8.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/signal-common@0.1.5

## 0.8.0

### Minor Changes

- d6f7449: Add availability statistics display to HealthCheckSystemOverview

  - New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
  - Availability is calculated as `(healthyRuns / totalRuns) * 100`
  - Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
  - Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
  - Shows total run counts for each period

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

## 0.6.0

### Minor Changes

- 11d2679: Add ability to pause health check configurations globally. When paused, health checks continue to be scheduled but execution is skipped for all systems using that configuration. Users with manage access can pause/resume from the Health Checks config page.

## 0.5.0

### Minor Changes

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

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/signal-common@0.1.4

## 0.4.2

### Patch Changes

- 8a87cd4: Updated access rules to use new `accessPair` interface

  Migrated to the new `accessPair` interface with per-level options objects for cleaner access rule definitions.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/signal-common@0.1.3

## 0.4.1

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/signal-common@0.1.2

## 0.4.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/signal-common@0.1.1

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

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
  - @checkstack/signal-common@0.1.0

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

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0
  - @checkstack/signal-common@0.0.4

## 0.1.0

### Minor Changes

- f5b1f49: Extended health check system with per-collector assertion support.

  - Added `collectors` column to `healthCheckConfigurations` schema for storing collector configs
  - Updated queue-executor to run configured collectors and evaluate per-collector assertions
  - Added `CollectorAssertionSchema` to healthcheck-common for assertion validation
  - Results now stored with `metadata.collectors` containing per-collector result data

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

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
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

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.1

### Patch Changes

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0
  - @checkstack/signal-common@0.1.1

## 0.1.0

### Minor Changes

- 4dd644d: Enable external application (API key) access to management endpoints

  Changed `userType: "user"` to `userType: "authenticated"` for 52 endpoints across 5 packages, allowing external applications (service accounts with API keys) to call these endpoints programmatically while maintaining RBAC permission checks:

  - **incident-common**: createIncident, updateIncident, addUpdate, resolveIncident, deleteIncident
  - **maintenance-common**: createMaintenance, updateMaintenance, addUpdate, closeMaintenance, deleteMaintenance
  - **catalog-common**: System CRUD, Group CRUD, addSystemToGroup, removeSystemFromGroup
  - **healthcheck-common**: Configuration management, system associations, retention config, detailed history
  - **integration-common**: Subscription management, connection management, event discovery, delivery logs

  This enables automation use cases such as:

  - Creating incidents from external monitoring systems (Prometheus, Grafana)
  - Scheduling maintenances from CI/CD pipelines
  - Managing catalog systems from infrastructure-as-code tools
  - Configuring health checks from deployment scripts

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

- Updated dependencies [ffc28f6]
- Updated dependencies [b55fae6]
  - @checkstack/common@0.1.0
  - @checkstack/signal-common@0.1.0
