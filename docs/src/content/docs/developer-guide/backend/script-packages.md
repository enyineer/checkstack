---
title: "Script packages (npm in script editors)"
description: "How the central backend curates, resolves, distributes, and materializes a global allowlist of npm packages so user scripts can import them in every editor context."
---

Script packages let an admin curate a global, pinned allowlist of npm packages that become importable in every script editor (automation `run_script` / `run_shell`, healthcheck collectors, and any future script field). The central backend is the only host that talks to the registry; it resolves the tree, publishes per-package content-addressed blobs, and every host that runs a script reconciles to the desired lockfile by delta-syncing only the blobs it lacks.

## Packages

- `@checkstack/script-packages-common` - schemas, oRPC contract, the `script-packages.manage` / `script-packages.read` access rules, and the `script-packages.changed` hook id/payload.
- `@checkstack/script-packages-backend` - data model, install/resolve service, elected installer, blob-store extension point, and the per-host reconciler.
- `@checkstack/script-packages-store-postgres` - default blob store (zero extra infra).
- `@checkstack/script-packages-store-s3` - S3-compatible blob store (preferred when configured).
- `@checkstack/script-packages-frontend` - the admin Settings page and the `useScriptPackageTypeAcquisition()` editor hook.

## Allowlist and resolution

The allowlist is admin-only and pinned to exact versions (`name@exact-version`). On `installNow`, exactly one core instance is elected via a Postgres advisory lock, writes a generated `package.json` + `.npmrc` + a `bunfig.toml` that disables Bun auto-install, runs `bun install` against the (possibly internal) registry, parses `bun.lock` for the manifest, and publishes each package's Bun cache entry as a content-addressed blob.

```ts
import { performInstall } from "@checkstack/script-packages-backend";

const result = await performInstall({
  packages: [{ name: "lodash", version: "4.17.21", enabled: true }],
  ignoreScripts: true, // default-ON RCE mitigation
  resolver,
  blobStore,
  blobIndex,
});
// result.lockfileHash is the durable desired state every host reconciles to.
```

> [!IMPORTANT]
> `--ignore-scripts` is a default-on admin toggle. It is both the RCE mitigation (postinstall is the attack vector) and the size guardrail. Heavy / native / postinstall packages are an explicit non-goal: they will not work and their footprint defeats fan-out. The admin UI enforces a configurable total-size cap (warn at 150 MB, block at 300 MB).

## Distribution and reconciliation

The unit of distribution is the per-package content-addressed blob (a gzip tar of the Bun cache entry, keyed by integrity). A host reconciles by diffing the desired manifest against its local cache, pulling only the missing blobs, then running `bun install --offline` to materialize `node_modules` into a versioned `trees/<lockfileHash>/` dir and atomically flipping the `current` symlink.

```ts
import { reconcileToHash } from "@checkstack/script-packages-backend";

await reconcileToHash({ lockfileHash, manifest, deps });
// Idempotent: a host already at lockfileHash is a no-op.
```

Reconciliation is triggered on the `script-packages.changed` broadcast hook (every core instance subscribes in `mode: "broadcast"`), and again on startup as a backstop, so a pod that missed the broadcast still converges. The runner's resolution root points at `<store>/current`; new runs follow the new symlink while in-flight runs keep their old tree.

### Blob integrity

The SRI `integrity` key hashes the upstream npm tarball, not the distributed blob (our gzip tar of the Bun cache entry), so it can't verify the transported bytes. Each manifest entry therefore carries a `blobSha256` (sha-256 of the blob, computed at publish time), and every host verifies it before extraction (on both the core shared-store path and the satellite WS path). A mismatch errors clearly and refuses to materialize the blob. The field is optional for backward compatibility: entries published before it skip verification until a re-install regenerates the manifest. Extraction also rejects archive entries with absolute paths or `..` components (zip-slip), and rejects any non-regular entry - symlinks, hardlinks, devices - so a link with a safe name but an escaping target (for example `-> /etc` or `-> ../../..`) can't be written through by a later entry to escape the target dir. Reconstructed Bun-cache trees are plain files and dirs, so links are never expected.

## Runner resolution root

The shared ESM runner gained an optional `resolutionRoot`:

```ts
await defaultEsmScriptRunner.run({
  script,
  context,
  timeoutMs,
  resolutionRoot, // <store>/current - module resolution walks up to its node_modules
});
```

When unset it falls back to `os.tmpdir()` (no `node_modules` visible) - fully backward compatible. Execution isolation is unchanged: the subprocess still only receives `SAFE_ENV_VARS`, so packages cannot read backend secrets. The new risk is purely at install time, mitigated by admin-only + pinned versions + `--ignore-scripts`.

