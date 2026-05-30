import {
  createBackendPlugin,
  coreServices,
} from "@checkstack/backend-api";
import {
  pluginMetadata,
  scriptPackagesAccessRules,
} from "@checkstack/script-packages-common";
import type { PluginMetadata } from "@checkstack/common";
import { blobStoreExtensionPoint, type BlobStore } from "./blob-store";
import {
  createBlobStoreRegistry,
  type BlobStoreRegistry,
} from "./blob-store-registry";
import * as schema from "./schema";

/**
 * Internal env stash for threading the blob-store registry from
 * `register()` into `init()` / `afterPluginsReady()`. Mirrors the
 * established pattern in other core backends.
 */
interface EnvStash {
  blobStores: BlobStoreRegistry;
}

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const blobStores = createBlobStoreRegistry();
    (env as unknown as EnvStash).blobStores = blobStores;

    env.registerAccessRules(scriptPackagesAccessRules);

    // Blob-store plugins (postgres / s3) register their implementation here.
    env.registerExtensionPoint(blobStoreExtensionPoint, {
      registerBlobStore: (store: BlobStore, _metadata: PluginMetadata) => {
        blobStores.register(store);
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        logger.debug("📦 Initializing Script Packages Backend...");
        // Router + reconciler wiring land in later sub-chunks.
      },
    });
  },
});

// ─── Public surface for store plugins + reconcilers ──────────────────────

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
export * as schema from "./schema";
