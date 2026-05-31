import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  resolveActor,
  type Logger,
  type RpcContext,
  type SafeDatabase,
} from "@checkstack/backend-api";
import type { RegistryTokenStore } from "./registry-token";
import {
  scriptPackagesContract,
  type BlobGcSummary,
} from "@checkstack/script-packages-common";
import type { BlobStoreRegistry } from "./blob-store-registry";
import {
  createPackageStore,
  createRegistryConfigStore,
  createSizeCapStore,
  createStorageConfigStore,
  createSatelliteStateStore,
  createBlobGcStateStore,
} from "./stores";
import { createInstallStateStore } from "./install-state-store";
import { resolveRegistryRequestConfig } from "./registry-request-config";
import {
  searchPackages as registrySearchPackages,
  getPackageVersions as registryGetPackageVersions,
  RegistryClientError,
} from "./registry-client";
import * as schema from "./schema";

export interface ScriptPackagesRouterDeps {
  db: SafeDatabase<typeof schema>;
  blobStores: BlobStoreRegistry;
  logger: Logger;
  /** Trigger an install (elected). Provided by the plugin (wires the resolver). */
  triggerInstall(): Promise<{ started: boolean; reason?: string }>;
  /**
   * Kick a storage migration to `target` in the background. Provided by the
   * plugin (wires the blob stores). Returns immediately; progress is polled
   * via `getStorageMigrationState`.
   */
  triggerMigration(input: {
    target: string;
  }): Promise<{ started: boolean; reason?: string }>;
  /**
   * Run a blob-GC pass (elected via the installer advisory lock; refuses
   * while an install / migration is in flight). Provided by the plugin
   * (wires the blob stores + retention/grace). Returns a summary.
   */
  triggerBlobGc(): Promise<BlobGcSummary>;
  /**
   * Registry auth-token store, backed by the secrets platform's internal
   * secrets. Provided by the plugin (which injects `internalSecretsRef`).
   */
  registryToken: RegistryTokenStore;
}

