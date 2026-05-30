import path from "node:path";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { internalSecretsRef } from "@checkstack/secrets-backend";
import {
  createRegistryTokenStore,
  migrateRegistryTokenToPlatform,
  type RegistryTokenStore,
} from "./registry-token";
import {
  pluginMetadata,
  scriptPackagesAccessRules,
  scriptPackagesContract,
  type BlobGcSummary,
} from "@checkstack/script-packages-common";
import type { PluginMetadata } from "@checkstack/common";
import { extractErrorMessage } from "@checkstack/common";
import { blobStoreExtensionPoint, type BlobStore } from "./blob-store";
import {
  createBlobStoreRegistry,
  type BlobStoreRegistry,
} from "./blob-store-registry";
import { resolveScriptPackagesDir, storePaths } from "./data-dir";
import {
  createPackageStore,
  createRegistryConfigStore,
  createSizeCapStore,
  createStorageConfigStore,
  createBlobIndexStore,
  createBlobGcStateStore,
  createLockfileHistoryStore,
} from "./stores";
import { createBlobGcTrigger } from "./blob-gc-runner";
import {
  createInstallStateStore,
  createInstallerLock,
} from "./install-state-store";
import { runInstallNow } from "./install-controller";
import {
  runStorageMigration,
  resumeCrashedMigration,
} from "./storage-migration";
import { createCentralResolver } from "./resolver";
import { createReconcileFsDeps } from "./reconcile-fs";
import { reconcileToHash } from "./reconciler";
import { scriptPackagesChangedHook } from "./hooks";
import { createScriptPackagesRouter } from "./router";
import * as schema from "./schema";

