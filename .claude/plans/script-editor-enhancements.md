# Script editor enhancements — npm packages + in-UI testing

> **Status:** planned (not started)
> **Branch:** TBD (off `main`)
> **Original ask:**
> 1. Allow installing npm packages that are available in **all** ScriptEditor contexts.
> 2. Add functionality to **test** shell and TypeScript scripts directly in the UI with good DX.
> 3. Both features must be applied in **every** UI component where users write scripts.

This document is a self-contained handoff. A future session should be able to
pick up from here without prior chat context.

---

## 1. Locked decisions (from design Q&A)

- **npm governance:** Admin-only **global allowlist**, pinned versions (`name@exact-version`).
  One shared set, visible in every script editor. No arbitrary per-user imports.
- **Registry reachability / satellites:** The central backend is the **only** host that
  talks to the npm registry (which may be an internal Artifactory / proxy unreachable
  from satellites on other networks). The backend **resolves + bundles** the package tree
  and **distributes the bundle to satellites** over the existing satellite channel.
  Satellites never run `npm install` against a registry. Until a satellite has synced the
  bundle, satellite-run scripts that import a package fail with a clear, actionable error.
- **Test-context source:** **Editable sample JSON, auto-seeded** from the same schemas that
  drive IntelliSense, **plus replay from a real run** for debugging.

---

## 2. Current-state facts (verified in repo)

- **Single runner per language**, both in `@checkstack/backend-api`:
  - TS/JS: [`defaultEsmScriptRunner`](../../core/backend-api/src/esm-script-runner.ts) — fresh **Bun subprocess** in a throwaway `mkdtemp` dir under `os.tmpdir()`, env scrubbed to `SAFE_ENV_VARS`, **no `node_modules`** (isolation is deliberate — scripts must not see backend secrets). Already supports a virtual helper-module rewrite (`@checkstack/integration` / `@checkstack/healthcheck`).
  - Shell: `defaultShellScriptRunner` — `sh -c`, same env scrubbing.
- **Script-running call sites:**
  - Automations: `run_shell` / `run_script` in [`integration-script-backend/src/automations.ts`](../../plugins/integration-script-backend/src/automations.ts). Shell run-context flattened to `CHECKSTACK_*` env via `flattenScopeToShellEnv` ([`script-env.ts`](../../plugins/integration-script-backend/src/script-env.ts)). **Central backend only.**
  - Healthchecks: inline TS collector + shell collector in [`healthcheck-script-backend/src/`](../../plugins/healthcheck-script-backend/src/). **Runs on central backend AND on remote satellites** (satellite assignment in [`satellite-common/src/protocol.ts`](../../core/satellite-common/src/protocol.ts), ingested at [`healthcheck-backend/src/router.ts:339`](../../core/healthcheck-backend/src/router.ts)).
- **One shared editor:** every script field funnels through [`CodeEditor`](../../core/ui/src/components/CodeEditor/) → `MultiTypeEditorField` / `TemplateInput` → `DynamicForm`. So a single change in this chain reaches automations + healthchecks + any future script field. **This is the lever for requirement #3.**
- **IntelliSense `.d.ts`** is generated per-context (`generateAutomationContextTypes` in [`automation-frontend/src/script-context.ts`](../../core/automation-frontend/src/script-context.ts); `healthcheckScriptContext` in [`ui/src/components/CodeEditor/scriptContext.ts`](../../core/ui/src/components/CodeEditor/scriptContext.ts)) and threaded `DynamicForm → CodeEditor → Monaco addExtraLib`.
- **No test/preview/dry-run endpoint exists.** Closest are `automationContract.renderTemplate` (sample-context template render) and `manualRun` (runs a whole automation). The renderTemplate sample-context pattern is the model to copy for test-context seeding.

---

## 3. Feature 1 — npm packages in all script contexts

### 3.1 New packages

