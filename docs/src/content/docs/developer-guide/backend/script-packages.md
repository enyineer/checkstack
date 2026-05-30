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
- `@checkstack/script-packages-frontend` - the admin Settings page and the `useScriptPackageTypes()` editor hook.

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

The SRI `integrity` key hashes the upstream npm tarball, not the distributed blob (our gzip tar of the Bun cache entry), so it can't verify the transported bytes. Each manifest entry therefore carries a `blobSha256` (sha-256 of the blob, computed at publish time), and every host verifies it before extraction (on both the core shared-store path and the satellite WS path). A mismatch errors clearly and refuses to materialize the blob. The field is optional for backward compatibility: entries published before it skip verification until a re-install regenerates the manifest. Extraction also rejects archive entries with absolute paths or `..` components (zip-slip).

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

## Data directory

The on-disk package store lives at `<dataDir>/script-packages/`, where `dataDir` is `CHECKSTACK_DATA_DIR` (defaulting to `.data/` under the backend). The cold-start cost (a fresh host pulls the full blob set once) is accepted and bounded by the size cap; a persistent cache volume is an optional deployment-side optimization, not required.

## Registry auth

The registry auth token is encrypted at rest (AES-256-GCM via the platform `encrypt`/`decrypt`) and stored as the `auth_secret_ref`. It is decrypted only at install time when rendering `.npmrc`, and is never returned to the client (the DTO carries only `hasAuthToken`) or logged.
