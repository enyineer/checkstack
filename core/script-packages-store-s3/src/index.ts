import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { blobStoreExtensionPoint } from "@checkstack/script-packages-backend";
import { pluginMetadata } from "./plugin-metadata";
import { loadS3ConfigFromEnv } from "./config";
import { createS3BlobStore, S3_BLOB_STORE_ID } from "./store";

/**
 * S3-compatible blob-store plugin. Registers an `s3` {@link BlobStore} when
 * S3 env vars are configured; otherwise stays dormant so the platform
 * falls back to the postgres default. A partially-configured S3 (bucket
 * set but creds missing) logs an error rather than silently registering a
 * broken store.
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        const loaded = loadS3ConfigFromEnv();
        if (loaded.ok === "unconfigured") {
          logger.debug(
            "📦 S3 script-package blob store not configured; skipping.",
          );
          return;
        }
        if (loaded.ok === false) {
          logger.error(loaded.error);
          return;
        }
        const store = createS3BlobStore(loaded.config);
        env
          .getExtensionPoint(blobStoreExtensionPoint)
          .registerBlobStore(store, pluginMetadata);
        logger.debug(
          `📦 Registered "${S3_BLOB_STORE_ID}" script-package blob store (bucket "${loaded.config.bucket}").`,
        );
      },
    });
  },
});

export { createS3BlobStore, S3_BLOB_STORE_ID } from "./store";
export { loadS3ConfigFromEnv, type S3StoreConfig } from "./config";