- `core/script-packages-common` — zod schemas (`PackageSpec`, `RegistryConfig`, storage config, install/sync/migration state), oRPC contract, the `script-packages.changed` hook id + payload schema (`{ lockfileHash }`), frontend signals, plugin-metadata, and access rules declaring the new **`script-packages.manage`** permission (decided — see §3.8).
- `core/script-packages-backend` — Drizzle schema, install/resolve service, on-disk package store + delta reconciler, registry config (auth via secret/connection-store, never echoed), `blobStoreExtensionPoint` + the `BlobStore` interface, storage-migration job, RPC router, satellite-distribution producer.
- `core/script-packages-store-postgres` — **default** `BlobStore` plugin (Postgres large-objects). Always available; selected when no S3 is configured.
- `core/script-packages-store-s3` — S3-compatible `BlobStore` plugin; selected when configured.
- `core/script-packages-frontend` — admin **Settings → Script Packages** page (allowlist, registry config, storage backend + migrate, per-host sync status); `useScriptPackageTypes()` hook for editor IntelliSense.

> After adding any `@checkstack/*` workspace dep, run `bun run typecheck:references:generate` and commit the tsconfig deltas.

### 3.2 The managed package store (central backend)

- A store dir under the backend data dir, e.g. `<dataDir>/script-packages/` containing a **generated** `package.json` (deps = enabled allowlist), `bun.lock`, and `node_modules`.
- **Install** = backend writes `.npmrc` from `RegistryConfig`, runs `bun install` (pinned → deterministic) which **hardlinks** packages from Bun's content-addressed cache (`~/.bun/install/cache`) into `node_modules` — the cache is the unit we distribute (see §3.4/§3.5), not the exploded tree.
- **`--ignore-scripts` is a default-ON admin toggle.** It is both the RCE mitigation (postinstall is the attack vector) and the natural size guardrail: packages that need postinstall to function (native builds, browser downloads like puppeteer/playwright) simply won't work — which keeps the multi-hundred-MB offenders out by design. See the non-goal in §3.6.
- **Runner resolution root:** change `defaultEsmScriptRunner` so the per-run temp dir is created **inside** the store (`<store>/.runs/<uuid>/`) instead of `os.tmpdir()`, so Bun/Node module resolution walks up to `<store>/node_modules`. Add an injectable `resolutionRoot?: string` option to `EsmScriptRunOptions` (defaults to today's `os.tmpdir()` behavior when unset → backward compatible, keeps existing tests green). Cleanup logic unchanged.
- **Security unchanged for execution:** subprocess still gets only `SAFE_ENV_VARS`; packages cannot read backend secrets. The new risk is purely at *install* time → mitigated by admin-only + pinned versions + `--ignore-scripts`.

### 3.3 Registry config (internal proxy / Artifactory)

- Stored: default registry URL, optional scoped registries (`@scope:registry=`), auth token (**stored as a secret** via the existing connection-store mechanism — never returned to the client in plaintext, never logged), `ignore_scripts` flag.
- Rendered to `.npmrc` in the store at install time.

### 3.4 Distribution model — content-addressed store + delta sync (NOT monolithic bundles)

A monolithic `node_modules` tarball pulled on every boot does **not** scale: even a modest set is tens of MB and tens of thousands of files; heavy sets are 100s of MB. We therefore distribute the way pnpm/Bun already work internally — a **content-addressed package store + delta sync** — so the marginal cost for a new host is "fetch only the package blobs it doesn't already have," not "fetch the whole tree."

- **Unit of distribution = per-package content-addressed blobs**, keyed by their integrity hash (the npm tarball / Bun-cache entry per `name@version`). Deduped across versions automatically. The durable artifact set is these blobs **plus** a small **lockfile manifest** (`lockfileHash` → ordered list of `{ name, version, integrity }`).
- **Reconcile = delta.** A host compares the desired manifest's blob set against what it already has locally and pulls **only the missing blobs**. Changing one package in the allowlist ships one blob, not a new full tree.
- **Materialize via hardlinks.** Once the blobs are in the local content-addressed cache, `bun install --offline` (or equivalent) reconstructs `node_modules` by hardlinking from the cache — near-zero byte copy, fast.
- **Transport:** blobs are compressed (zstd). Core serves them by hash via an HTTP artifact endpoint; **satellites pull blobs from core, never from the registry** — core is the caching proxy, which is what makes an Artifactory unreachable from the satellite's network a non-issue. **No satellite→registry traffic.**
- **Pluggable, migratable blob backend (decided).** Blob persistence is an **extension point** — `blobStoreExtensionPoint` with a `BlobStore` interface (`put(integrity, bytes)`, `get(integrity)`, `has(integrity)`, `delete(integrity)`, `list()`). Two built-in implementations ship as plugins: **`script-packages-store-postgres`** (large-objects — the **default** when no S3 is configured, zero extra infra) and **`script-packages-store-s3`** (S3-compatible — preferred when configured). The active backend is config-selected. Because blobs are content-addressed, the **integrity hash is the stable identity** across backends — only the locator differs.
- **Storage migration (decided).** An admin-triggered `migrateStorage({ target })` job **copies every blob** from the active backend to the target, verifies by integrity, then atomically flips the active backend and (optionally) GCs the source. During migration, reads fall back across both backends so script execution never breaks. Per-blob `backend` is tracked so a partially-migrated state is well-defined and resumable. Adding a third store later = ship another plugin implementing `BlobStore`; no schema change.
- **Disable Bun auto-install everywhere the runner executes.** Auto-install would otherwise silently try to fetch a missing package from the registry on import. Set `bunfig.toml` `[install] auto = "disable"` for both core-instance and satellite runners so a missing/unsynced package fails fast with our clear error instead of hanging on a (possibly unreachable) registry. Resolution is purely against the reconciled local store.

### 3.5 Persistence & reconciliation across core instances + satellites

The reconciled `node_modules` is a **rebuildable cache keyed by `lockfileHash`**; the durable source of truth is the blob set + manifest in shared storage. One unified reconciler serves every host that runs a script — N horizontally-scaled core instances and each satellite — differing only in transport (core: shared blob store; satellite: HTTP via core).

**One installer, many consumers (election):**
- Exactly one core instance performs the registry-facing `bun install` at a time, guarded by a Postgres **advisory lock** (the util the automation dispatch engine already uses) or a single-consumer **work-queue** job. Prevents N pods hammering Artifactory or producing divergent lockfiles.
- The installer resolves the pinned `package.json`, publishes any new package blobs to the **active blob store** (§3.4), records the `lockfileHash` + manifest in `script_package_install_state`, and emits the `script-packages.changed` hook (see *Refresh propagation* below).

**Refresh propagation (hook fan-out + satellite push):**
- Reuse the platform hook system (`createHook` — [`core/backend-api/src/hooks.ts`](../../core/backend-api/src/hooks.ts); subscription modes per the automation-platform plan). On successful install the installer emits `script-packages.changed { lockfileHash }`. Subscriptions register in `afterPluginsReady` (the only place `onHook` / `emitHook` are injected).
- **Core instances** subscribe with **`mode: "broadcast"`** so **every** instance receives it (not just one) and kicks its reconciler to delta-sync to the new `lockfileHash`. This is the deliberate inverse of installer-election, which uses an advisory lock / work-queue so exactly **one** instance installs.
- **Satellites** are not on the backend event bus. Each core instance's broadcast handler pushes a `RefreshScriptPackages { lockfileHash }` control message to its currently-connected satellites over the existing satellite WS channel ([`satellite-common/src/protocol.ts`](../../core/satellite-common/src/protocol.ts)); each satellite reconciles and reports `script_package_satellite_state` back.
- **Convergence backstop (don't rely on the hook alone):** the hook is best-effort liveness, not the delivery guarantee. The durable desired state is `lockfileHash` in `script_package_install_state`, and the satellite assignment payload also carries it (§3.4/§3.5). So a core pod that boots after the emit, or a satellite that was offline, converges on its next startup / heartbeat / assignment sync regardless of whether it ever saw the broadcast. Reconciliation is idempotent (already-at-`lockfileHash` → no-op).

**Per-host reconciliation (core pods AND satellites — identical logic):**
- On startup, on the `script-packages.changed` hook (core) / `RefreshScriptPackages` push (satellite), and on assignment-sync (backstop), the host diffs the desired manifest against its local content-addressed cache, pulls the missing blobs (delta), then hardlink-materializes `node_modules` into a **versioned dir** `<store>/trees/<lockfileHash>/` and **atomically flips** the symlink `<store>/current → trees/<lockfileHash>`.
- The runner's `resolutionRoot` (§3.2) points at `<store>/current`. New runs follow the new symlink; **in-flight runs keep resolving against the dir they started on** — a live tree is never mutated.
- **GC:** tree dirs not referenced by `current` (and with no active runs) and cache blobs no longer in any retained manifest are pruned after a grace period.

**Cold-start cost — accepted (decided):**
- A fresh host with an empty cache pulls the full blob set **once** (compressed) on first reconcile; a warm host pulls only the delta since it last synced. We **accept the cold pull** rather than build image-baking or mandate persistent volumes — it keeps the deployment story simple and is bounded by the size guardrail below. A persistent cache volume remains an optional, deployment-side optimization but is **not required** by the design.
- **Size guardrail (the thing that makes "accept cold pull" safe):** the admin UI shows the total resolved size and warns/blocks above a configurable threshold (see §3.6 non-goal). Combined with `--ignore-scripts`, this keeps the set in the "lightweight pure-JS" regime where even a full cold pull is cheap.

**Degradation:** a host that can't reconcile (blob fetch fails) errors clearly on any package import (`"npm packages not ready on this <core instance | satellite>"`) rather than silently resolving a stale tree or hitting an unreachable registry — reinforced by `auto = "disable"` (§3.4).

### 3.6 Editor DX — types for installed packages

- New RPC `listPackageTypes` → `{ name, version, dts }[]`, where `dts` is the rolled-up `.d.ts` from `node_modules/<pkg>` + `node_modules/@types/<pkg>`, wrapped as `declare module '<pkg>' { ... }`.
- `useScriptPackageTypes()` fetches once, merges into the `typeDefinitions` string already passed to `CodeEditor`. Because that prop flows through `DynamicForm`, every script field gets package IntelliSense for free. Packages without bundled types still run; they just lack autocomplete (acceptable v1).

> [!IMPORTANT]
> **Non-goal: heavy / native / postinstall packages.** This feature targets **lightweight, pure-JS packages** (utilities, parsers, SDK clients without native bindings). Packages that require a postinstall step to function — native compilation, or downloading binaries like puppeteer/playwright's Chromium — are explicitly **out of scope**: `--ignore-scripts` (default-on) means they won't work, and their multi-hundred-MB footprint defeats fan-out to many ephemeral hosts. The admin UI enforces a configurable total-size cap and surfaces the resolved size before install. We promise "curated lightweight packages everywhere," not "any npm package everywhere."

### 3.7 Data model (Drizzle, `script-packages-backend`)

- `script_packages(name pk, version, enabled, added_by, added_at, updated_at)`
- `script_package_registry_config(id pk /* singleton */, registry_url, scoped_registries jsonb, auth_secret_ref, ignore_scripts bool, updated_at)`
- `script_package_install_state(id pk /* singleton */, status, lockfile_hash /* desired */, manifest jsonb /* [{name,version,integrity}] */, total_size_bytes, last_installed_at, error_message)`
- `script_package_blob(integrity pk, name, version, backend /* "postgres" | "s3" | ... */, size_bytes, created_at)` — content-addressed blob index; `backend` records which `BlobStore` currently holds it (well-defined during migration); powers delta sync (download-by-integrity) and blob GC.
- `script_package_storage_config(id pk /* singleton */, active_backend, migration_status, migration_target, migrated_count, migration_error, updated_at)` — selected backend + in-flight migration state.
- `script_package_satellite_state(satellite_id pk, lockfile_hash /* active */, status, error_message, synced_at)`
- Core instances are **ephemeral and not individually addressable** — they reconcile to the desired `lockfile_hash` without per-pod DB rows; their active hash is surfaced via health/metrics, not persisted.

### 3.8 RPC contract

Management endpoints are gated by the new dedicated **`script-packages.manage`** permission (decided — installing packages is an install-time RCE/supply-chain vector, so it gets its own grantable permission rather than riding the general `manage` role). The read-only editor/runtime endpoints (`getManifest`, `downloadBlob`, `listPackageTypes`) are gated by the existing script-authoring access so editors and reconcilers can use them.

- **`script-packages.manage`-gated:** `listPackages`, `addPackage`, `removePackage`, `setPackageEnabled`, `getRegistryConfig`, `setRegistryConfig`, `installNow` (elects installer via advisory lock), `getStorageConfig`, `setStorageBackend`, `migrateStorage({ target })`, `getStorageMigrationState`, `listSatelliteSyncState`, `listCoreReconcileState`.
- **Authoring/runtime-gated:** `getInstallState` (desired `lockfileHash`, manifest, total size + status), `getManifest({ lockfileHash })` (delta diffing), `downloadBlob({ integrity })` (HTTP artifact stream for satellites + core), `listPackageTypes`.

---

## 4. Feature 2 — test scripts in the UI

### 4.1 Backend test endpoints (reuse existing runners)

- **Automation context** (add to `integration-script-backend` router):
  `testScript({ kind: 'typescript' | 'shell', script, context, env?, timeoutMs })`
  → `{ result?, stdout, stderr, exitCode?, durationMs, timedOut, error? }`.
  Internally calls the same runner the real action uses (with the managed `resolutionRoot` once Feature 1 lands), and `flattenScopeToShellEnv` for shell.
- **Healthcheck context** (add to `healthcheck-script-backend` router):
  `testCollectorScript({ kind, script, config, check?, system? })` with the healthcheck context shape.
- Both run on the **central backend** (always), enforce timeouts, and are gated by the same permission that already lets the user author/run that script (authoring an action already executes code — no new privilege). UI notes that real satellite runs may differ.

### 4.2 Replay from a real run

- Automation: reuse persisted scope — `automation_run_state.scope_snapshot` + step results — via `getRunScopeForReplay({ runId, actionPath })`. UI shows a run picker.
- Healthcheck: replay only if a prior execution's config/check/system is retrievable; **if the data isn't stored richly enough, v1 healthcheck replay is omitted and auto-seed is the only source** — to be confirmed during implementation (don't claim it works if the data isn't there).

### 4.3 Frontend — shared, appears under every script field

- New `@checkstack/ui` component `ScriptTestPanel`: **Run** button + collapsible results (stdout / stderr / return value / exit code / duration / error, with inline Monaco markers on a parseable failure line). Respect `usePerformance().isLowPower` for any animation.
- `ContextSampleEditor`: editable JSON, **auto-seeded** from schema (extend `generateAutomationContextTypes` / healthcheck context to also emit a sample object alongside the `.d.ts`). "Load from run" dropdown calls the replay RPC.
- **Wiring for requirement #3:** add an optional `x-script-testable` capability to the field metadata so `MultiTypeEditorField` renders `ScriptTestPanel` beneath any testable script field. Because automation action config and healthcheck collector config both render through `DynamicForm`, the test panel shows up in **both** automatically — and in any future script field for free.
- Add a Storybook story for `ScriptTestPanel` (UI-component convention).

---

## 5. Where both features converge on the shared editor

Single chain touched once, benefits everywhere:
[`CodeEditor`](../../core/ui/src/components/CodeEditor/) + `MultiTypeEditorField` + `DynamicForm/FormField`:
- augment `typeDefinitions` with package types (Feature 1),
- render `ScriptTestPanel` for `x-script-testable` fields (Feature 2).

Both are driven by props/metadata passed down from the feature pages, so automations + healthchecks + future script surfaces are covered without per-feature duplication.

---

## 6. Phasing

1. **Phase 1 — Feature 2, central-only.** Test endpoints (automation + healthcheck) + `ScriptTestPanel` + `ContextSampleEditor` (auto-seed) + automation replay. Fast value, no infra.
2. **Phase 2 — Feature 1, central store + core reconciliation.** Common/backend/frontend packages, data model, `script-packages.manage` permission, registry config (+ secret), `blobStoreExtensionPoint` + **postgres** (default) and **s3** store plugins, elected installer (advisory lock) → content-addressed blob store + lockfile manifest, `script-packages.changed` hook (`mode: "broadcast"`) driving the runner `resolutionRoot` + delta-sync/hardlink/atomic-symlink reconciler on every core instance, assignment-sync backstop, size-cap guardrail, `listPackageTypes` + editor wiring.
3. **Phase 3 — Feature 1, satellite distribution (in scope).** Reuse the same reconciler over the satellite transport: protocol extension carrying `lockfileHash` + a `RefreshScriptPackages` push message, `getManifest` + `downloadBlob` HTTP endpoints, `auto = "disable"`, per-satellite sync state + UI, graceful degradation.
4. **Phase 4 — Storage migration.** `migrateStorage` job (dual-backend read fallback, integrity-verified copy, atomic flip, resumable), backend-selector + migrate UI. Can overlap Phase 3 since it's storage-side only.
5. **Phase 5 — Docs + changesets + test hardening.**

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `npm install` postinstall = RCE on host | Admin-only, pinned versions, `--ignore-scripts` default ON |
| Satellite can't reach internal registry | Central resolves + publishes blobs; satellite pulls blobs from core only |
| node_modules is large (size + file count) | Per-package content-addressed blobs + delta sync + hardlink materialization; distribute deltas, not the exploded tree |
| Cold pod pays full pull on every autoscale | Accepted (decided); bounded by the size cap + `--ignore-scripts` lightweight-only regime; persistent cache volume is an optional deployment-side optimization |
| Storage backend migration mid-operation | Per-blob `backend` column + dual-backend read fallback during migration; integrity-verified copy; atomic active-backend flip; resumable from `migration_status` |
| Heavy / native / postinstall packages blow up fan-out | Explicit non-goal (§3.6): `--ignore-scripts` breaks them anyway + configurable total-size cap enforced in admin UI |
| Arbitrary package `.d.ts` quality varies | Best-effort types; runtime works regardless |
| Test endpoint runs real code centrally | Same privilege as authoring; hard timeout; manage-gated |
| Auth token leakage | Store as connection-store secret; never return/log plaintext |
| N instances install divergent trees / hammer registry | Single elected installer (advisory lock); all hosts reconcile to the one `lockfileHash` |
| A core pod / satellite misses the refresh broadcast | Hook is best-effort liveness; durable desired `lockfileHash` (install_state + assignment payload) drives idempotent convergence on next startup/heartbeat/sync |
| Stale UI after install completes | Frontend `script-packages.changed` signal invalidates the install-state + per-host status queries |
| Mutating node_modules under a live run | Versioned `trees/<lockfileHash>/` dirs + atomic `current` symlink swap; GC only after no active runs + grace period |

---

## 8. Cross-cutting obligations (per repo rules)

- Tests: TDD with `bun test` for runner-resolution-root change, install service, bundle hashing, scope-flatten reuse, replay scope reconstruction, and frontend panel logic.
- Docs (same PR): pages under `docs/src/content/docs/` for the new package-management surface, the test feature, and the satellite distribution contract; Storybook story for `ScriptTestPanel`.
- Changesets: minor bumps (beta), `BREAKING CHANGES:` notes if any contract changes; one per affected package.
- `bun run typecheck:references:generate` after dependency changes; `bun run typecheck` + `bun run lint` green before done. No `any`, no `eslint-disable`.

---

## 9. Open items to confirm during implementation

- Exact backend data-dir path / config key for the per-host package store (cold pull accepted; persistent cache volume optional).
- S3 plugin config keys (endpoint, bucket, region, credentials) and how the active-backend selection is configured (env vs admin UI vs both).
- Confirm `bun install --offline` reliably hardlink-materializes from a pre-seeded content-addressed cache in this Bun version (the delta-sync model depends on it); else fall back to seeding the full tree per `lockfileHash`.
- Decide the default total-size cap and where the warn-vs-block threshold sits.
- Confirm the advisory-lock util (from automation-backend) is reusable for installer election, or whether a work-queue single-consumer job is preferred.
- Connection-store API shape for storing the registry auth secret.
- Whether healthcheck executions persist enough context to support replay (else healthcheck replay deferred).
- Satellite transport: confirm an HTTP artifact route exists for `getManifest` / `downloadBlob` or add one.
- Migration-while-installing interaction: should `installNow` be blocked while a storage migration is in flight (likely yes)?
