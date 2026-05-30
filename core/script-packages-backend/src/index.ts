import path from "node:path";
import {
  createBackendPlugin,
  coreServices,
  decrypt,
} from "@checkstack/backend-api";
import {
  pluginMetadata,
  scriptPackagesAccessRules,
  scriptPackagesContract,
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
} from "./stores";
import { createInstallStateStore } from "./install-state-store";
import { runInstallNow } from "./install-controller";
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
      },
      init: async ({ logger, database, rpc }) => {
        logger.debug("📦 Initializing Script Packages Backend...");

        const storeRoot = resolveScriptPackagesDir();
        const packages = createPackageStore(database);
        const registry = createRegistryConfigStore(database);
        const storage = createStorageConfigStore(database);
        const sizeCap = createSizeCapStore(database);
        const blobIndex = createBlobIndexStore(database);
        const installState = createInstallStateStore(database);

        // Build the install orchestration. The resolver + active blob store
        // are resolved lazily at install time so config/registry changes
        // and store-plugin registration order don't matter.
        const triggerInstall = async () => {
          const reg = await registry.get();
          const secretRef = await registry.authSecretRef();
          let authToken: string | undefined;
          if (secretRef) {
            try {
              authToken = decrypt(secretRef);
            } catch (error) {
              logger.error(
                `Failed to decrypt registry auth token: ${extractErrorMessage(error)}`,
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
            emitChanged: async ({ lockfileHash }) => {
              await (env as unknown as EnvStash).emitChanged?.(lockfileHash);
            },
            logger,
          });
        };

        const router = createScriptPackagesRouter({
          db: database,
          blobStores,
          storeRoot,
          logger,
          triggerInstall,
        });
        rpc.registerRouter(router, scriptPackagesContract);

        logger.debug("✅ Script Packages Backend initialized.");
      },

      afterPluginsReady: async ({ logger, database, onHook, emitHook }) => {
        const stash = env as unknown as EnvStash;
        const blobStores = stash.blobStores;
        const storeRoot = resolveScriptPackagesDir();
        const installState = createInstallStateStore(database);
        const storage = createStorageConfigStore(database);

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
  type InstallStateStore,
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
  runInstallNow,
  type InstallControllerDeps,
  type InstallOutcome,
} from "./install-controller";
export * as schema from "./schema";
