# @checkstack/satellite-common

## 0.10.1

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/common@0.23.0
  - @checkstack/signal-common@0.3.1

## 0.10.0

### Minor Changes

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
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0

## 0.9.6

### Patch Changes

- @checkstack/healthcheck-common@1.16.2

## 0.9.5

### Patch Changes

- @checkstack/healthcheck-common@1.16.1

## 0.9.4

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/healthcheck-common@1.16.0

## 0.9.3

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/signal-common@0.2.17

## 0.9.2

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
  - @checkstack/healthcheck-common@1.14.0

## 0.9.1

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/signal-common@0.2.16

## 0.9.0

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
  - @checkstack/signal-common@0.2.15

## 0.8.14

### Patch Changes

- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0

## 0.8.13

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
  - @checkstack/signal-common@0.2.14

## 0.8.12

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/signal-common@0.2.13

## 0.8.11

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/common@0.17.0

## 0.8.10

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/signal-common@0.2.11

## 0.8.9

### Patch Changes

- @checkstack/healthcheck-common@1.7.1

## 0.8.8

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/common@0.16.0
  - @checkstack/signal-common@0.2.10

## 0.8.7

### Patch Changes

- @checkstack/healthcheck-common@1.6.2

## 0.8.6

### Patch Changes

- @checkstack/healthcheck-common@1.6.1

## 0.8.5

### Patch Changes

- Updated dependencies [0b6f01b]
  - @checkstack/healthcheck-common@1.6.0

## 0.8.4

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
  - @checkstack/common@0.15.0
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/signal-common@0.2.9

## 0.8.3

### Patch Changes

- @checkstack/common@0.14.1
- @checkstack/healthcheck-common@1.5.3
- @checkstack/signal-common@0.2.8

## 0.8.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/signal-common@0.2.8

## 0.8.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/signal-common@0.2.7

## 0.8.0

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
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/common@0.13.0
  - @checkstack/signal-common@0.2.6

## 0.7.0

### Minor Changes

- 270ef29: Extend the satellite protocol for script-package distribution: the
  `authenticated` / `config_updated` payloads now carry an optional
  `scriptPackagesLockfileHash` (the durable convergence backstop), a new
  `refresh_script_packages { lockfileHash }` core->satellite control push,
  and a new `script_package_sync_state` satellite->core report message. All
  additions are optional / additive, so existing satellites and protocol
  tests are unaffected.
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
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/healthcheck-common@1.4.0

## 0.6.0

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
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/signal-common@0.2.5

## 0.5.3

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0

## 0.5.2

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-common@0.2.4

## 0.5.1

### Patch Changes

- @checkstack/healthcheck-common@1.1.1

## 0.5.0

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
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/signal-common@0.2.3

## 0.4.0

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
  - @checkstack/common@0.9.0
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 0.3.2

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 0.3.1

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0

## 0.3.0

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
  - @checkstack/healthcheck-common@0.13.0

## 0.2.1

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/signal-common@0.1.10

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
