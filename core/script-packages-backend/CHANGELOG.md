# @checkstack/script-packages-backend

## 0.3.9

### Patch Changes

- Updated dependencies [ebef442]
  - @checkstack/auth-common@0.9.0
  - @checkstack/sdk@0.105.1
  - @checkstack/secrets-backend@0.2.7
  - @checkstack/backend-api@0.21.7

## 0.3.8

### Patch Changes

- @checkstack/sdk@0.104.1

## 0.3.7

### Patch Changes

- @checkstack/sdk@0.103.1
- @checkstack/backend-api@0.21.6
- @checkstack/secrets-backend@0.2.6

## 0.3.6

### Patch Changes

- @checkstack/sdk@0.101.1

## 0.3.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/auth-common@0.8.3
  - @checkstack/common@0.15.0
  - @checkstack/notification-common@1.3.3
  - @checkstack/script-packages-common@0.3.3
  - @checkstack/secrets-common@0.2.3
  - @checkstack/secrets-backend@0.2.5
  - @checkstack/sdk@0.100.1

## 0.3.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/secrets-backend@0.2.4

## 0.3.3

### Patch Changes

- @checkstack/auth-common@0.8.2
- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/notification-common@1.3.2
- @checkstack/script-packages-common@0.3.2
- @checkstack/sdk@0.98.1
- @checkstack/secrets-backend@0.2.3
- @checkstack/secrets-common@0.2.2

## 0.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-common@0.8.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/script-packages-common@0.3.2
  - @checkstack/sdk@0.96.1
  - @checkstack/secrets-backend@0.2.2
  - @checkstack/secrets-common@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/auth-common@0.8.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/script-packages-common@0.3.1
  - @checkstack/sdk@0.95.1
  - @checkstack/secrets-backend@0.2.1
  - @checkstack/secrets-common@0.2.1

## 0.3.0

### Minor Changes

- 9dcc848: Add scheduled vulnerability auditing for Script Packages.

  A daily recurring job runs `bun audit --json` against the installed script-packages tree, persists advisories to new plugin-owned Postgres tables (`script_package_audit_advisory` keyed by lockfile hash + advisory id, plus a `script_package_audit_state` singleton last-run summary), and notifies every holder of `script-packages.manage` when a new or severity-escalated advisory appears. All severities are recorded; notifications fire on medium/high/critical, with a stable per-advisory key + a durable `notified` flag suppressing repeat-notify on an unchanged set. The pass is single-flight across the cluster via the existing installer advisory lock (mutually exclusive with installs, storage migrations, and blob GC) and reuses the installer's scratch / `.npmrc` / registry setup, reporting purely from the lockfile. New `getAuditState` and `auditNow` RPCs (gated by `script-packages.manage`), a `SCRIPT_PACKAGES_AUDIT_COMPLETED` signal, and a "Vulnerability audit" section in the settings page with an "Audit now" button that live-refreshes on completion.

  State and scale: audit results are the cluster-wide source of truth in Postgres (not the pod-local node_modules tree), so any pod returns the same advisories regardless of which pod ran the audit.

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
  - @checkstack/auth-common@0.8.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-common@0.3.0
  - @checkstack/secrets-backend@0.2.0
  - @checkstack/secrets-common@0.2.0
  - @checkstack/sdk@0.93.1

## 0.2.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/secrets-backend@0.1.1

## 0.2.0

### Minor Changes

