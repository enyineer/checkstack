# @checkstack/integration-script-backend

## 0.6.17

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-common@0.8.0
  - @checkstack/automation-backend@0.10.0
  - @checkstack/script-packages-backend@0.3.16

## 0.6.16

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
  - @checkstack/automation-backend@0.9.3
  - @checkstack/secrets-backend@0.2.12
  - @checkstack/script-packages-backend@0.3.15
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/automation-common@0.7.1
  - @checkstack/script-packages-common@0.3.5
  - @checkstack/secrets-common@0.2.5

## 0.6.15

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/automation-backend@0.9.2
  - @checkstack/secrets-backend@0.2.11
  - @checkstack/script-packages-backend@0.3.14

## 0.6.14

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/automation-backend@0.9.1
  - @checkstack/script-packages-backend@0.3.13
  - @checkstack/secrets-backend@0.2.10

## 0.6.13

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/automation-common@0.7.0
  - @checkstack/script-packages-backend@0.3.12
  - @checkstack/secrets-backend@0.2.9
  - @checkstack/script-packages-common@0.3.4
  - @checkstack/secrets-common@0.2.4

## 0.6.12

### Patch Changes

- @checkstack/automation-backend@0.8.1
- @checkstack/secrets-backend@0.2.8
- @checkstack/script-packages-backend@0.3.11

## 0.6.11

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/automation-common@0.6.0
  - @checkstack/script-packages-backend@0.3.10
  - @checkstack/secrets-backend@0.2.8

## 0.6.10

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/automation-backend@0.7.0
  - @checkstack/automation-common@0.5.0
  - @checkstack/script-packages-backend@0.3.9
  - @checkstack/secrets-backend@0.2.7
  - @checkstack/backend-api@0.21.7

## 0.6.9

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/automation-backend@0.6.0
  - @checkstack/script-packages-backend@0.3.8

## 0.6.8

### Patch Changes

- @checkstack/automation-backend@0.5.8
- @checkstack/backend-api@0.21.6
- @checkstack/script-packages-backend@0.3.7
- @checkstack/secrets-backend@0.2.6

## 0.6.7

### Patch Changes

- @checkstack/automation-backend@0.5.7

## 0.6.6

### Patch Changes

- @checkstack/automation-backend@0.5.6
- @checkstack/script-packages-backend@0.3.6

## 0.6.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/automation-common@0.4.3
  - @checkstack/script-packages-common@0.3.3
  - @checkstack/secrets-common@0.2.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/secrets-backend@0.2.5
  - @checkstack/script-packages-backend@0.3.5

## 0.6.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/script-packages-backend@0.3.4
  - @checkstack/secrets-backend@0.2.4

## 0.6.3

### Patch Changes

- @checkstack/automation-backend@0.5.3
- @checkstack/automation-common@0.4.2
- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/script-packages-backend@0.3.3
- @checkstack/script-packages-common@0.3.2
- @checkstack/secrets-backend@0.2.3
- @checkstack/secrets-common@0.2.2

## 0.6.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/automation-backend@0.5.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/script-packages-backend@0.3.2
  - @checkstack/script-packages-common@0.3.2
  - @checkstack/secrets-backend@0.2.2
  - @checkstack/secrets-common@0.2.2

## 0.6.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/automation-common@0.4.1
  - @checkstack/script-packages-backend@0.3.1
  - @checkstack/script-packages-common@0.3.1
  - @checkstack/secrets-backend@0.2.1
  - @checkstack/secrets-common@0.2.1

## 0.6.0

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
  - @checkstack/backend-api@0.21.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/automation-common@0.4.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-common@0.3.0
  - @checkstack/script-packages-backend@0.3.0
  - @checkstack/secrets-backend@0.2.0
  - @checkstack/secrets-common@0.2.0

## 0.5.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/secrets-backend@0.1.1
  - @checkstack/script-packages-backend@0.2.1

## 0.5.0

### Minor Changes