Every user-script execution call site resolves the root per run and passes it to the runner: the `run_script` automation action, the inline-script health-check collector (on core and satellites), and the in-UI `testScript` / `testCollectorScript` endpoints (so testing matches runtime). The root is resolved from the local store - `resolveResolutionRootFromStore(<dataDir>/script-packages)` returns `ready` (points the runner at `current`) when a tree is materialized, else `none` (unset). The `run_script` action additionally surfaces a clear `notReady` error when packages are configured but the desired hash isn't materialized yet. Shell scripts (`run_shell`, the shell collector) run via `sh -c` and don't resolve npm modules, so they get no resolution root.

> [!IMPORTANT]
> The runner ALWAYS writes a per-run `bunfig.toml` with `[install] auto = "disable"` and runs with that dir as CWD. Without it, Bun silently auto-installs any imported package from the registry (verified), defeating the managed allowlist. With it, an `import` resolves only against the reconciled `current/node_modules` (when set) and otherwise fails fast - the degradation the feature requires, independent of whether a resolution root is set.

## Satellite distribution

Satellites are not on the backend event bus, so each core instance's `script-packages.changed` broadcast handler pushes a `refresh_script_packages { lockfileHash }` control message to its currently connected satellites over the existing WS channel. The desired hash is also carried in the `authenticated` / `config_updated` assignment payloads as the durable convergence backstop: a satellite that was offline (or missed the push) reconciles on its next connect regardless.

A satellite reconciles with the same reconciler the core instances use (`reconcileToHash` + `createReconcileFsDeps`), differing only in transport - it pulls the manifest and blobs from core over the WS channel, never from the registry. It diffs the desired manifest against its local cache, pulls only the missing blobs (delta), materializes via `bun install --offline`, and atomically flips `current`. After each attempt it reports its sync state back to core, which persists it for the admin UI. Reconciles are serialized, coalesced to the latest desired hash, and idempotent (already-at-hash is a no-op).

### Protocol messages

The contract lives in `@checkstack/satellite-common`'s protocol. Script-package distribution adds these messages over the existing authenticated WS channel:

| Direction | Message | Purpose |
| --- | --- | --- |
| core to satellite | `authenticated` / `config_updated` (`scriptPackagesLockfileHash`) | Carry the desired lockfile hash with assignments - the durable convergence backstop. Optional for version-skew safety. |
| core to satellite | `refresh_script_packages { lockfileHash }` | Best-effort push telling connected satellites to reconcile to a new hash. |
| satellite to core | `request_script_package_manifest { lockfileHash }` | Ask core for the manifest to diff against the local cache. |
| core to satellite | `script_package_manifest { lockfileHash, entries }` | Reply with the manifest entries. |
| satellite to core | `request_script_package_blob { integrity }` | Ask core for one content-addressed blob. |
| core to satellite | `script_package_blob { integrity, data }` | Reply with the blob bytes (base64), or `null` if core lacks it. |
| satellite to core | `script_package_sync_state { lockfileHash, status, errorMessage? }` | Report reconcile state; core persists it for the admin UI. |

> [!NOTE]
> Blobs travel over the authenticated WS channel as base64 rather than a separate satellite HTTP endpoint, so there is no extra satellite auth surface. (The `getManifest` / `downloadBlob` RPC endpoints still exist for horizontally-scaled core instances, which share the blob store directly.) This is bounded by the same size cap and lightweight-pure-JS regime as core.

Graceful degradation: a satellite that can't reconcile (a blob fetch fails) records an `error` sync state and does not materialize a tree, so any package import fails clearly rather than hitting the registry or resolving a stale tree. Bun auto-install stays disabled (`bunfig.toml [install] auto = "disable"`) on every materialized tree.

## Storage backends

Blob persistence is an extension point. Two stores ship as plugins; the active backend is selected in `script_package_storage_config` (admin UI). Because blobs are content-addressed, the integrity hash is the stable identity across backends.

- Postgres (default): blobs stored base64-encoded; no extra infrastructure.
- S3: configured via env: `CHECKSTACK_SCRIPT_PACKAGES_S3_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_FORCE_PATH_STYLE`. Credentials never touch the database.

### Migrating between backends

`migrateStorage({ target })` copies every blob from the active backend to the target, then atomically flips the active backend. It runs in the background; the admin UI polls `getStorageMigrationState` for progress (`migratedCount`, status, error).

```ts
import { runStorageMigration } from "@checkstack/script-packages-backend";

// Copies each blob, verifies the copy, flips the active backend.
await runStorageMigration({ blobIndex, storage, getStore, activeBackend, target });
```