- 270ef29: Fix several correctness defects around distributed coordination and stored-data handling.

  - Dwell `for:` timers now fire via an atomic `DELETE ... RETURNING` claim, so two pods (or the stalled sweeper vs the queue consumer) can no longer both fire the same dwell.
  - Postgres session-level advisory locks now keep connection affinity. A shared `AdvisoryLockService` (backed by a dedicated pooled client) replaces the previous acquire/release-on-different-connection pattern that leaked locks. Used by the script-packages installer election, the automation run resume + stalled sweeper, and (via a new transaction-scoped `withXactLock`) incident dedup.
  - A storage migration that crashed mid-flight is now resumed on startup under the installer-election lock, instead of permanently wedging installs.
  - Distributed script-package blobs carry a `blobSha256` and are verified before extraction (the SRI `integrity` hashes the npm tarball, not the transported archive). Backward-safe: entries without the field skip verification until a re-install regenerates the manifest.
  - Archive extraction rejects zip-slip paths (absolute or `..` entries) before writing anything.
  - `incident.create` with `dedupe_open_for_system` serializes its check-then-create per system, so concurrent triggers for the same system can't both open a duplicate incident.
  - Seeded auto-incident filter expressions JSON-encode interpolated ids so a quote/backslash can't corrupt the expression.
  - Stored jsonb snapshots (dwell `actorSnapshot`, wait-lock `waitConfig`) are validated with zod on load and degrade safely instead of flowing through as the wrong type.

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

- 270ef29: Add the script-packages backend package skeleton: Drizzle data model
  (allowlist, registry config, install state, size cap, content-addressed
  blob index, storage config, per-satellite sync state) + initial
  migration, the `blobStoreExtensionPoint` + `BlobStore` interface and a
  blob-store registry (with dual-backend read fallback for storage
  migration), the `CHECKSTACK_DATA_DIR` package-store path resolver, and
  the plugin registration that wires the extension point + access rules.
- b995afb: Fix two Script Packages bugs: empty-allowlist installs and read-only Advanced settings.

  - Install now: clicking "Install now" with no enabled packages no longer fails with ENOENT and an `error` install state. With an empty dependency set `bun install` writes no `bun.lock`, so the central resolver previously threw reading it. The resolver now short-circuits an empty (or all-disabled) allowlist to an empty resolved set, ending the install in `ready` at 0.0 MB with the deterministic empty-lockfile hash. No subprocess or registry call is made in that case.
  - Advanced settings: the registry URL, "ignore install scripts" toggle, write-only auth token, size guardrail thresholds, and active storage backend are now editable in the Script Packages settings page (previously read-only displays) and wired to the existing `setRegistryConfig` / `setSizeCapConfig` / `setStorageBackend` mutations. The auth-token field is write-only: a blank field leaves the stored token untouched, and a "Clear token" action removes it. The destructive blob-migration flow is unchanged.

  No schema or RPC contract changes.

- 270ef29: Add garbage collection for script packages, reclaiming both shared blob storage and per-host disk.

  Two things accumulated and were never reclaimed; both are now collected with provably-safe guards (referenced-set + grace + lock / active-run protection - when in doubt, retain).

  - **Blob GC (Postgres / S3 reclamation).** A new `gcBlobs` RPC (manage-gated) plus a daily scheduled job prune content-addressed blobs no longer referenced by any retained lockfile manifest (the current desired hash plus the previous N, default 1, for rollback / in-flight reconciles). Candidates are only deleted after a grace window (default 24h, keyed on `created_at`), each blob's bytes are removed from its recorded backend before its index row, and the pass holds the installer-election advisory lock so it is mutually exclusive with installs and storage migrations. The settings UI surfaces last-run and total-reclaimed figures and a "Run cleanup now" action. The installer now records each successful manifest in a new `script_package_lockfile_history` table so the retained set is computable; GC state lives in `script_package_blob_gc_state`.
  - **Tree GC (per-host disk).** After a successful symlink flip, each host (core pod or satellite) sweeps its `trees/<lockfileHash>/` dirs, deleting non-current trees older than a grace window (default 1h). `current`'s target is never deleted. Active-run safety uses a conservative mtime-keyed grace window chosen to exceed the longest run timeout, since runs are throwaway subprocesses with no robust cross-process refcount - a tree only becomes eligible once no live run could still be pinned to it.

  Adds the `gcBlobs` / `getBlobGcState` RPCs, the `BlobGcSummary` / `BlobGcState` schemas, and two new Drizzle tables (`script_package_lockfile_history`, `script_package_blob_gc_state`).