export function createScriptPackagesRouter({
  db,
  blobStores,
  logger,
  triggerInstall,
  triggerMigration,
  triggerBlobGc,
  registryToken,
}: ScriptPackagesRouterDeps) {
  const packages = createPackageStore(db);
  const registry = createRegistryConfigStore(db);
  const storage = createStorageConfigStore(db);
  const sizeCap = createSizeCapStore(db);
  const satellites = createSatelliteStateStore(db);
  const installState = createInstallStateStore(db);
  const blobGcState = createBlobGcStateStore(db);

  const os = implement(scriptPackagesContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    // ─── Allowlist ────────────────────────────────────────────────────────
    listPackages: os.listPackages.handler(async () => ({
      items: await packages.list(),
    })),

    addPackage: os.addPackage.handler(async ({ input, context }) =>
      packages.upsert({
        name: input.name,
        version: input.version,
        addedBy: resolveActor(context.user).id ?? null,
      }),
    ),

    removePackage: os.removePackage.handler(async ({ input }) => {
      await packages.remove(input.name);
      return { success: true };
    }),

    setPackageEnabled: os.setPackageEnabled.handler(async ({ input }) =>
      packages.setEnabled({ name: input.name, enabled: input.enabled }),
    ),

    // ─── Registry autocomplete ────────────────────────────────────────────
    searchPackages: os.searchPackages.handler(async ({ input }) => {
      const reqConfig = await resolveRegistryRequestConfig({
        registry,
        registryToken,
        logger,
      });
      try {
        const items = await registrySearchPackages({
          registry: reqConfig,
          text: input.text,
        });
        return { items };
      } catch (error) {
        if (error instanceof RegistryClientError) {
          throw new ORPCError("BAD_GATEWAY", { message: error.message });
        }
        throw error;
      }
    }),

    getPackageVersions: os.getPackageVersions.handler(async ({ input }) => {
      const reqConfig = await resolveRegistryRequestConfig({
        registry,
        registryToken,
        logger,
      });
      try {
        return await registryGetPackageVersions({
          registry: reqConfig,
          name: input.name,
        });
      } catch (error) {
        if (error instanceof RegistryClientError) {
          throw new ORPCError("BAD_GATEWAY", { message: error.message });
        }
        throw error;
      }
    }),

    // ─── Registry config ──────────────────────────────────────────────────
    getRegistryConfig: os.getRegistryConfig.handler(async () => registry.get()),

    setRegistryConfig: os.setRegistryConfig.handler(async ({ input }) => {
      // Store the token (if provided) in the secrets platform's internal
      // secrets and persist the stable marker as the "secret ref".
      // `undefined` leaves the existing token; "" clears it.
      let authSecretRef: string | null | undefined;
      if (input.authToken !== undefined) {
        if (input.authToken.length > 0) {
          authSecretRef = await registryToken.store(input.authToken);
        } else {
          await registryToken.clear();
          authSecretRef = null;
        }
      }
      await registry.set({
        registryUrl: input.registryUrl,
        scopedRegistries: input.scopedRegistries,
        ignoreScripts: input.ignoreScripts,
        authSecretRef,
      });
      return registry.get();
    }),

    // ─── Install ──────────────────────────────────────────────────────────
    installNow: os.installNow.handler(async () => triggerInstall()),

    getSizeCapConfig: os.getSizeCapConfig.handler(async () => sizeCap.get()),
    setSizeCapConfig: os.setSizeCapConfig.handler(async ({ input }) => {
      await sizeCap.set(input);
      return sizeCap.get();
    }),

    // ─── Storage ──────────────────────────────────────────────────────────
    getStorageConfig: os.getStorageConfig.handler(async () => storage.get()),

    listStorageBackends: os.listStorageBackends.handler(async () => ({
      backends: blobStores.ids(),
    })),

    setStorageBackend: os.setStorageBackend.handler(async ({ input }) => {
      if (!blobStores.has(input.backend)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Blob store backend "${input.backend}" is not available.`,
        });
      }
      const current = await storage.get();
      if (current.migrationStatus === "migrating") {
        throw new ORPCError("CONFLICT", {
          message:
            "A storage migration is in progress; cannot change the active backend until it completes.",
        });
      }
      // Directly setting the active backend does NOT move existing blobs. Use
      // `migrateStorage` to copy blobs to the new backend. This is for an
      // initial selection / when both backends already hold the blobs.
      await storage.setActiveBackend(input.backend);
      return storage.get();
    }),

    migrateStorage: os.migrateStorage.handler(async ({ input }) => {
      if (!blobStores.has(input.target)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Target blob store backend "${input.target}" is not available.`,
        });
      }
      return triggerMigration({ target: input.target });
    }),

    getStorageMigrationState: os.getStorageMigrationState.handler(async () =>
      storage.get(),
    ),

    // ─── Garbage collection ───────────────────────────────────────────────
    gcBlobs: os.gcBlobs.handler(async () => triggerBlobGc()),

    getBlobGcState: os.getBlobGcState.handler(async () => blobGcState.get()),

    // ─── Per-host status ──────────────────────────────────────────────────
    listSatelliteSyncState: os.listSatelliteSyncState.handler(async () => ({
      items: await satellites.list(),
    })),

    reportSatelliteSyncState: os.reportSatelliteSyncState.handler(
      async ({ input }) => {
        await satellites.report(input);
        return { success: true };
      },
    ),

    // ─── Authoring / runtime ──────────────────────────────────────────────
    getInstallState: os.getInstallState.handler(async () => installState.load()),

    getManifest: os.getManifest.handler(async ({ input }) => {
      const state = await installState.load();
      if (state.lockfileHash !== input.lockfileHash) {
        // We only retain the current desired manifest; an older hash isn't
        // reconstructable. Return empty so the caller falls back to a full
        // pull against the current manifest.
        return { entries: [] };
      }
      return { entries: state.manifest };
    }),

    downloadBlob: os.downloadBlob.handler(async ({ input }) => {
      const storageConfig = await storage.get();
      const active = storageConfig.activeBackend;
      const result = await blobStores.readWithFallback({
        integrity: input.integrity,
        activeBackendId: active,
      });
      if (!result) {
        throw new ORPCError("NOT_FOUND", {
          message: `Blob ${input.integrity} not found in any backend.`,
        });
      }
      return {
        integrity: input.integrity,
        data: Buffer.from(result.bytes).toString("base64"),
        sizeBytes: result.bytes.byteLength,
      };
    }),
  });
}

export type ScriptPackagesRouter = ReturnType<
  typeof createScriptPackagesRouter
>;
