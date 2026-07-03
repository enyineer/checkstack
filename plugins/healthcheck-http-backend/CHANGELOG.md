# @checkstack/healthcheck-http-backend

## 0.7.0

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
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0

## 0.6.1

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0

## 0.6.0

### Minor Changes

- b4e0832: Add optional authentication to the HTTP health check strategy. A new
  **Authentication** picker (`none` / `basic` / `token`) on the strategy config
  sets the outbound `Authorization` header: `basic` sends
  `Basic <base64(username:password)>`, `token` sends `Bearer <token>`. Passwords
  and tokens are secret fields (encrypted at rest, redacted in the UI). A
  collector that sets its own `Authorization` header still takes precedence.
  Existing configs are unaffected (`authType` defaults to `none`; no
  schema-version bump required).

## 0.5.4

### Patch Changes

- Updated dependencies [0cac684]
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/backend-api@0.27.1

## 0.5.3

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0

## 0.5.2

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/backend-api@0.26.1

## 0.5.1

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/common@0.17.0

## 0.5.0

### Minor Changes

- 8cad340: Fix collectors hard-failing on successful-but-non-OK application results.

  A health-check collector must fail only when the TRANSPORT fails (the probe
  could not complete: DNS/connect/TLS failure, timeout, aborted, unspawnable
  process). A successfully-received result that is simply "not what you hoped" is
  an assertable metric, not a collector failure - the user's assertions (or the
  no-assertion default) decide health.

  BREAKING CHANGE: checks that previously relied on a collector auto-failing on a
  non-OK result will now report healthy unless an explicit assertion is added.
  Affected collectors:

  - HTTP request collector: a received response (including 4xx/5xx) is now a
    successful collection. `statusCode` / `statusText` / `success` are exposed as
    metrics; the collector no longer sets `error` on a non-2xx. Add a
    `statusCode equals 200` assertion to fail on non-200 (or `statusCode equals
404` for a check that wants a 404). Only a real transport failure fails the
    collector.
  - gRPC health collector: a completed health RPC returning `NOT_SERVING` /
    `SERVICE_UNKNOWN` / `UNKNOWN` is now a successful collection. `serving` /
    `status` are assertable metrics; only a real RPC transport error fails the
    collector.
  - Jenkins node-health collector: offline nodes are now an assertable metric
    (`offlineNodes`); a successful all-nodes API call no longer fails the
    collector when some nodes are offline.
  - Script (shell) execute collector: a non-zero exit code is now an assertable
    metric (`exitCode` / `success`); the collector no longer hard-fails on a
    non-zero exit. A timeout or a script that could not be spawned still fails the
    collector (those are transport failures). Add a `success is true` (or
    `exitCode equals 0`) assertion to fail on a non-zero exit.

  Other strategies (DNS, TCP, TLS, ping, ssh, mysql, postgres, redis, rcon,
  hardware, and the inline-script collector) were audited and already failed only
  on genuine transport failures.

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

- 8cad340: Retune anomaly-detection defaults across every health-check strategy and the
  hardware collector for a low-noise, problem-focused out-of-the-box experience.

  The detection engine already learns a per-metric baseline, debounces with a
  confirmation window, and applies practical-significance floors. This pass tunes
  the per-metric **defaults** so a fresh install alerts only on genuine,
  statistically-significant, problem-mapping deviations instead of flooding on
  every metric that wiggles. 264 metrics were reviewed:

  - **Default-disabled** the high-noise and un-baselineable classes that were
    alerting for no good reason: raw identifiers and counts (status codes, error
    and row counts, build counts, player and executor counts), config echoes and
    near-constants (probe packet counts, CPU core count, total/swap memory),
    payload-size and other run-to-run-volatile values, and deterministic values
    like certificate days-remaining (governed by the check's own static-threshold
    health logic, not statistics). These stay chartable and can be re-enabled per
    field.
  - **Hardened** the signals that should alert - latency/response/execution time
    and availability/success/saturation percentages - with confirmation windows
    and absolute + relative floors so brief spikes and sub-threshold jitter no
    longer flap, and prefer percentage metrics over their absolute twins.

  No detection-engine or schema changes; only per-metric `x-anomaly-*` defaults.
  Users who had opted into any now-disabled metric keep their explicit override.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0

## 0.4.11

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1

## 0.4.10

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/healthcheck-common@1.7.1

## 0.4.9

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0

## 0.4.8

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0
  - @checkstack/healthcheck-common@1.6.2

## 0.4.7

### Patch Changes

- @checkstack/healthcheck-common@1.6.1
- @checkstack/backend-api@0.21.7

## 0.4.6

### Patch Changes

- Updated dependencies [0b6f01b]
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/backend-api@0.21.6

## 0.4.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/healthcheck-common@1.5.4

## 0.4.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4

## 0.4.3

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/healthcheck-common@1.5.3

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/healthcheck-common@1.5.2

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/healthcheck-common@1.5.1

