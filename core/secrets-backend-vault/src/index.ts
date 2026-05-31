import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { secretBackendExtensionPoint } from "@checkstack/secrets-backend";
import { pluginMetadata } from "./plugin-metadata";
import { createVaultBackend } from "./vault-backend";
import { createVaultIndexStore, VAULT_SECRET_BACKEND_ID } from "./index-store";
import { createVaultConfigStore } from "./vault-config-store";
import * as schema from "./schema";

/**
 * HashiCorp Vault secret backend. Optional / opt-in: install this plugin
 * and select `vault` as the active backend (Settings → Secrets) to route
 * resolution through Vault. The local backend remains the default.
 *
 * Owns its own `secret_index` table (name → KV v2 path/key) and its own
 * ConfigService config (address / auth / encrypted credential). The backend
 * is built in `init()` (where `database` + `config` are injected) and
 * registered with the host's `secretBackendExtensionPoint`.
 */
export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        config: coreServices.config,
      },
      init: async ({ logger, database, config }) => {
        const backend = createVaultBackend({
          indexStore: createVaultIndexStore({ db: database }),
          configStore: createVaultConfigStore({ config }),
        });
        env
          .getExtensionPoint(secretBackendExtensionPoint)
          .registerSecretBackend(backend, pluginMetadata);
        logger.debug(
          `🔐 Registered "${VAULT_SECRET_BACKEND_ID}" secret backend.`,
        );
      },
    });
  },
});

export { createVaultBackend } from "./vault-backend";
export {
  createVaultClient,
  type VaultClient,
  type VaultClientConfig,
  type VaultSession,
  type FetchLike,
} from "./vault-client";
export {
  createVaultIndexStore,
  toSecretMetadata,
  VAULT_SECRET_BACKEND_ID,
  type VaultIndexStore,
} from "./index-store";
export { createValueCache, type ValueCache } from "./cache";
export * as schema from "./schema";