Properties:

- **Verified copies.** Each blob is read back from the target and compared byte-for-byte against the source (a SHA-256 of the copy vs the source). A mismatch aborts the migration cleanly - the active backend is left untouched and the status becomes `error`. (The SRI `integrity` key hashes the npm tarball, not our archive bytes, so verification checks the copy is faithful rather than re-deriving the SRI.)
- **Resumable.** The per-blob `backend` column is flipped only after a verified copy, so a crash leaves a well-defined partial state. A re-run derives its work set from the index (blobs not yet on the target) and skips ones already migrated. A migration that crashed mid-flight (status stuck at `migrating`) is automatically relaunched on startup under the installer advisory lock, so it can't permanently wedge installs.
- **No downtime.** During migration the active backend is still the source and reads fall back across both backends (the blob-store registry's `readWithFallback`), so script execution never breaks.
- **Atomic flip.** The active backend changes in a single update at the end, so a reader never sees "completed but old backend".
- **Mutually exclusive with installs.** Migration and `installNow` share the installer advisory lock; `installNow` is refused while a migration is in flight and vice-versa.
- **Optional source GC.** With `gcSource`, each blob is deleted from the source after its verified copy.

## Garbage collection

Two things accumulate as the allowlist changes over time and are reclaimed by GC: content-addressed blobs in the shared store (Postgres / S3) and per-host materialized `trees/<lockfileHash>/` dirs on every host's local disk.

### Blob GC (shared storage)

`gcBlobs` prunes blobs no longer referenced by any **retained** lockfile manifest. It runs automatically on a daily schedule (`queueManager.scheduleRecurring`) and is also admin-triggerable via the `gcBlobs` RPC (manage-gated); both return a `BlobGcSummary` (`candidates`, `deleted`, `keptWithinGrace`, `bytesReclaimed`). The settings UI surfaces last-run and total-reclaimed figures.

```ts
import { createBlobGcTrigger } from "@checkstack/script-packages-backend";

const triggerBlobGc = createBlobGcTrigger({
  installerLock,
  blobStores,
  loadCurrent,
  recentHistory,
  pruneHistory,
  listBlobs,
  removeBlobRow,
  isBusy,
  recordRun,
  // retainPrevious defaults to 1, graceMs to 24h
});
const summary = await triggerBlobGc();
```

Safety guards (every deletion is provably safe; when in doubt, retain):

- **Retained set.** The current desired `lockfileHash`'s manifest PLUS the previous `N` hashes' manifests (`DEFAULT_BLOB_GC_RETAIN_PREVIOUS`, default `1`, for rollback / in-flight reconciles toward a just-superseded hash). The installer records each successful manifest in `script_package_lockfile_history` so this set is computable. A blob whose integrity is not in the union of those manifests is a candidate. The live install-state manifest is also unioned in, in case history hasn't caught up.
- **Grace window.** A candidate is deleted only when it is older than `DEFAULT_BLOB_GC_GRACE_MS` (default 24h, keyed on `script_package_blob.created_at`), so a pod / satellite mid-reconcile toward a just-superseded hash can still pull a blob that was just dropped from the retained set.
- **Mutual exclusion.** The trigger holds the installer-election advisory lock for the whole pass, so GC is mutually exclusive with `installNow` and `migrateStorage` (which contend for the same lock). On top of the lock, the pass re-checks an `isBusy()` guard (install or migration in flight) before deleting.
- **Per-backend routing.** Each blob's bytes are deleted from the backend recorded in its index row, then the index row is removed. A single failed delete is logged and skipped (retained for the next pass), never aborting the whole pass.

### Tree GC (host-local disk)

After a successful symlink flip (and on every reconcile), each host sweeps its own `trees/` dir, deleting non-current tree dirs older than a grace window. `current`'s target is never a candidate.

- **Active-run safety via conservative grace.** The runner pins an in-flight run to the tree it started on (its `resolutionRoot` dereferences `current` at run start), so deleting a non-current tree with a live run would break it. There is no robust cross-process refcount available (runs are throwaway Bun subprocesses with no reliable release signal, and a crashed run would leak a refcount), so the sweep uses a grace window (`DEFAULT_TREE_GC_GRACE_MS`, default 1h) chosen to comfortably exceed the longest possible run timeout. A tree only becomes eligible once it has been non-current longer than any run could still be using it.
- **Grace is keyed on retirement time, not dir mtime.** A tree's mtime reflects when it was materialized, not when it stopped being `current`. A tree that served as `current` for days has an ancient mtime, so keying the grace window on mtime would make it eligible for deletion the instant it is superseded - and the sweep runs right after a flip, so it would delete a tree an in-flight run is still pinned to. Instead, the atomic flip stamps a `.retired-at` sentinel (epoch ms) into the superseded tree's dir, and the grace window is measured from that timestamp. A non-current tree with no marker (for example one superseded before this scheme existed, or where the flip-time write failed) is retained and lazily back-filled with the current time, so it ages out on a later sweep instead of leaking - but is never deleted on a missing signal.
- **Shared on core and satellites.** The sweep lives in the materialize/flip adapter (`reconcile-fs.ts`), so it applies identically to core pods and satellites. It is best-effort: a sweep failure never fails a reconcile (the new tree is already live).

## Data directory

The on-disk package store lives at `<dataDir>/script-packages/`, where `dataDir` is `CHECKSTACK_DATA_DIR` (defaulting to `.data/` under the backend). The cold-start cost (a fresh host pulls the full blob set once) is accepted and bounded by the size cap; a persistent cache volume is an optional deployment-side optimization, not required.

## Registry auth

The registry auth token is encrypted at rest (AES-256-GCM via the platform `encrypt`/`decrypt`) and stored as the `auth_secret_ref`. It is decrypted only at install time when rendering `.npmrc`, and is never returned to the client (the DTO carries only `hasAuthToken`) or logged.

The same registry + token resolution is shared by the install path and the live autocomplete RPCs via `resolveRegistryRequestConfig` (registry config → `authSecretRef` → token store), so the two can never drift on how they talk to the registry.

## Live package autocomplete

The `searchPackages` and `getPackageVersions` RPCs (both `manage`-gated) are backend-proxied npm registry lookups powering the "Allowed packages" form's name/version autocomplete. They MUST run server-side: the configured registry can be private with a server-side-only token (the client only ever sees `hasAuthToken`), and browsers can't reach arbitrary registries due to CORS.

`registry-client.ts` is a small `fetch`-based client that:

- Sends `Authorization: Bearer <token>` only when a token is configured, with an AbortController timeout (~5s) and a capped `size`. Results use the registry's own `-/v1/search` relevance ranking; the endpoint's `popularity` / `quality` / `maintenance` scoring-weight params are intentionally not applied (empirically a no-op on the public npm registry).
- Validates every registry response with zod (`-/v1/search` objects for search; `versions` keys + `dist-tags` for the packument) and maps to the DTO shape. Output `version`/`versions` are relaxed to plain strings so valid-but-unusual versions surface as suggestions; strict `PackageVersionSchema` validation still applies on `addPackage`.
- Selects the scoped registry for a `@scope/x` name from `scopedRegistries` (else the base registry), mirroring the npmrc renderer's scope keys, and URL-encodes the packument path (`@scope%2Fx`).
- Sorts versions newest-first with a tolerant semver-descending comparator: an unparseable version sorts last rather than discarding the whole response.
- Never includes the auth token in any error message; failures throw a typed `RegistryClientError` the router maps to `BAD_GATEWAY`.

A small in-memory TTL cache (~45s, keyed by registry URL + query / name) is a **best-effort, pod-local read cache only** - explicitly not a source of truth (per the state-and-scale rule). Search and version lookups are non-authoritative reads, so a cache miss on another pod simply re-fetches and pod-local divergence is harmless.

## Editor IntelliSense (lazy type acquisition)

Script editors get real autocomplete for installed packages via lazy Automatic Type Acquisition (ATA): the editor fetches a package's declaration files only when an `import`/`require` for it appears in the buffer, and TypeScript's own resolution drives completions. This is why `import { debounce } from "lodash"` autocompletes even though `lodash` ships no own types and the user never imports `@types/lodash`.

### Tree-driven closure extractor

`resolvePackageTypeClosure({ nodeModulesDir, specifier })` resolves the declaration closure for one bare specifier against the materialized tree at `<storeRoot>/trees/<lockfileHash>/node_modules`, mirroring TypeScript's own resolution rather than assuming a `@types` mapping:

- **Own types** - read `package.json` `types`/`typings` and the `exports` map's `types` conditions, falling back to `index.d.ts`. Bundled-types packages (`zod`, `dayjs`) resolve here and have no `@types` companion.
- **`@types` companion** - the DefinitelyTyped dir is computed by the mangling rule (unscoped `lodash` -> `@types/lodash`; scoped `@scope/name` -> `@types/scope__name`, e.g. `@babel/core` -> `@types/babel__core`) and included **only if it actually exists** in the tree.
- Either, both, or neither may be present. Neither yields a graceful `notFound` closure, never a throw.
- Triple-slash `/// <reference path|types>` directives and relative `import`/`require` references are followed (lodash fans out across ~700 files via `/// <reference path>`), as are cross-package `@types` references. Each included package's `package.json` is part of the closure. Files are returned **unwrapped** - no `declare module` envelope - at their real `node_modules/...` paths.
- The closure is bounded by a total-byte ceiling (well above lodash's ~866 KB). If anything is dropped it sets `truncated: true` (surfaced + logged) rather than silently capping.

### Cacheable HTTP route

The closure is served from a raw, HTTP-cacheable route - **not** an oRPC procedure - because oRPC responses in this backend can't set custom HTTP response headers, and the design wants browser-level caching keyed to the install:

```text
GET /api/script-packages/types/:lockfileHash/:encodedSpecifier
Cache-Control: private, max-age=<1y>, immutable
```

The path carries the current `lockfileHash`, so a `(hash, specifier)` closure is immutable for the life of the install; a new install changes the hash and the editor requests a fresh URL. `private` because the registry (and types) may be private. The handler is auth-gated by `script-packages.read` (it authenticates the request and checks the same global access the oRPC read endpoints use), returns `409` on a stale hash so the client refetches install state, and never caches a miss. Path build/parse is a shared, unit-tested contract (`buildTypeAcquisitionPath` / `parseTypeAcquisitionPath`).

### Frontend wiring

`@checkstack/ui`'s `CodeEditor` is plugin-agnostic: it accepts an injected `acquireTypes(specifier)` resolver plus an `acquireResetKey`. On a debounced buffer change it parses bare specifiers (a pure, unit-tested function that ignores relative paths, `node:`/`bun` built-ins, and the `context` global), then for each NEW package calls `acquireTypes` and registers the returned files via `addExtraLib` at `file:///node_modules/...`. Compiler options (`moduleResolution: NodeJs`, `baseUrl: "file:///"`, `typeRoots`) make a bare import resolve to its `@types` companion when it has no own types. The acquired-set is shared across editors and resets when `acquireResetKey` (the lockfile hash) changes. The generated `context` ambient global coexists unchanged.

`@checkstack/script-packages-frontend`'s `useScriptPackageTypeAcquisition()` provides the concrete resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as the reset key; the automation Run Script editor and healthcheck collector editors pass both into `DynamicForm`.

### Import-specifier name completion

Lazy ATA can only register a package's types AFTER its name is in the buffer, so while the user is still typing the specifier (`import {} from "lod"`) no module exists yet and the TS worker offers nothing. The `CodeEditor` closes that gap with a dedicated Monaco completion provider (registered once per `typescript`/`javascript`, scoped to the model, disposed on unmount) driven by an injected `importablePackages?: string[]`:

- It fires ONLY when the cursor is inside an import/require module-specifier string, detected by the pure, unit-tested `importSpecifierCompletionContext(lineUpToCursor)` (handles `from "…"`, bare `import "…"`, `require("…")`, dynamic `import("…")`; returns the partial specifier + replace range, or null once the string is closed / outside an import). Trigger characters are `"`, `'`, `/`, and `:` (to advance into a `node:`/`bun:` builtin); manual invoke also works.
- Items are `kind: Module`, insert the bare name into the string range (without touching the quotes), and augment - never replace - the TS worker's own completions. Selecting `lodash` then lets the ATA loop load its `@types/lodash` closure so members complete.

The suggestion list merges two sources (deduped + sorted via the pure `mergeImportCompletionEntries`, each labelled by `detail`):

- **Always-available runtime built-ins** - Node and Bun modules (`node:fs`, bare `fs`, `bun`, `bun:test`, ...), importable in the sandbox regardless of the allowlist. The name list is DERIVED authoritatively at build time from the bundled `@types/node` + `bun-types` declarations: every importable built-in is a top-level `declare module "<spec>"`, so `scripts/generate-stdlib-types.ts` parses those names (pure `extractBuiltinModuleSpecifiers`, dropping wildcard / asset-glob shims) and emits `generated/builtin-modules.json` next to the type bundle. No hand-maintained list - it tracks the bundled types automatically. Their types are already loaded ambiently, so completing one needs no acquisition.
- **Installed allowlist packages** - supplied by `useScriptPackageTypeAcquisition().importablePackages`, derived from the installed manifest (what is resolvable at runtime) with `@types/*` companions excluded via the pure `importablePackageNames` helper - you import `lodash`, never `@types/lodash`. Selecting one drives the ATA loop above.