- b995afb: Improve the automation Run Script secret → env mapping editor and script IntelliSense.

  - **Searchable secret picker with existence validation.** The secret → env mapping editor (`SecretEnvEditor`) now uses a searchable, keyboard-navigable combobox (modeled on `VariablePicker` / `PackageNameCombobox`, `isLowPower`-aware) populated from the secrets plugin's `listSecretNames`, replacing the plain `<input>` + `<datalist>`. A free-typed name still round-trips (a secret may be created later). When a row references a name that the loaded list does not contain, the row shows a non-blocking warning (red border + message); save is not prevented. The existence check lives in a pure, unit-tested `unknownSecretNames` helper.
  - **Clearer field description.** The `secretEnv` field descriptions on the `run_script` / `run_shell` actions no longer show the stored `${{ secrets.NAME }}` template (which is confusing in a UI that takes a bare name); they now describe the actual UI behavior and how the value is injected (`process.env.<ENV_NAME>` / `$<ENV_NAME>`) and masked.
  - **`process.env.<ENV_NAME>` autocomplete.** Declared `secretEnv` env-var names now autocomplete under `process.env.` in the Run Script (TypeScript) Monaco editor and are typed `string`, via an ambient `NodeJS.ProcessEnv` augmentation merged into the editor type definitions. New pure, unit-tested generators `generateSecretEnvTypes` and `secretEnvEnvNames` (exported from `@checkstack/automation-frontend`) drive this; the augmentation coexists with `@types/node`'s existing index signature.
  - **Shared combobox-interaction helper.** The "opens-then-immediately-closes" popover guard (`comboboxAnchorProps` / `isAnchorInteraction`) is promoted from `@checkstack/script-packages-frontend` into `@checkstack/ui` so the new secret picker and the existing package/version comboboxes share one implementation; the package comboboxes now import it from `@checkstack/ui` and the local copy is removed.

- 270ef29: Add in-UI script testing for automation `run_script` / `run_shell` actions.

  A new `testScript` RPC runs a TypeScript or shell script against an
  editable, auto-seeded sample context using the same sandboxed runner the
  real action uses, so operators can test scripts directly in the editor
  without dispatching a whole automation. Surfaces beneath any script field
  flagged `x-script-testable` via the new `ScriptTestPanel` /
  `ContextSampleEditor` components in `@checkstack/ui` and the
  `scriptTestRenderer` prop threaded through `DynamicForm`.

  - `@checkstack/automation-common`: adds the `testScript` contract +
    `ScriptTest*` schemas (gated by `automation.manage`).
  - `@checkstack/automation-backend`: implements `testScript` reusing the
    shared ESM / shell runners; central-only, time-bounded.
  - `@checkstack/backend-api`: new `x-script-testable` config-schema
    metadata propagated to the frontend JSON Schema.
  - `@checkstack/ui`: new `ScriptTestPanel` + `ContextSampleEditor`
    components and a `scriptTestRenderer` prop on `DynamicForm`.
  - `@checkstack/automation-frontend`: wires the test panel into the action
    editor.
  - `@checkstack/integration-script-backend`: marks the `run_script` /
    `run_shell` script fields as testable.

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

- 270ef29: Add the Secrets platform (Phase 1): a central, plugin-agnostic secret manager with a pluggable backend extension point, a cross-plugin resolver service, and a universal Jenkins-style masking layer.

  - New packages: `secrets-common` (schemas, contract, `secrets.read`/`secrets.manage`, masking utils), `secrets-backend` (`SecretBackend` extension point, `secretResolverRef`/`secretAdminRef` services, run-scoped masking context, RPC router), `secrets-backend-local` (default AES-256-GCM backend, owns the `secrets` table promoted from gitops), `secrets-frontend` (admin Settings page).
  - Resolution machinery (`resolveSecretsBySchema`, `SecretStore`, `${{ secrets.NAME }}` / `x-secret`) is promoted out of `gitops-backend` into `secrets-backend`. GitOps now resolves and manages secrets through the platform's service refs (single source of truth); its secret table is migrated without loss.
  - Universal masking seam wired at the central script-output boundaries: automation `run_script` / `run_shell` artifacts and the in-UI test panel redact run-scoped secret values from `result`/`stdout`/`stderr`/`error` before persist/return. Phase 1 resolves no run-scoped secrets yet, so masking is a no-op until Phase 2; the seam guarantees the boundary exists.
  - No endpoint returns a secret value to a browser: DTOs expose only name/metadata/`hasValue`.

  BREAKING CHANGES: `gitops-backend` now depends on `secrets-backend` and resolves/manages secrets through it. The `secrets` table is owned by `secrets-backend-local`; the gitops `secrets` table is retained as a migration source but is no longer the source of truth.

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
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
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
  - @checkstack/automation-common@0.3.0
  - @checkstack/secrets-backend@0.1.0
  - @checkstack/script-packages-backend@0.2.0
  - @checkstack/script-packages-common@0.2.0
  - @checkstack/secrets-common@0.1.0

