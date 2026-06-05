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
  scriptPackagesAccess,
  scriptPackagesAccessRules,
  scriptPackagesContract,
  SCRIPT_PACKAGES_AUDIT_COMPLETED_SIGNAL,
  type AuditRunSummary,
  type BlobGcSummary,
} from "@checkstack/script-packages-common";
import type { SandboxPolicy } from "@checkstack/common";
import { AuthApi } from "@checkstack/auth-common";
import { NotificationApi } from "@checkstack/notification-common";
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
  createAuditStore,
} from "./stores";
import { createBlobGcTrigger } from "./blob-gc-runner";
import { createAuditRunner } from "./audit-runner";
import { createAuditScanner } from "./audit-scanner";
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
import { resolveRegistryRequestConfig } from "./registry-request-config";
import { createReconcileFsDeps } from "./reconcile-fs";
import { reconcileToHash } from "./reconciler";
import { scriptPackagesChangedHook, sandboxPolicyChangedHook } from "./hooks";
import {
  createSandboxPolicyService,
  registerScriptPackagesSandboxProvider,
} from "./sandbox-policy";
import { logSandboxStartupReadiness } from "./sandbox-startup-log";
import { createScriptPackagesRouter } from "./router";
import { createTypeClosureHttpHandler } from "./type-acquisition-route";
import { createSdkTypesHttpHandler } from "./sdk-types-route";
import {
  TYPE_ACQUISITION_PATH_PREFIX,
  SDK_TYPES_PATH_PREFIX,
} from "@checkstack/script-packages-common";
import {
  SDK_EDITOR_BUNDLE_DTS,
  SDK_RELEASE_VERSION,
} from "@checkstack/sdk/editor-bundle";
import * as schema from "./schema";