- 270ef29: Harden the script-packages store against three confirmed defects:

  - **Tree GC no longer deletes live trees.** The tree garbage collector keyed
    its grace window on the materialized tree's dir mtime. A tree that had been
    `current` for days carried an ancient mtime, so it became eligible for
    deletion the instant it was superseded by a flip - and the post-flip sweep
    would then delete a tree that an in-flight run (which snapshots its
    resolution root at run start) was still pinned to. The flip now stamps a
    `.retired-at` marker into the superseded tree, and the grace window is
    measured from that retirement timestamp. A non-current tree with no marker
    is retained (and lazily back-filled) so it ages out instead of leaking, and
    is never deleted on a missing signal.

    BREAKING CHANGE: the tree-GC grace window is now measured from a tree's
    retirement time (when it stopped being `current`), not its dir mtime.
    Existing non-current trees with no `.retired-at` marker are retained on the
    first sweep and back-filled, then collected on a later sweep once the grace
    window elapses from the back-filled time.

  - **Installer no longer leaves a plaintext registry token on disk after a
    failed resolve.** The central resolver wrote the auth-token-bearing
    `.npmrc` into its scratch dir but only removed the scratch dir on the
    success path; any failure between `bun install` and packing the cache
    entries left the token on disk. Scratch-dir removal now runs in a `finally`
    so the token is cleaned up on every exit path.

  - **Tar extraction rejects symlink/hardlink entries.** Blob unpacking
    validated entry names against zip-slip but not link targets, so a symlink
    with a safe name but an escaping target (for example `-> /etc` or
    `-> ../../..`) passed; a later regular-file entry could then be written
    through it and escape the target directory. The listing pass now inspects
    entry types (`tar -tzvf`) and rejects any non-regular, non-directory entry.

- 270ef29: Add the install/resolve service for script packages: deterministic
  lockfile-manifest hashing (content-addressed, order-independent),
  generated store `package.json` builder, `.npmrc` renderer (auth token
  write-only, never logged), `bun.lock` parser (name/version/integrity
  extraction), the elected-installer Postgres advisory lock (pattern copied
  from automation-backend) + singleton install-state store, the
  `performInstall` orchestration (resolve -> delta-publish blobs to the
  active store -> record manifest/hash/size), and the admin-configurable
  size-cap guardrail (warn 150MB / block 300MB).

  Empirically verified: `bun install --offline` reconstructs `node_modules`
  from a pre-seeded Bun cache with zero network access (the delta-sync model
  the reconciler builds on). Hardlink-vs-copy is filesystem-dependent and
  does not affect correctness.

- b995afb: Fix package IntelliSense in script editors: lazy Automatic Type Acquisition (ATA) with proper `@types/*` resolution.

  Script editors (automation "Run Script (TypeScript)" and healthcheck collectors) now provide real autocomplete for installed npm packages. Importing a package whose types live in DefinitelyTyped - e.g. `import { debounce } from "lodash"` (lodash ships no own types; `@types/lodash` does) - now yields member completions. Previously no package completions appeared at all.

  Root cause: the old rollup wrapped each package's raw, multi-file `.d.ts` (with `export =`, `export as namespace`, and triple-slash `/// <reference path>` chains) inside a single `declare module "<name>" { ... }`, which the TypeScript worker silently rejected, and it truncated large type sets (lodash is ~866 KB across ~700 files) at a 256 KB cap.

  The fix registers the REAL declaration files at their `node_modules/...` virtual paths and lets TypeScript's own NodeJs + `@types` resolution do the work:

  - `@checkstack/script-packages-backend`: replaced `rollupPackageTypes` with a tree-driven closure extractor (`resolvePackageTypeClosure`). Given a bare specifier, it resolves against the materialized tree - own types via `package.json` `types`/`typings`/`exports` (bundled-types packages like `zod`/`dayjs`), the `@types/<mangled>` companion when it exists (`lodash` -> `@types/lodash`, scoped `@babel/core` -> `@types/babel__core`), or both, or neither (graceful empty, never a throw). It follows `/// <reference path|types>` and relative imports, includes each package's `package.json`, leaves every file UNWRAPPED, and surfaces a `truncated` flag instead of silently capping. Served from a new raw, HTTP-cacheable route `GET /api/script-packages/types/:lockfileHash/:specifier` (`Cache-Control: private, max-age=1y, immutable`), auth-gated by `script-packages.read`.
  - `@checkstack/script-packages-common`: **BREAKING** - replaced the `listPackageTypes` RPC procedure and `PackageTypesSchema { name, version, dts }` with `PackageTypeClosureSchema` (a `{ path, content }` file-map plus `hasOwnTypes`/`hasAtTypes`/`notFound`/`truncated`) served over the cacheable HTTP route. Added a shared `buildTypeAcquisitionPath`/`parseTypeAcquisitionPath` path contract.
  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `acquireTypes` resolver + `acquireResetKey`. On debounced buffer change it parses bare `import`/`require` specifiers (pure, unit-tested) and lazily fetches + registers each NEW package's closure via `addExtraLib` at `file:///node_modules/...`, deduped by a shared acquired-set that resets when the install hash changes. Compiler options set `moduleResolution: NodeJs`, `baseUrl: "file:///"`, and `typeRoots` so a bare import resolves to its `@types` companion. The `context` ambient global keeps working unchanged.
  - `@checkstack/script-packages-frontend`: replaced the old `useScriptPackageTypes` (which concatenated the broken `dts`) with `useScriptPackageTypeAcquisition()`, returning the `acquireTypes` resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as `acquireResetKey`.
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: wired the resolver into the Run Script and collector editors.

  State & scale: the type closure is derived on read from the materialized package tree (no new durable state). The editor's acquired-set is pod-local UI bookkeeping; the route is keyed by the cluster-wide `lockfileHash`, so the browser HTTP cache is correct across pods and only refetches after a new install changes the hash.

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

