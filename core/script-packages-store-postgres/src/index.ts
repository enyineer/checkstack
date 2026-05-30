import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { blobStoreExtensionPoint } from "@checkstack/script-packages-backend";
import { pluginMetadata } from "./plugin-metadata";
import { createPostgresBlobStore, POSTGRES_BLOB_STORE_ID } from "./store";
import * as schema from "./schema";

/**
 * Default blob-store plugin: persists script-package blobs in Postgres
 * (base64 `text`). Always available; selected when no S3 is configured.
 *
 * The store is built in `init()` (where `database` is injected) and
 * registered with the host's `blobStoreExtensionPoint`. The host runs its
 * `register()` first (dep ordering), so the extension point exists by the
 * time this init runs.
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger, database }) => {
        const store = createPostgresBlobStore(database);
        env
          .getExtensionPoint(blobStoreExtensionPoint)
          .registerBlobStore(store, pluginMetadata);
        logger.debug(
          `📦 Registered "${POSTGRES_BLOB_STORE_ID}" script-package blob store.`,
        );
      },
    });
  },
});

export { createPostgresBlobStore, POSTGRES_BLOB_STORE_ID } from "./store";