interface EnvStash {
  blobStores: BlobStoreRegistry;
  /**
   * Set in `afterPluginsReady` (the only phase where `emitHook` exists) and
   * called by the installer (wired in `init`) after a successful install.
   * Undefined until `afterPluginsReady` runs.
   */
  emitChanged?: (lockfileHash: string) => Promise<void>;
  /** Registry token store (internal secrets), set in `init`. */
  registryToken?: RegistryTokenStore;
  /**
   * Blob-GC trigger built in `init` (wires stores + the installer lock).
   * Reused by the scheduled recurring job registered in `afterPluginsReady`.
   */
  triggerBlobGc?: () => Promise<BlobGcSummary>;
}

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const blobStores = createBlobStoreRegistry();
    (env as unknown as EnvStash).blobStores = blobStores;

    env.registerAccessRules(scriptPackagesAccessRules);

    env.registerExtensionPoint(blobStoreExtensionPoint, {
      registerBlobStore: (store: BlobStore, _metadata: PluginMetadata) => {
        blobStores.register(store);
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        advisoryLock: coreServices.advisoryLock,
        queueManager: coreServices.queueManager,
        internalSecrets: internalSecretsRef,
      },
      init: async ({ logger, database, rpc, advisoryLock, internalSecrets }) => {
        logger.debug("📦 Initializing Script Packages Backend...");

        const storeRoot = resolveScriptPackagesDir();
        const packages = createPackageStore(database);
        const registry = createRegistryConfigStore(database);
        const storage = createStorageConfigStore(database);
        const registryToken = createRegistryTokenStore({ internalSecrets });
        (env as unknown as EnvStash).registryToken = registryToken;
        const sizeCap = createSizeCapStore(database);
        const blobIndex = createBlobIndexStore(database);
        const lockfileHistory = createLockfileHistoryStore(database);
        const blobGcState = createBlobGcStateStore(database);
        const installState = createInstallStateStore(database);
        const installerLock = createInstallerLock(advisoryLock);

        // Whether an install OR storage migration is in flight — the guard
        // both `triggerInstall` (migration check) and the blob GC use.
        const isBusy = async () => {
          const [cfg, state] = await Promise.all([
            storage.get(),
            installState.load(),
          ]);
          return (
            cfg.migrationStatus === "migrating" || state.status === "installing"
          );
        };

        // Blob GC trigger: shared by the admin `gcBlobs` RPC and the
        // scheduled recurring job. Holds the installer lock for the pass.
        const triggerBlobGc = createBlobGcTrigger({
          installerLock,
          blobStores,
          loadCurrent: async () => {
            const state = await installState.load();
            return {
              lockfileHash: state.lockfileHash,
              manifest: state.manifest,
            };
          },
          recentHistory: (limit) => lockfileHistory.recent(limit),
          pruneHistory: (keep) => lockfileHistory.pruneOlderThan(keep),
          listBlobs: () => blobIndex.listWithMeta(),
          removeBlobRow: (integrity) => blobIndex.remove(integrity),
          isBusy,
          recordRun: (r) => blobGcState.recordRun(r),
          logger,
        });
        (env as unknown as EnvStash).triggerBlobGc = triggerBlobGc;

        // Build the install orchestration. The resolver + active blob store
        // are resolved lazily at install time so config/registry changes
        // and store-plugin registration order don't matter.
        const triggerInstall = async () => {
          const reg = await registry.get();
          const secretRef = await registry.authSecretRef();
          let authToken: string | undefined;
          if (secretRef) {
            try {
              // Resolves the platform marker (internal secrets) or legacy
              // inline ciphertext transparently.
              authToken = await registryToken.resolve(secretRef);
            } catch (error) {
              logger.error(
                `Failed to resolve registry auth token: ${extractErrorMessage(error)}`,
              );
            }
          }
          const storageConfig = await storage.get();
          const activeBackend = storageConfig.activeBackend;
          if (!blobStores.has(activeBackend)) {
            return {
              started: false,
              reason: `Active blob store "${activeBackend}" is not registered.`,
            };
          }
          const store = blobStores.get(activeBackend);
          const paths = storePaths(storeRoot);
          const resolver = createCentralResolver({
            scratchDir: path.join(paths.root, ".install-scratch"),
            cacheDir: paths.cache,
            registry: {
              registryUrl: reg.registryUrl,
              scopedRegistries: reg.scopedRegistries,
              authToken,
            },
          });
          return runInstallNow({
            installState,
            installerLock,
            resolver,
            blobStore: {
              id: store.id,
              has: (i) => store.has(i),
              put: (i) => store.put(i),
            },
            blobIndex,
            loadInstallInputs: async () => ({
              packages: await packages.list(),
              ignoreScripts: reg.ignoreScripts,
            }),
            sizeCap: () => sizeCap.get(),
            isMigrationInFlight: async () => {
              const cfg = await storage.get();
              return cfg.migrationStatus === "migrating";
            },
            recordHistory: ({ lockfileHash, manifest }) =>
              lockfileHistory.record({ lockfileHash, manifest }),
            emitChanged: async ({ lockfileHash }) => {
              await (env as unknown as EnvStash).emitChanged?.(lockfileHash);
            },
            logger,
          });
        };

        // Kick a storage migration in the background. Mutually exclusive
        // with installs via the installer advisory lock (an install refuses
        // while a migration is in flight via `isMigrationInFlight`; this
        // refuses while an install holds the lock). Returns immediately;
        // progress is polled via `getStorageMigrationState`.
        const triggerMigration = async ({ target }: { target: string }) => {
          const current = await storage.get();
          if (current.migrationStatus === "migrating") {
            return {
              started: false,
              reason: "A storage migration is already in progress.",
            };
          }
          if (current.activeBackend === target) {
            return {
              started: false,
              reason: `"${target}" is already the active backend.`,
            };
          }
          if (!blobStores.has(target)) {
            return {
              started: false,
              reason: `Target blob store "${target}" is not registered.`,
            };
          }
          const lock = await installerLock.tryInstallerLock();
          if (!lock) {
            return {
              started: false,
              reason: "An install is in progress; try again once it completes.",
            };
          }
          // Run in the background; release the lock when done.
          void runStorageMigration({
            blobIndex,
            storage,
            getStore: (id) => blobStores.get(id),
            activeBackend: current.activeBackend,
            target,
            logger,
          }).finally(() => {
            void lock.release();
          });
          return { started: true };
        };

        const router = createScriptPackagesRouter({
          db: database,
          blobStores,
          storeRoot,
          logger,
          triggerInstall,
          triggerMigration,
          triggerBlobGc,
          registryToken,
        });
        rpc.registerRouter(router, scriptPackagesContract);

        logger.debug("✅ Script Packages Backend initialized.");
      },

      afterPluginsReady: async ({
        logger,
        database,
        onHook,
        emitHook,
        advisoryLock,
        queueManager,
      }) => {
        const stash = env as unknown as EnvStash;
        const blobStores = stash.blobStores;
        const storeRoot = resolveScriptPackagesDir();
        const installState = createInstallStateStore(database);
        const installerLock = createInstallerLock(advisoryLock);
        const storage = createStorageConfigStore(database);
        const blobIndex = createBlobIndexStore(database);

        // One-time, idempotent, parity-verified migration of a legacy
        // inline-ciphertext registry token onto the secrets platform's
        // internal secrets. No-op once migrated (column holds the marker)
        // or when no token is set. Never drops the legacy value until the
        // platform copy reads back identically.
        const registryToken = stash.registryToken;
        if (registryToken) {
          try {
            const registry = createRegistryConfigStore(database);
            const currentRef = await registry.authSecretRef();
            const reg = await registry.get();
            const outcome = await migrateRegistryTokenToPlatform({
              currentRef,
              tokenStore: registryToken,
              rewrite: async (marker) => {
                await registry.set({
                  registryUrl: reg.registryUrl,
                  scopedRegistries: reg.scopedRegistries,
                  ignoreScripts: reg.ignoreScripts,
                  authSecretRef: marker,
                });
              },
            });
            if (outcome === "migrated") {
              logger.debug(
                "🔐 Migrated script-package registry token onto the secrets platform.",
              );
            }
          } catch (error) {
            logger.error(
              `Registry-token migration failed: ${extractErrorMessage(error)}`,
            );
          }
        }

        // Startup backstop: resume a storage migration that crashed
        // mid-flight. A migration that died leaves `migrationStatus` stuck
        // at "migrating" — which blocks `installNow` AND makes
        // `triggerMigration` refuse to restart it — so nothing would ever
        // unwedge it without operator intervention. `runStorageMigration`
        // is idempotent + resumable (it re-derives its work set from the
        // index, skipping blobs already on the target), so we relaunch it
        // toward the recorded target under the installer-election lock so
        // exactly one pod resumes (and an in-flight install on another pod
        // is mutually excluded). Fire-and-forget; progress is polled.
        try {
          await resumeCrashedMigration({
            loadState: async () => {
              const cfg = await storage.get();
              return {
                migrationStatus: cfg.migrationStatus,
                migrationTarget: cfg.migrationTarget,
                activeBackend: cfg.activeBackend,
              };
            },
            tryLock: () => installerLock.tryInstallerLock(),
            runMigration: ({ target, activeBackend }) =>
              runStorageMigration({
                blobIndex,
                storage,
                getStore: (id) => blobStores.get(id),
                activeBackend,
                target,
                logger,
              }),
            logger,
          });
        } catch (error) {
          logger.error(
            `Storage-migration resume check failed: ${extractErrorMessage(error)}`,
          );
        }

        // Let the installer (in init's triggerInstall) emit the hook.
        stash.emitChanged = async (lockfileHash: string) => {
          await emitHook(scriptPackagesChangedHook, { lockfileHash });
        };

        // Reconcile this instance to a desired hash using the shared blob
        // store (delta pull from whichever backend holds each blob).
        const reconcileLocal = async (input: {
          lockfileHash: string;
          manifest: Awaited<ReturnType<typeof installState.load>>["manifest"];
        }) => {
          const deps = createReconcileFsDeps({
            storeRoot,
            logger,
            fetchBlob: async ({ integrity }) => {
              const cfg = await storage.get();
              const active = cfg.activeBackend;
              const res = await blobStores.readWithFallback({
                integrity,
                activeBackendId: active,
              });
              if (!res) {
                throw new Error(
                  `Blob ${integrity} not available in any backend.`,
                );
              }
              return res.bytes;
            },
          });
          await reconcileToHash({
            lockfileHash: input.lockfileHash,
            manifest: input.manifest,
            deps,
          });
        };

        // Broadcast subscription: EVERY core instance reconciles on change
        // (the deliberate inverse of installer-election). Best-effort
        // liveness; the startup backstop below guarantees convergence.
        onHook(
          scriptPackagesChangedHook,
          async ({ lockfileHash }) => {
            const state = await installState.load();
            if (state.lockfileHash === lockfileHash) {
              await reconcileLocal({ lockfileHash, manifest: state.manifest });
            }
          },
          { mode: "broadcast" },
        );

        // Startup backstop: converge to the durable desired hash regardless
        // of whether this pod ever saw the broadcast. Idempotent (no-op when
        // already at the hash).
        try {
          const state = await installState.load();
          if (state.lockfileHash && state.status === "ready") {
            await reconcileLocal({
              lockfileHash: state.lockfileHash,
              manifest: state.manifest,
            });
          }
        } catch (error) {
          logger.error(
            `Startup script-package reconcile failed: ${extractErrorMessage(error)}`,
          );
        }

        // Scheduled recurring blob GC: prune unreferenced, past-grace blobs
        // from the active/recorded backends so Postgres/S3 storage is
        // reclaimed. The trigger (built in `init`) holds the installer
        // advisory lock for the pass, so exactly one pod GCs at a time and it
        // is mutually exclusive with installs / migrations. Runs daily; the
        // grace window (default 24h) makes a once-a-day cadence safe.
        const triggerBlobGc = stash.triggerBlobGc;
        if (triggerBlobGc) {
          try {
            const gcQueue = queueManager.getQueue<Record<string, never>>(
              "script-packages-blob-gc",
            );
            await gcQueue.consume(
              async () => {
                const summary = await triggerBlobGc();
                if (summary.ran) {
                  logger.debug(
                    `Scheduled blob GC: ${summary.deleted} deleted (${summary.bytesReclaimed} bytes), ${summary.keptWithinGrace} kept within grace.`,
                  );
                } else {
                  logger.debug(
                    `Scheduled blob GC skipped: ${summary.reason ?? "unknown"}.`,
                  );
                }
              },
              { consumerGroup: "script-packages-blob-gc-worker", maxRetries: 0 },
            );
            await gcQueue.scheduleRecurring(
              {},
              {
                jobId: "script-packages-blob-gc-daily",
                intervalSeconds: 24 * 60 * 60,
              },
            );
            logger.debug("🧹 Script-packages blob GC scheduled (daily).");
          } catch (error) {
            logger.error(
              `Failed to schedule blob GC: ${extractErrorMessage(error)}`,
            );
          }
        }

        logger.debug("✅ Script Packages Backend afterPluginsReady complete.");
      },
    });
  },
});