interface EnvStash {
  blobStores: BlobStoreRegistry;
  /**
   * Set in `afterPluginsReady` (the only phase where `emitHook` exists) and
   * called by the installer (wired in `init`) after a successful install.
   * Undefined until `afterPluginsReady` runs.
   */
  emitChanged?: (lockfileHash: string) => Promise<void>;
  /**
   * Set in `afterPluginsReady` (where `emitHook` exists) and called by the
   * `setSandboxPolicy` handler (wired in `init`) after a successful policy
   * write, so core instances broadcast the new policy to their satellites.
   * Undefined until `afterPluginsReady` runs (a write before then still
   * persists durably; satellites pick it up on next connect).
   */
  emitSandboxPolicyChanged?: (policy: SandboxPolicy) => Promise<void>;
  /** Registry token store (internal secrets), set in `init`. */
  registryToken?: RegistryTokenStore;
  /**
   * Blob-GC trigger built in `init` (wires stores + the installer lock).
   * Reused by the scheduled recurring job registered in `afterPluginsReady`.
   */
  triggerBlobGc?: () => Promise<BlobGcSummary>;
  /**
   * Vulnerability-audit trigger built in `init` (wires the scanner, stores,
   * installer lock, and notification path). Reused by the scheduled recurring
   * job registered in `afterPluginsReady`.
   */
  triggerAudit?: () => Promise<AuditRunSummary>;
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
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
        auth: coreServices.auth,
        advisoryLock: coreServices.advisoryLock,
        queueManager: coreServices.queueManager,
        config: coreServices.config,
        internalSecrets: internalSecretsRef,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        signalService,
        auth,
        advisoryLock,
        config,
        internalSecrets,
      }) => {
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

        // Vulnerability-audit trigger: shared by the admin `auditNow` RPC and
        // the scheduled recurring job. Holds the installer lock for the pass
        // (mutually exclusive with installs / migrations / GC). Reuses the
        // installer's registry/`.npmrc` resolution so audit + install never
        // drift, and records advisories to the plugin's own Postgres tables
        // (cluster-wide source of truth; the on-disk tree is pod-local).
        const auditStore = createAuditStore(database);
        const authClient = rpcClient.forPlugin(AuthApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);
        const triggerAudit = createAuditRunner({
          installerLock,
          auditStore,
          loadCurrent: async () => {
            const state = await installState.load();
            const reg = await registry.get();
            const list = await packages.list();
            return {
              lockfileHash: state.lockfileHash,
              packages: list.map((p) => ({
                name: p.name,
                version: p.version,
                enabled: p.enabled,
              })),
              ignoreScripts: reg.ignoreScripts,
            };
          },
          scan: async ({ packages: pkgs, ignoreScripts }) => {
            const reqConfig = await resolveRegistryRequestConfig({
              registry,
              registryToken,
              logger,
            });
            const paths = storePaths(storeRoot);
            const scanner = createAuditScanner({
              scratchDir: path.join(paths.root, ".audit-scratch"),
              // Same shared cache the installer's resolver uses, so the audit
              // reuses already-fetched packages instead of re-downloading.
              cacheDir: paths.cache,
              registry: {
                registryUrl: reqConfig.registryUrl,
                scopedRegistries: reqConfig.scopedRegistries,
                authToken: reqConfig.authToken,
              },
            });
            return scanner.scan({
              packages: pkgs.map((p) => ({
                name: p.name,
                version: p.version,
                enabled: p.enabled,
              })),
              ignoreScripts,
            });
          },
          getUserIds: async () => {
            const users = await authClient.getUsers();
            return users.map((u) => u.id);
          },
          filterManagers: (userIds) =>
            authClient.filterUsersByAccessRule({
              userIds,
              accessRule: scriptPackagesAccess.manage.id,
            }),
          notifyUser: async ({ userId, title, body, importance, action }) => {
            // sendTransactional's importance vocabulary is info|warning|critical.
            const notification: {
              title: string;
              body: string;
              importance: "info" | "warning" | "critical";
              action?: { label: string; url: string };
            } = { title, body, importance };
            if (action) notification.action = action;
            await notificationClient.sendTransactional({ userId, notification });
          },
          emitCompleted: async ({ lockfileHash, total }) => {
            await signalService.broadcast(
              SCRIPT_PACKAGES_AUDIT_COMPLETED_SIGNAL,
              { lockfileHash, total },
            );
          },
          logger,
        });
        (env as unknown as EnvStash).triggerAudit = triggerAudit;

        // Build the install orchestration. The resolver + active blob store
        // are resolved lazily at install time so config/registry changes
        // and store-plugin registration order don't matter.
        const triggerInstall = async () => {
          // Same registry + token resolution the live registry-client RPCs
          // use (shared helper) so the install and autocomplete paths can
          // never drift on how they talk to the registry.
          const reqConfig = await resolveRegistryRequestConfig({
            registry,
            registryToken,
            logger,
          });
          const reg = await registry.get();
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
              registryUrl: reqConfig.registryUrl,
              scopedRegistries: reqConfig.scopedRegistries,
              authToken: reqConfig.authToken,
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

        // GLOBAL sandbox policy: the single owning row lives in THIS plugin's
        // ConfigService (shared Postgres, NOT pod-local). script-packages is
        // the single source of truth — it registers the one process-wide policy
        // provider that every script runner on this pod resolves through, so
        // both script plugins read the identical value (no more last-writer-wins
        // across two plugin-scoped rows). The runners FAIL CLOSED if this read
        // throws, so a transient DB error never widens the sandbox.
        const sandboxPolicy = createSandboxPolicyService({
          configService: config,
        });
        registerScriptPackagesSandboxProvider({ service: sandboxPolicy });

        // One-time, per-pod startup observability for the script sandbox: the
        // host readiness banner AND the capability/effective-enforcement line
        // for the configured global default. Both surfaces are emitted here, in
        // process, by the single policy owner — the policy is read through the
        // in-process `sandboxPolicy.read()` closure with NO RPC. This replaces
        // the old per-script-plugin `getSandboxPolicy` RPC log, which 404'd when
        // a script plugin's init ran before this plugin had mounted its router.
        // Best-effort: never throws, never relaxes enforcement.
        await logSandboxStartupReadiness({
          logger,
          readPolicy: () => sandboxPolicy.read(),
        });

        const router = createScriptPackagesRouter({
          db: database,
          blobStores,
          logger,
          triggerInstall,
          triggerMigration,
          triggerBlobGc,
          triggerAudit,
          registryToken,
          sandboxPolicy,
          // Push-on-change: broadcast the new policy to all connected
          // satellites via the cluster-wide hook (each pod fans it out to its
          // own satellites). No-op until `afterPluginsReady` wires `emitHook`;
          // the durable row + connect-time relay are the backstop.
          onSandboxPolicyChanged: async (policy) => {
            await (env as unknown as EnvStash).emitSandboxPolicyChanged?.(
              policy,
            );
          },
        });
        rpc.registerRouter(router, scriptPackagesContract);

        // Raw, HTTP-cacheable route for editor lazy ATA (package `.d.ts`
        // closures). Served outside oRPC so the response can carry
        // `Cache-Control` (oRPC procedures here can't set response headers).
        // Mounted at `/api/script-packages/types/:hash/:specifier`.
        rpc.registerHttpHandler(
          createTypeClosureHttpHandler({
            auth,
            getLockfileHash: async () => {
              const state = await installState.load();
              return state.lockfileHash;
            },
            storeRoot,
            logger,
          }),
          TYPE_ACQUISITION_PATH_PREFIX,
        );

        // Raw, HTTP-cacheable route serving the running release's generated
        // @checkstack/sdk editor bundle for the in-app script editor. Keyed by
        // the running release version so a deployment upgrade refreshes the
        // editor's SDK types (never stale); mismatched version -> 409.
        // Mounted at `/api/script-packages/sdk-types/:releaseVersion`.
        rpc.registerHttpHandler(
          createSdkTypesHttpHandler({
            auth,
            getReleaseVersion: () => SDK_RELEASE_VERSION,
            getSdkBundle: () => SDK_EDITOR_BUNDLE_DTS,
            logger,
          }),
          SDK_TYPES_PATH_PREFIX,
        );

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

        // Let the `setSandboxPolicy` handler (in init's router) broadcast the
        // new global policy cluster-wide; each core pod's broadcast subscriber
        // (in satellite-backend) pushes it to its own connected satellites.
        stash.emitSandboxPolicyChanged = async (policy) => {
          await emitHook(sandboxPolicyChangedHook, { policy });
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

        // Scheduled recurring vulnerability audit: run `bun audit` against the
        // installed tree, persist advisories (cluster-wide source of truth),
        // and notify `script-packages.manage` holders about newly-appeared /
        // escalated advisories. The trigger (built in `init`) holds the
        // installer advisory lock for the pass, so exactly one pod audits at a
        // time and it is mutually exclusive with installs / migrations / GC.
        // Runs daily (an admin-configurable interval is a follow-up).
        const triggerAudit = stash.triggerAudit;
        if (triggerAudit) {
          try {
            const auditQueue = queueManager.getQueue<Record<string, never>>(
              "script-packages-audit",
            );
            await auditQueue.consume(
              async () => {
                const summary = await triggerAudit();
                if (summary.ran) {
                  logger.debug(
                    `Scheduled audit: ${summary.total} advisor(ies), ${summary.notified} notified.`,
                  );
                } else {
                  logger.debug(
                    `Scheduled audit skipped: ${summary.reason ?? "unknown"}.`,
                  );
                }
              },
              { consumerGroup: "script-packages-audit-worker", maxRetries: 0 },
            );
            await auditQueue.scheduleRecurring(
              {},
              {
                jobId: "script-packages-audit-daily",
                intervalSeconds: 24 * 60 * 60,
              },
            );
            logger.debug("🛡️ Script-packages vulnerability audit scheduled (daily).");
          } catch (error) {
            logger.error(
              `Failed to schedule vulnerability audit: ${extractErrorMessage(error)}`,
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
export {
  resolveRegistryRequestConfig,
  type RegistryRequestConfig,
} from "./registry-request-config";
export {
  searchPackages,
  getPackageVersions,
  registryUrlForName,
  RegistryClientError,
  type PackageSearchResult,
} from "./registry-client";
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
export { scriptPackagesChangedHook, sandboxPolicyChangedHook } from "./hooks";
export {
  createSandboxPolicyService,
  registerScriptPackagesSandboxProvider,
  type SandboxPolicyService,
} from "./sandbox-policy";
export {
  logSandboxStartupReadiness,
  type SandboxStartupLogger,
} from "./sandbox-startup-log";
export {
  createCentralResolver,
  type CentralResolverOptions,
} from "./resolver";
export { createReconcileFsDeps } from "./reconcile-fs";
export { findCacheEntry, type CacheEntryLocation } from "./cache-layout";
export {
  resolvePackageTypeClosure,
  typesPackageDirName,
  extractReferences,
} from "./package-types";
export { createTypeClosureHttpHandler } from "./type-acquisition-route";
export {
  createSdkTypesHttpHandler,
  SDK_BUNDLE_VIRTUAL_PATH,
} from "./sdk-types-route";
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
  createAuditStore,
  type AuditStore,
} from "./stores";
export {
  parseBunAudit,
  countBySeverity,
  meetsThreshold,
  type ParseAuditResult,
} from "./audit-parse";
export {
  computeAuditDelta,
  advisoryKey,
  type AuditDeltaInput,
  type AuditDeltaResult,
} from "./audit-delta";
export {
  createAuditScanner,
  type AuditScanner,
  type AuditScannerOptions,
  type AuditScanResult,
  type SpawnFn,
} from "./audit-scanner";
export { createAuditRunner, type AuditRunnerDeps } from "./audit-runner";
export * as schema from "./schema";