## 0.4.0

### Minor Changes

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
  - @checkstack/backend-api@0.21.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/common@0.13.0

## 0.3.23

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0

## 0.3.22

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
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
  - @checkstack/backend-api@0.19.0
  - @checkstack/healthcheck-common@1.4.0

## 0.3.21

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/healthcheck-common@1.3.0

## 0.3.20

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/backend-api@0.17.1

## 0.3.19

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/healthcheck-common@1.1.2

## 0.3.18

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/healthcheck-common@1.1.1

## 0.3.17

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3

## 0.3.16

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/backend-api@0.15.2

## 0.3.15

### Patch Changes

- 42abfff: Add practical-significance floors to anomaly detection.

  Two new schema annotations — `x-anomaly-min-absolute-delta` and `x-anomaly-min-relative-delta` — let plugin authors and operators suppress alerts whose statistical deviation is large but practical impact is negligible. Both floors must clear in addition to the existing μ ± Nσ trigger; defaults are 0 (disabled) so existing behaviour is unchanged.

  This is the fix for cases like a 6 ms latency baseline whose σ ≈ 1 ms causes routine 20 ms blips to fire as anomalies despite Δ=14 ms being operationally irrelevant. With `min-absolute-delta: 50` and `min-relative-delta: 0.5`, those blips stay silent while a 6 ms → 200 ms spike still fires.

  Built-in plugins ship with sensible defaults applied to every per-run field: 50 ms + 50 % for ms-unit fields, 5 percentage points for `%`-unit fields, 1 + 25 % for counter fields, 1 GB + 5 % for disk fields, 50 MB + 10 % for memory fields, 1 day for TLS expiry, 0.5 + 25 % for load average, 1 + 5 % for Minecraft TPS. Operators can override per-system or per-field via the assignment UI.

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/healthcheck-common@1.0.2

## 0.3.14

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
  - @checkstack/healthcheck-common@1.0.1

## 0.3.13

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/common@0.7.0
  - @checkstack/healthcheck-common@1.0.0

## 0.3.12

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/backend-api@0.14.0

## 0.3.11

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/backend-api@0.13.1

## 0.3.10

### Patch Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0

## 0.3.9

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/backend-api@0.12.0

## 0.3.8

### Patch Changes

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/healthcheck-common@0.10.1

## 0.3.7

### Patch Changes

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

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/backend-api@0.11.0

## 0.3.6

### Patch Changes

- Updated dependencies [1f191cf]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/backend-api@0.10.1

## 0.3.5

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0

## 0.3.4

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0

## 0.3.3

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/healthcheck-common@0.8.4

## 0.3.2

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/healthcheck-common@0.8.3

## 0.3.1

### Patch Changes

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

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0

## 0.3.0

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

## 0.2.5

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
  - @checkstack/healthcheck-common@0.8.2

## 0.2.4

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/healthcheck-common@0.8.1

## 0.2.3

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0

## 0.2.2

### Patch Changes

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0

## 0.2.1

### Patch Changes

- Updated dependencies [11d2679]
  - @checkstack/healthcheck-common@0.6.0

## 0.2.0

### Minor Changes

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

## 0.1.8

### Patch Changes

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0

## 0.1.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2

## 0.1.6

### Patch Changes

- 83557c7: ## Multi-Type Editor Support for HTTP Requests

  - Updated request collector to use new multi-type editor field for body templates

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/healthcheck-common@0.4.1

## 0.1.5

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3

## 0.1.4

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/healthcheck-common@0.4.0

## 0.1.3

### Patch Changes

- @checkstack/backend-api@0.3.1

## 0.1.2

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.3.0

## 0.1.1

### Patch Changes

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

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0

## 0.1.0

### Minor Changes

- f5b1f49: Refactored health check strategies to use `createClient()` pattern with built-in collectors.

  **Strategy Changes:**

  - Replaced `execute()` with `createClient()` that returns a transport client
  - Strategy configs now only contain connection parameters
  - Collector configs handle what to do with the connection

  **Built-in Collectors Added:**

  - DNS: `LookupCollector` for hostname resolution
  - gRPC: `HealthCollector` for gRPC health protocol
  - HTTP: `RequestCollector` for HTTP requests
  - MySQL: `QueryCollector` for database queries
  - Ping: `PingCollector` for ICMP ping
  - Postgres: `QueryCollector` for database queries
  - Redis: `CommandCollector` for Redis commands
  - Script: `ExecuteCollector` for script execution
  - SSH: `CommandCollector` for SSH commands
  - TCP: `BannerCollector` for TCP banner grabbing
  - TLS: `CertificateCollector` for certificate inspection

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
  - @checkstack/common@0.0.2
  - @checkstack/healthcheck-common@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/healthcheck-common@0.1.1

## 0.0.2

### Patch Changes

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
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/healthcheck-common@0.1.0