- b995afb: Add live, backend-proxied npm package-name autocomplete and version lookup to the Script Packages "Allowed packages" form.

  The package-name field now searches the configured registry as you type (debounced). The version field suggests the package's published versions newest-first, defaulting to the registry's `latest` dist-tag while staying free-typeable for an exact manual pin. Picking a package now auto-fills its version (from the search hit, then upgraded to `latest`) instead of clearing the field, and the version dropdown stays open so a version is actually selectable.

  This is fully backend-proxied so it reuses the SAME configured registry + auth the install path uses: the registry can be private with a server-side-only auth token (the client only ever sees `hasAuthToken`), and browsers can't reach arbitrary registries due to CORS.

  - `@checkstack/script-packages-common`: two new `manage`-gated query procedures - `searchPackages` (input `{ text }`, output `{ items: [{ name, version?, description? }] }`) and `getPackageVersions` (input `{ name }`, output `{ versions, distTags? }`). Output `version`/`versions` are relaxed to plain strings so valid-but-unusual registry versions surface as suggestions; strict `PackageVersionSchema` validation still applies on `addPackage`.
  - `@checkstack/script-packages-backend`: new `registry-client` (fetch-based, AbortController timeout, size cap, zod-validated registry responses, scoped-registry selection, tolerant semver-descending sort, a best-effort pod-local read cache that is never a source of truth, and errors that never leak the auth token). Search results use the registry's own relevance ranking from `-/v1/search`. The registry + token resolution used by the install path is factored into a shared `resolveRegistryRequestConfig` helper reused by both the new RPC handlers and the installer.
  - `@checkstack/script-packages-frontend`: the package and version inputs become live comboboxes (Popover + Input) with inline pinned-version validation before "Add" is enabled. Selecting a suggestion routes through a dedicated `onSelect(hit)` callback (separate from manual-typing `onValueChange`) so a pick auto-fills the version instead of clearing it; the popover dismissable layer ignores interactions originating on the anchor input, fixing the version dropdown that previously opened then immediately closed. The version-autofill decision logic is extracted into a pure, unit-tested helper.

  State & scale: the registry-client TTL cache is an explicitly non-authoritative, pod-local best-effort read cache (search/version lookups are non-authoritative reads); a cache miss on another pod simply re-fetches, so pod-local divergence is harmless. No new durable state of record is introduced.

