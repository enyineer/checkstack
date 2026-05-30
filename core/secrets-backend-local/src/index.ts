import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { secretBackendExtensionPoint } from "@checkstack/secrets-backend";
import { pluginMetadata } from "./plugin-metadata";
import {
  createLocalSecretBackend,
  LOCAL_SECRET_BACKEND_ID,
} from "./store";
import * as schema from "./schema";

/**
 * Default secret backend: AES-256-GCM values in Postgres. Always
 * available; the active backend when no external backend (Vault) is
 * configured.
 *
 * Owns the `secrets` table (promoted from gitops — see ./drizzle). The
 * backend is built in `init()` (where `database` is injected) and
 * registered with the host's `secretBackendExtensionPoint`. The host runs
 * its `register()` first (dep ordering), so the extension point exists by
 * the time this init runs.
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
        const backend = createLocalSecretBackend({ db: database });
        env
          .getExtensionPoint(secretBackendExtensionPoint)
          .registerSecretBackend(backend, pluginMetadata);
        logger.debug(
          `🔐 Registered "${LOCAL_SECRET_BACKEND_ID}" secret backend.`,
        );
      },
    });
  },
});

export {
  createLocalSecretBackend,
  LOCAL_SECRET_BACKEND_ID,
} from "./store";
export * as schema from "./schema";
