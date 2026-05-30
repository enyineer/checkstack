import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  encrypt,
  resolveActor,
  type Logger,
  type RpcContext,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import {
  scriptPackagesContract,
  type PackageTypes,
} from "@checkstack/script-packages-common";
import type { BlobStoreRegistry } from "./blob-store-registry";
import {
  createPackageStore,
  createRegistryConfigStore,
  createSizeCapStore,
  createStorageConfigStore,
  createSatelliteStateStore,
} from "./stores";
import { createInstallStateStore } from "./install-state-store";
import { rollupPackageTypes } from "./package-types";
import { storePaths } from "./data-dir";
import path from "node:path";
import * as schema from "./schema";

export interface ScriptPackagesRouterDeps {
  db: SafeDatabase<typeof schema>;
  blobStores: BlobStoreRegistry;
  storeRoot: string;
  logger: Logger;
  /** Trigger an install (elected). Provided by the plugin (wires the resolver). */
  triggerInstall(): Promise<{ started: boolean; reason?: string }>;
}

export function createScriptPackagesRouter({
  db,
  blobStores,
  storeRoot,
  logger,
  triggerInstall,
}: ScriptPackagesRouterDeps) {
  const packages = createPackageStore(db);
  const registry = createRegistryConfigStore(db);
  const storage = createStorageConfigStore(db);
  const sizeCap = createSizeCapStore(db);
  const satellites = createSatelliteStateStore(db);
  const installState = createInstallStateStore(db);

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

    // ─── Registry config ──────────────────────────────────────────────────
    getRegistryConfig: os.getRegistryConfig.handler(async () => registry.get()),

    setRegistryConfig: os.setRegistryConfig.handler(async ({ input }) => {
      // Encrypt the token (if provided) and store the ciphertext as the
      // "secret ref". `undefined` leaves the existing token; "" clears it.
      let authSecretRef: string | null | undefined;
      if (input.authToken !== undefined) {
        authSecretRef =
          input.authToken.length > 0 ? encrypt(input.authToken) : null;
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

    setStorageBackend: os.setStorageBackend.handler(async ({ input }) => {
      if (!blobStores.has(input.backend)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Blob store backend "${input.backend}" is not available.`,
        });
      }
      await storage.setActiveBackend(input.backend);
      return storage.get();
    }),

    migrateStorage: os.migrateStorage.handler(async () => ({
      started: false,
      reason: "Storage migration is implemented in a later phase.",
    })),

    getStorageMigrationState: os.getStorageMigrationState.handler(async () =>
      storage.get(),
    ),

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

    listPackageTypes: os.listPackageTypes.handler(async () => {
      const state = await installState.load();
      if (!state.lockfileHash) return { items: [] as PackageTypes[] };
      const nodeModulesDir = path.join(
        storePaths(storeRoot).trees,
        state.lockfileHash,
        "node_modules",
      );
      try {
        const items = await rollupPackageTypes({
          nodeModulesDir,
          manifest: state.manifest,
        });
        return { items };
      } catch (error) {
        logger.error(
          `Failed to roll up package types: ${extractErrorMessage(error)}`,
        );
        return { items: [] as PackageTypes[] };
      }
    }),
  });
}

export type ScriptPackagesRouter = ReturnType<
  typeof createScriptPackagesRouter
>;