## 0.4.0

### Minor Changes

- 41c77f4: feat(automation): native per-editor context for script actions (typed `context` for TS, `$ENV` for shell)

  Script action editors had a confusing dual system: the TypeScript editor
  type-checked `{{ }}` template text as code (so `{{ artifact.x }}` errored
  with "Cannot find name"), and the runtime never actually populated the
  `context` object. This standardises on a single, native context-access
  mechanism per editor kind.

  **Run scope reaches actions.** `ActionExecutionContext` gains a `scope`
  (`{ trigger, artifacts, vars, repeat? }`), populated by the dispatch
  engine from the same scope it already uses for `{{ }}` rendering. Actions
  that need broad context (the script actions) read from it instead of
  having to declare every artifact type in `consumes`. Additive and
  optional, so existing actions are unaffected.

  **TypeScript / JavaScript → typed `context`.** `run_script` now builds
  `context` from the run scope, so `context.trigger.payload`,
  `context.artifacts`, `context.var`, `context.repeat`, and
  `context.automation` are populated at run time (previously
  `context.trigger` was always empty). The editor types match via
  `generateAutomationContextTypes`.

  **Shell → `$CHECKSTACK_*` env vars.** `run_shell` flattens the run scope
  into environment variables (e.g. `$CHECKSTACK_TRIGGER_PAYLOAD_TITLE`,
  `$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Arrays become a
  single newline-separated var (iterate with `while IFS= read -r x; do …;
done <<< "$VAR"`). Every value is a plain string — no JSON blob, since
  the container has no `jq` to parse one. A shared `toShellEnvKey`
  helper (in `@checkstack/automation-common`) derives the names so the
  shell editor's `$` autocomplete lists exactly what the runtime injects.

  **One syntax per field kind (editor + runtime).** `MultiTypeEditorField`
  no longer offers `{{ }}` autocomplete in `typescript` / `javascript` /
  `shell` editors, and the dispatch engine no longer template-renders
  native-code config fields (those whose `x-editor-types` is a code type) —
  so `{{ }}` can't be used in a script by accident. Text / markup editors
  (`raw`, `json`, `yaml`, `xml`, `markdown`, `formdata`) and plain string
  fields keep `{{ }}` as before. Because both the automation and
  health-check editors share `MultiTypeEditorField`, they behave
  identically.

  **Script-editor IntelliSense polish.** The code editors got a few
  ergonomic fixes so the typed context is actually usable: the suggestion
  **details panel auto-opens** (so long completion names are legible
  on-focus, not hidden behind the chevron); word-based keyword noise is
  disabled in favour of language-service + provider completions; and a
  TS/JS completion provider makes `context.artifacts.` list the in-scope
  artifact ids and **auto-convert the dot to bracket notation** —
  `context.artifacts["integration-jira.issue"]` — since those ids aren't
  valid identifiers. (Driven by a new opt-in `dottedKeyCompletions` prop on
  the editor / `DynamicForm`.)

  **BREAKING (beta):** `{{ }}` interpolation inside a script action's
  `script` field (shell or TypeScript) is no longer expanded at run time —
  read run data via the typed `context` object (TS) or `$CHECKSTACK_*` env
  vars (shell) instead. Non-script config fields are unchanged.

  Also fixes: switching a provider action in the visual editor now resets
  its config, so the validator no longer reports the previous action's keys
  as unrecognised.

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

- 41c77f4: fix(automation): qualify action `produces` / `consumes` with the owning plugin id

  `context.artifacts` showed up untyped (no fields) in the script editor
  because action `produces` / `consumes` were hand-written full strings
  (`"jira.issue"`) that did not match the artifact-type registry's
  qualified id. The registry derives `${pluginId}.${id}`, and the plugin's
  id is the package name `integration-jira`, so the artifact type actually
  registers as `integration-jira.issue` — the editor's schema lookup
  (`produces` vs registered `qualifiedId`) missed, leaving the artifact's
  fields unknown. (Runtime store/consume happened to agree with each other
  on the short string, so it "worked" but typed nothing.)

  The action registry now qualifies `produces` with the owning plugin id,
  exactly as it already qualifies the action's own `id` and as the
  artifact-type registry qualifies the artifact type id — so the three can
  never drift. Actions declare the **local** artifact id:

  - `produces: "issue"` → registered as `integration-jira.issue`,
  - `consumes: ["issue"]` → resolved against the owning plugin's namespace
    at run time; `consumedArtifacts` is keyed by the local id, so an
    action's `execute` reads `consumedArtifacts["issue"]`.

  All five artifact-producing integration plugins (jira / teams / webex /
  webhook / script) now declare local ids. With `produces` matching the
  registered artifact type, the editor types `context.artifacts[...]` with
  the real schema (e.g. `issueKey`, `projectKey`, `issueUrl`).

  **BREAKING (beta):** the fully-qualified artifact type ids change from
  the short form to the plugin-prefixed form, e.g. `jira.issue` →
  `integration-jira.issue`. This affects how artifacts are referenced in
  templates (`{{ artifact.integration-jira.issue.issueKey }}`), the TS
  script `context.artifacts["integration-jira.issue"]`, and shell env names
  (`$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Artifacts are
  per-run and ephemeral, so no stored-data migration is needed.

  Note: this keeps the same-plugin produce→consume handoff (the current
  pattern). Cross-plugin artifact consumption would need a follow-up to
  allow a fully-qualified `consumes` ref.

- 4832e33: fix(automation): insert runtime-parseable `templateRef` from editor autocomplete + variable picker, with array indexing

  The automation editor's `{{ }}` autocomplete and the `fx` variable picker
  previously inserted the canonical dotted path (e.g.
  `artifact.integration-jira.issue.issueKey`), which the template engine
  cannot parse when an artifact id contains dots or hyphens, and which used
  the singular `artifact`/`var` namespaces the runtime template context does
  not expose. They now insert the runtime-parseable `templateRef` form -
  plural top-level namespace (`artifacts`/`variables`) plus bracket notation
  for non-identifier segments, e.g. `artifacts["integration-jira.issue"].issueKey`.

  - `@checkstack/automation-common`: `VariableEntry` gains `templateRef`
    (runtime-parseable insertion form) and `referenceable`, alongside the
    unchanged canonical `path`. New exported helpers `isTemplateIdentifier`,
    `appendTemplateSegment`, and `appendArrayIndex` build the form. Scope
    derivation now descends into `array` schemas, offering both the whole
    array and a representative element subtree (`tags[0]`, `comments[0].author`,
    nested `matrix[0][0]`).
  - `CompletionField` / `TemplateProperty` / `VariableNode` carry a
    `templateRef` alongside the canonical `path`.
  - The staged completion provider's field label, filter/match, insert text,
    and value-stage field lookup all operate in `templateRef` space. The
    expression tokenizer now emits bracket tokens and reconstructs the full
    `foo["bar"].baz` / `foo["bar"].list[0]` access chain (normalising single
    quotes to the stored double-quoted form, and supporting bare numeric array
    indices) so value-stage enum suggestions resolve for bracket-notation and
    indexed fields.
  - `VariablePicker` and the `DynamicForm` template inserters write the
    `templateRef` (falling back to `path` when absent).
  - Shell-env (`$CHECKSTACK_*`) name derivation deliberately keeps using the
    canonical dotted `path`, so the suggested env names stay byte-identical
    to the backend's path-based injection. Script-context type generation is
    unchanged.
  - `@checkstack/integration-script-backend`: shell-script actions now also
    expose array elements as indexed `$CHECKSTACK_*_<i>` env vars (and
    `$CHECKSTACK_*_<i>_<field>` for object elements), alongside the existing
    whole-array newline-joined var, so the runtime injects exactly the
    array-element names the editor now suggests.

- 6d52276: feat(automation): expose `trigger.id` and reconcile the trigger scope so multiple triggers are distinguishable

  Automations with more than one trigger could not tell which trigger fired:
  the trigger id wasn't queryable, and scripts only received `trigger.event`
  (so two triggers on the same event were indistinguishable). This exposes a
  consistent trigger contract everywhere - `trigger.id`, `trigger.event`,
  `trigger.actor`, `trigger.payload` - in templates, shell, and TypeScript
  scripts.

  - **`trigger.id` is now available** in templates (`{{ trigger.id }}`) and in
    the script context (`context.trigger.id`). It is typed as the **literal
    union** of the automation's trigger ids, so it discriminates triggers -
    including two subscribed to the same `event`.
  - **Auto-generated trigger ids.** The editor now assigns a unique, log-
    friendly id to every trigger (derived from its event, e.g.
    `incident_created`, deduped as `incident_created_2`), mirroring action ids:
    seeded on the starter automation, assigned on add, and re-filled on blur.
  - **Scripts now receive `trigger.id` and `trigger.actor`.** The
    `ActionRunScope` projection previously dropped both (it only forwarded
    `event` + `payload`), so `context.trigger.actor` was typed but never
    populated - that gap is fixed.
  - **Scope key reconciled.** The internal dispatch scope now exposes
    `trigger.event` as the canonical key (matching the editor and script
    contract) instead of leaking `trigger.eventId`; `trigger.eventId` is kept
    as a back-compat alias, so `{{ trigger.event }}` now resolves in template
    fields where it previously returned `undefined`.

  No database migration: the actor and id ride in the run scope snapshot. A
  shared `deriveTriggerId` is exported from `@checkstack/automation-common` so
  the editor, generated script types, and the runtime all agree on derived ids.

### Patch Changes

- 41c77f4: feat(automation): Phase 11 — editor primitives + context type generation

  Lays the UI + type-generation groundwork for Phase 12's visual automation
  editor. Every primitive reuses the existing Monaco wrapper / template
  engine / `jsonSchemaToTypeScript` helper rather than building parallel
  infrastructure.

  **`@checkstack/automation-common` — `resolveVariableScope`**

  Pure walker that returns the in-scope `{{ … }}` paths at a given action
  position. Conservative scoping rules: linear-upstream variables /
  artifacts only (no leaking across `choose` / `parallel` / `repeat`
  branches), `repeat.index` / `repeat.item` exposed only inside a `repeat`,
  and trigger.payload modelled as a **discriminated union over
  `trigger.event`** — every payload field surfaces; ones that come from a
  subset of subscribed triggers carry a `conditionalOnTriggers` annotation
  so the picker can render an "Only when …" hint. Earlier draft used
  schema-intersection; switched to discriminated unions per review
  feedback so Monaco can narrow correctly inside event-gated branches.

  **Condition-aware narrowing.** When the path descends through a
  `choose-when`, the resolver parses the branch's `when:` expression and
  statically pins `trigger.event` to the set the condition allows —
  patterns covered are `trigger.event == "X"` (either operand order),
  `trigger.event != "X"`, `||`/`&&` of those, and `{ and: [...] }` /
  `{ or: [...] }` combinators. So an action inside
  `when: 'trigger.event == "incident.created"'` sees only the
  `incident.created` variant in scope, the `conditionalOnTriggers`
  annotation disappears, and other-trigger fields drop out entirely.
  Nested choose branches compound (intersection). Anything outside the
  covered patterns falls back to the full union — better to show every
  field than guess wrong.

  **`@checkstack/template-engine`**

  The expression AST (`Expr`, `BinaryExpr`, `MemberExpr`, etc.) is now a
  public export — the resolver's condition-narrowing walker needs to
  inspect parsed condition trees. `ParsedCondition.root` is tightened
  from `unknown` to `Expr` so consumers don't need to cast.

  **`@checkstack/automation-frontend` — `generateAutomationContextTypes`**

  Consumes `resolveVariableScope`'s output + the trigger / artifact
  registries and emits the `declare const context: { … }` TS declaration
  that `integration-script.run_script`'s Monaco editor injects via
  `addExtraLib`. The emitted shape:

  ```ts
  type AutomationTrigger =
    | { event: "incident.created"; payload: { … } }
    | { event: "incident.resolved"; payload: { … } };

  declare const context: {
    trigger: AutomationTrigger;
    artifacts: { "jira.issue"?: { key: string; … }; … };
    var: { foo?: string; … };
    repeat: { index: number; item: unknown };  // only when inside a repeat
  };
  ```

  `jsonSchemaToTypeScript` from `@checkstack/ui` is reused via a deep
  import (rather than the barrel) so the bun test runner doesn't try to
  load Monaco's Vite-only `?worker` modules during unit tests.

  **`@checkstack/ui` — new editor primitives**

  - `TemplateValueInput` — single-line `{{ }}` autocomplete input.
    Extracted from `DynamicForm/KeyValueEditor`'s previously-private
    `TemplateInput` so other editor surfaces can share it without
    rebuilding the picker UX. `KeyValueEditor` is now a one-line
    delegation; `detectTemplateContext` is also exported.
  - `VariablePicker` — hierarchical popover for the explicit "fx" /
    "Insert variable" workflow. Renders a filterable tree of
    `VariableNode`s with type chips and `Only when …` hints sourced from
    the resolver's `conditionalOnTriggers`. Defaults to a small "fx" pill
    trigger; callers can pass a custom one.
  - `TemplateInput` — high-level mode switcher: `text` mode delegates to
    `TemplateValueInput`, all other modes (`code` / `bash` / `json` /
    `yaml`) delegate to `CodeEditor` with the matching language so the
    action editor can swap widgets purely from the action's
    `x-editor-types` annotation without touching the consuming code.
  - `TemplateInputToggle` — the small "fx" pill that flips a typed input
    (number / select / date / …) into template mode and back. Auto-infers
    template mode when the saved value already starts with `{{`, so
    round-tripping a previously-templated automation works out of the
    box. Render-prop API for the typed editor so consumers keep control
    over their own input shape.
  - `ActionCard` — collapsible card that hosts a single action in the
    visual editor. Decoupled from `DynamicForm` so container blocks
    (`ChooseBlock` / `ParallelBlock` / `RepeatBlock` in Phase 12) can use
    it as a structural shell over their own children. Toggle / delete /
    drag handle are conditionally rendered on their callback's presence.

  Storybook stories shipped for each of the new primitives.

  **`@checkstack/integration-script-backend`**

  `ScriptContext` docstring and the `scriptRunConfigSchema.script` field
  description now point at `generateAutomationContextTypes` so the Phase
  12 editor wiring is unambiguous — the runtime payload type stays
  `Record<string, unknown>` (the runner can't know the trigger schema),
  but the **editor** narrows it per-automation from the subscribed
  triggers' payload schemas.

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/automation-common@0.2.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0

## 0.3.2

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/integration-backend@0.1.30

## 0.3.1

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/integration-backend@0.1.29
  - @checkstack/integration-common@0.5.0

## 0.3.0

### Minor Changes

- a06b899: Extract shared `EsmScriptRunner` + `ShellScriptRunner` utilities, fix HIGH-severity privilege amplification in the integration TS provider, and harden the integration shell setupGuide example.

  **SECURITY FIX (HIGH)**

  The integration TS provider (`@checkstack/integration-script-backend` → `scriptProvider`) previously executed user scripts via `new Function(script)` in the satellite's main V8 isolate. A user with `integrationAccess.manage` could read `globalThis.process.env` directly (`DATABASE_URL`, `JWT_SECRET`, queue credentials, signing keys, …) and exfiltrate them through `result.id` — which round-trips into `delivery_logs.externalId` and is readable via the `getDeliveryLog` ORPC procedure. The same permission grants no legitimate API to those secrets; this was a privilege amplification.

  The provider now runs user scripts in a fresh Bun subprocess (matching the healthcheck inline-script collector model). The subprocess receives only a curated `SAFE_ENV_VARS` whitelist (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`) — backend secrets are no longer visible to user code. Filesystem reads, network calls (`fetch`), and the rest of the Node/Bun standard library continue to work, just in an isolated process.

  **BREAKING CHANGE (`@checkstack/integration-script-backend`)**

  User scripts can no longer read the satellite process's environment variables (`process.env.DATABASE_URL` etc. return `undefined`). Scripts that legitimately need configuration should accept it via the provider's `script` field input, not by introspecting the host environment. The full Node/Bun stdlib remains available; only the env scrub is new.

  **REFACTOR — new shared utilities in `@checkstack/backend-api`**

  Both the healthcheck and integration plugins had near-identical inline implementations of "run a user script in a subprocess sandbox" (ESM path) and "run a user shell script through `sh -c`" (shell path). These are now canonical, single-source-of-truth utilities:

  - **`defaultEsmScriptRunner.run({ script, context, timeoutMs, helperModuleName?, helperFunctionName? })`** — writes the user module to a fresh `mkdtemp` directory along with a generated runner module, spawns a Bun subprocess with `pickSafeEnv()`, parses the result back through a UUID-tagged stderr marker, and tears everything down in `finally` (`clearTimeout` + `proc.kill()` + recursive `rm`). The optional `helperModuleName` / `helperFunctionName` pair drops a sibling `_helpers.mjs` file and rewrites `import { <fn> } from "<module>"` to point at it (this is the trick that makes `@checkstack/healthcheck` / `@checkstack/integration` resolve at runtime even though they're not real npm packages).
  - **`defaultShellScriptRunner.run({ script, timeoutMs, cwd?, env? })`** — invokes `sh -c <script>` via `Bun.spawn` with `SAFE_ENV_VARS` (user-supplied `env` merged on top), `Promise.race` timeout with `proc.kill()` on expiry, and the same `clearTimeout` + `proc.kill()` cleanup in `finally`.

  Both runners expose `EsmScriptRunner` / `ShellScriptRunner` interfaces so tests can inject mocks without touching the spawn path. The four call sites (`plugins/healthcheck-script-backend/src/inline-script-collector.ts`, `strategy.ts` and `plugins/integration-script-backend/src/provider.ts`, `shell-provider.ts`) collapse from full inline implementations to ~8-line adapters.

  **FIXES**

  - Integration shell provider's `setupGuide` example replaced the unsafe `curl -d "{\"title\": \"$PAYLOAD_TITLE\"}"` JSON interpolation with a `jq -n --arg title "$PAYLOAD_TITLE" '{title: $title}'` pattern. The previous example demonstrated a shell-injection vulnerability whenever event payload values contained shell-special or JSON-special characters (which they can, since payloads come from other plugins / events / GitOps reconciles).
  - The shared shell runner adds `clearTimeout` + idempotent `proc?.kill()` in `finally`, fixing a leaked event-loop timer in the integration shell provider's previous inline implementation.

  **TESTS**

  - New `core/backend-api/src/esm-script-runner.test.ts` covering `normaliseUserScript` + `rewriteHelperImports` across both healthcheck and integration helper-module names, including regex-metacharacter escape coverage.
  - The plugin-local `inline-script-normaliser.test.ts` was deleted; the same coverage (plus more) lives at the canonical location with the utility.
  - Integration TS provider console-logging tests updated: in the subprocess model, `console.warn` and `console.error` both write to stderr (Bun matches Node), so the provider forwards every stderr line to `logger.error`. `console.log({…})` uses Bun's native `util.inspect` format rather than `JSON.stringify`, so the JSON-logging test now asserts on substring presence instead of strict serialisation.

  2047 tests pass, lint + typecheck clean.

### Patch Changes

- a06b899: Dead-code audit cleanup and a small platform of shared notification helpers.

  **Removed (dead code)**

  - `core/backend/src/plugin-manager/deregistration-guard.ts` deleted. The exported `assertCanDeregister()` was never called and was a less-complete version of the dependents+isUninstallable checks already done inline by `previewUninstallOriginator` / `uninstallOriginator` in `plugin-manager-orchestrator.ts`.
  - `createMockQueueFactory` deprecated alias removed from `@checkstack/test-utils-backend`. Use `createMockQueueManager` directly.

  **New shared helpers**

  - `@checkstack/backend-api` now exports `requestTimeoutMs()` — a Zod field builder for outbound HTTP request timeouts (1s..60s, default 10s). Replaces hand-rolled `configNumber({}).min(1000).max(60_000).default(10_000)` in `integration-webhook-backend`, `integration-script-backend`, and `healthcheck-script-backend`'s inline collector.
  - `@checkstack/notification-common` now exports `SubjectStatusSchema` / `SubjectStatus`, mirroring the existing `ImportanceSchema`.
  - `@checkstack/notification-backend` now exports:
    - `SUBJECT_STATUS_EMOJI` / `IMPORTANCE_EMOJI` — the shared status / importance emoji maps that Discord, Slack, Teams, Webex and Telegram previously each redefined inline.
    - `postJson(opts)` — a timeout-bounded `fetch` wrapper that handles non-2xx logging and error mapping for webhook-style POSTs. Returns `{ ok: true, response } | { ok: false, error }`.

  **Migrated to shared helpers**

  - Discord, Slack, Gotify, Pushover notification backends now use `postJson`. Outer try/catch + per-plugin error mapping deleted (~140 LOC).
  - Discord, Slack, Teams, Telegram, Webex notification backends now use `IMPORTANCE_EMOJI`. Discord, Slack, Teams use `SUBJECT_STATUS_EMOJI`.
  - Teams, Webex, Backstage, Telegram kept their inline fetch/Bot logic: their error strings surface server response bodies to operators, or the transport isn't raw `fetch` (Telegram uses `grammy`'s `Bot`).

  **API surface tightening**

  - Per-plugin test-only re-exports in 6 notification backends (Pushover, Gotify, Backstage, Slack, Discord, Teams) and the `CertificateInfo` interface in `healthcheck-tls-backend/strategy.ts` are now JSDoc-tagged `@internal`. No behaviour change; signals that downstream consumers must not depend on them.

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/integration-backend@0.1.28

## 0.2.18

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/integration-backend@0.1.27

## 0.2.17

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/integration-backend@0.1.26

## 0.2.16

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/integration-backend@0.1.25
  - @checkstack/integration-common@0.3.2

## 0.2.15

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1
  - @checkstack/integration-backend@0.1.24

## 0.2.14

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/integration-backend@0.1.23
  - @checkstack/common@0.7.0
  - @checkstack/integration-common@0.3.0

## 0.2.13

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/backend-api@0.14.0

## 0.2.12

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/integration-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/integration-backend@0.1.21

## 0.2.11

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/integration-backend@0.1.20
  - @checkstack/integration-common@0.2.9

## 0.2.10

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/integration-backend@0.1.19

## 0.2.9

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/integration-backend@0.1.18
  - @checkstack/integration-common@0.2.8

## 0.2.8

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/integration-backend@0.1.17

## 0.2.7

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/integration-backend@0.1.16

## 0.2.6

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/integration-backend@0.1.15

## 0.2.5

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/integration-backend@0.1.14

## 0.2.4

### Patch Changes

- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/integration-backend@0.1.13
  - @checkstack/integration-common@0.2.7

## 0.2.3

### Patch Changes

- d73e33e: Security fix: Prevent environment variable leakage to child processes.
- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12
  - @checkstack/integration-common@0.2.6

## 0.2.2

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/integration-backend@0.1.11

## 0.2.1

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/integration-backend@0.1.10

## 0.2.0

### Minor Changes

- f676e11: Add script execution support and migrate CodeEditor to Monaco

  **Integration providers** (`@checkstack/integration-script-backend`):

  - **Script** - Execute TypeScript/JavaScript with context object
  - **Bash** - Execute shell scripts with environment variables ($EVENT*ID, $PAYLOAD*\*)

  **Health check collectors** (`@checkstack/healthcheck-script-backend`):

  - **InlineScriptCollector** - Run TypeScript directly for health checks
  - **ExecuteCollector** - Bash syntax highlighting for command field

  **CodeEditor migration to Monaco** (`@checkstack/ui`):

  - Replaced CodeMirror with Monaco Editor (VS Code's editor)
  - Full TypeScript/JavaScript IntelliSense with custom type definitions
  - Added `generateTypeDefinitions()` for JSON Schema → TypeScript conversion
  - Removed all CodeMirror dependencies

  **Type updates** (`@checkstack/common`):

  - Added `javascript`, `typescript`, and `bash` to `EditorType` union

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5