- 270ef29: Wire up the script-packages RPC router, admin UI, and editor IntelliSense.

  - `script-packages-backend`: the oRPC router implementing the full
    contract (allowlist CRUD, registry config with encrypted write-only auth
    token, `installNow` via the elected installer, size cap, storage backend
    selection, install state, `getManifest` / `downloadBlob` for reconcilers,
    and `listPackageTypes`), the `installNow` controller (election, size-cap
    enforcement, `script-packages.changed` emit, blocked during migration),
    the `.d.ts` rollup, the singleton config stores, and the full plugin
    wiring (broadcast-hook reconcile + startup backstop).
  - `script-packages-common`: admin route for the settings page.
  - `script-packages-frontend`: the Settings -> Script Packages admin page
    (allowlist, install state + size, registry/storage summary, satellite
    sync) and the `useScriptPackageTypes()` hook.
  - `automation-frontend` / `healthcheck-frontend`: merge installed-package
    `.d.ts` into the script-editor `typeDefinitions` so `import` from an
    allowlisted package autocompletes in every script field.

- 270ef29: Add storage-backend migration for script packages.

  - `migrateStorage({ target })` copies every blob from the active backend to
    the target, verifies each copy byte-for-byte (read back + SHA-256 compare),
    flips the per-blob `backend` only after a verified copy, then atomically
    switches the active backend. Resumable from a partial state (the work set
    is re-derived from the index), aborts cleanly on an integrity mismatch
    (active backend untouched), and supports optional source GC. Built on the
    Phase 2 dual-backend read fallback, so reads keep working mid-migration.
  - Migration and `installNow` are mutually exclusive via the installer
    advisory lock; `setStorageBackend` is refused while a migration runs.
  - New `listStorageBackends` RPC + admin UI: a storage-backend card with a
    target selector, "Migrate" action, and live progress / completion / error
    state.

- 270ef29: Secrets platform Phase 5: internal-secret consolidation (registry token) + connection-credential leak hardening.

  - New `internalSecretsRef`: platform-internal secrets (not user-managed
    named secrets) stored under a reserved `__internal__:` prefix, ALWAYS on
    the local (always-writable, AES-GCM) backend so internal writes never
    break when Vault is the active backend. Excluded from the user-facing
    Secrets list.
  - The script-package registry auth token is consolidated onto
    `internalSecretsRef`. The `authSecretRef` column now holds a stable
    marker; a one-time, idempotent, parity-verified migration moves legacy
    inline ciphertext into the platform and only rewrites the column once the
    platform copy reads back identically (legacy value never dropped early).
    Resolution stays backward-compatible with legacy ciphertext.
  - Integration: `createConnection` / `updateConnection` now return the
    redacted connection preview instead of echoing the submitted credential
    fields back in the response (leak hardening). Non-breaking — the frontend
    refetches the redacted list and ignores the returned preview.

  NOTE: integration connection-credential STORAGE is intentionally NOT
  migrated onto the secrets platform. Connection creds are co-mingled
  secret/non-secret config stored per-provider via `ConfigService` (which
  already uses the same AES-GCM crypto + per-field redaction); splitting them
  out would require per-provider schema-walking and a lossy migration across
  live integrations for no real gain. The `ConnectionStore` API + storage are
  unchanged.

### Patch Changes

- b995afb: Harden the script-package blob byte boundary against a raw `ArrayBuffer`.

  Blob bytes can reach the content-hash and storage codecs as a raw `ArrayBuffer` (e.g. from an S3/HTTP transport's `arrayBuffer()`), and Node/Bun's `crypto.Hash.update()` rejects a bare `ArrayBuffer` ("The 'data' argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of ArrayBuffer"), which would fail a real-package install with `status=error`. `blobSha256` / `verifyBlobSha256` (script-packages-backend) and `encodeBlob` (script-packages-store-postgres) now normalize `ArrayBuffer` to a `Uint8Array` view at the boundary before hashing/encoding. A view over the same bytes hashes and encodes identically, so existing content hashes and stored blobs are unchanged. Adds regression tests feeding an `ArrayBuffer` through both the hash and the Postgres codec.

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
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
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/secrets-backend@0.1.0
  - @checkstack/script-packages-common@0.2.0
  - @checkstack/secrets-common@0.1.0