// ─── Public surface ──────────────────────────────────────────────────────

export {
  blobStoreExtensionPoint,
  type BlobStore,
  type BlobStoreExtensionPoint,
} from "./blob-store";
export {
  createBlobStoreRegistry,
  type BlobStoreRegistry,
} from "./blob-store-registry";
export {
  resolveDataDir,
  resolveScriptPackagesDir,
  storePaths,
} from "./data-dir";
export {
  buildDependencies,
  buildStorePackageJson,
  computeLockfileHash,
  sortManifest,
} from "./lockfile";
export { renderNpmrc, type NpmrcInput } from "./npmrc";
export { parseBunLock, splitSpec } from "./parse-bun-lock";
export {
  createInstallStateStore,
  createInstallerLock,
  type InstallStateStore,
  type InstallerLock,
} from "./install-state-store";
export {
  performInstall,
  type BlobIndex,
  type BlobPublisher,
  type InstallResult,
  type Resolver,
  type ResolvedPackage,
} from "./install-service";
export { evaluateSizeCap, type SizeCapVerdict } from "./size-cap";
export { packDir, unpackInto } from "./cache-archive";
export { blobSha256, verifyBlobSha256 } from "./blob-hash";
export { computeMissingBlobs } from "./reconcile-diff";
export { atomicSymlinkSwap, readCurrentTarget } from "./atomic-symlink";
export {
  reconcileToHash,
  type ReconcileDeps,
  type ReconcileResult,
} from "./reconciler";
export { scriptPackagesChangedHook } from "./hooks";
export {
  createCentralResolver,
  type CentralResolverOptions,
} from "./resolver";
export { createReconcileFsDeps } from "./reconcile-fs";
export { findCacheEntry, type CacheEntryLocation } from "./cache-layout";
export { rollupPackageTypes } from "./package-types";
export {
  resolveResolutionRoot,
  resolveResolutionRootForHost,
  resolveResolutionRootFromStore,
  type ResolutionRootStatus,
} from "./resolution-root";
export {
  runInstallNow,
  type InstallControllerDeps,
  type InstallOutcome,
} from "./install-controller";
export {
  runStorageMigration,
  resumeCrashedMigration,
  type StorageMigrationDeps,
  type StorageMigrationResult,
  type ResumeCrashedMigrationDeps,
  type ResumeCrashedMigrationResult,
  type MigrationStateSnapshot,
} from "./storage-migration";
export { runBlobGc, type BlobGcDeps, type GcBlob } from "./blob-gc";
export {
  createBlobGcTrigger,
  type BlobGcRunnerDeps,
} from "./blob-gc-runner";
export { sweepTreeGc, type TreeGcResult } from "./tree-gc";
export {
  createLockfileHistoryStore,
  createBlobGcStateStore,
} from "./stores";
export * as schema from "./schema";
