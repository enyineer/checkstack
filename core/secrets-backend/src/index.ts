import {
  createBackendPlugin,
  coreServices,
  createServiceRef,
} from "@checkstack/backend-api";
import {
  pluginMetadata,
  secretsAccessRules,
  secretsContract,
} from "@checkstack/secrets-common";
import type { PluginMetadata } from "@checkstack/common";
import {
  secretBackendExtensionPoint,
  type SecretBackend,
} from "./secret-backend";
import {
  createSecretBackendRegistry,
  type SecretBackendRegistry,
} from "./secret-backend-registry";
import {
  createSecretResolverService,
  type SecretResolverService,
} from "./resolver-service";
import {
  createSecretAdminService,
  type SecretAdminService,
} from "./admin-service";
import {
  createInternalSecretsService,
  type InternalSecretsService,
} from "./internal-secrets-service";
import {
  createBackendConfigStore,
  type BackendConfigStore,
} from "./backend-config-store";
import { createActiveBackendStore } from "./active-backend";
import { createSecretsRouter } from "./router";
import { secretsChangedHook } from "./hooks";

/** Built-in default backend id. The local backend plugin registers under this. */
const DEFAULT_BACKEND_ID = "local";

/**
 * Cross-plugin secret resolution service. Consumer plugins (gitops,
 * automation, healthcheck) inject this to resolve `${{ secrets.NAME }}`
 * templates and a run's least-privilege env allowlist against the active
 * backend. Service-typed and backend-only — never exposed to a browser.
 */
export const secretResolverRef = createServiceRef<SecretResolverService>(
  "secrets.resolver",
);

/**
 * Cross-plugin secret administration service. Consumers (e.g. gitops)
 * inject this to manage secrets through the active backend so there is a
 * single source of truth. Metadata/write only — never returns a value.
 */
export const secretAdminRef = createServiceRef<SecretAdminService>(
  "secrets.admin",
);

/**
 * Cross-plugin service for platform-INTERNAL secrets (registry token,
 * connection credentials, …). Always backed by the local backend (never
 * Vault, which is read-through), so internal writes never break when an
 * external backend is active. Hidden from the user-facing Secrets UI.
 * Backend-only — never exposed to a browser.
 */
export const internalSecretsRef = createServiceRef<InternalSecretsService>(
  "secrets.internal",
);

interface EnvStash {
  backends: SecretBackendRegistry;
  configStore?: BackendConfigStore;
  emitChanged?: (input: {
    name: string;
    change: "created" | "rotated" | "deleted";
  }) => Promise<void>;
}

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const backends = createSecretBackendRegistry();
    (env as unknown as EnvStash).backends = backends;

    env.registerAccessRules(secretsAccessRules);

    env.registerExtensionPoint(secretBackendExtensionPoint, {
      registerSecretBackend: (
        backend: SecretBackend,
        _metadata: PluginMetadata,
      ) => {
        backends.register(backend);
      },
    });

    // The active backend id is config-selected (persisted via the config
    // store, set in `init`). Falls back to the local backend when no choice
    // is persisted or the persisted choice is not currently registered.
    const fallbackBackendId = (): string => {
      if (backends.has(DEFAULT_BACKEND_ID)) return DEFAULT_BACKEND_ID;
      const ids = backends.ids();
      if (ids.length === 0) {
        throw new Error(
          "No secret backend is registered. Ensure secrets-backend-local is installed.",
        );
      }
      return ids[0];
    };

    const getActiveBackendId = async (): Promise<string> => {
      const store = (env as unknown as EnvStash).configStore;
      const redacted = await store?.loadRedacted();
      const persisted = redacted?.activeBackend;
      if (persisted && backends.has(persisted)) return persisted;
      return fallbackBackendId();
    };

    const setActiveBackendId = async (id: string): Promise<void> => {
      const store = (env as unknown as EnvStash).configStore;
      if (!store) {
        throw new Error("Backend config store is not initialized yet.");
      }
      const current = (await store.load()) ?? { activeBackend: id };
      await store.save({ ...current, activeBackend: id });
    };

    // SecretStore backed by whichever backend is active — switching the
    // active backend (local → vault) re-routes resolution with no other
    // change. Throws on a missing secret so a required reference fails clearly.
    const secretStore = createActiveBackendStore({
      backends,
      getActiveBackendId,
    });

    const resolver = createSecretResolverService({ secretStore });
    env.registerService(secretResolverRef, resolver);

    const emitChanged = async (input: {
      name: string;
      change: "created" | "rotated" | "deleted";
    }): Promise<void> => {
      await (env as unknown as EnvStash).emitChanged?.(input);
    };

    const getActiveBackend = async (): Promise<SecretBackend> =>
      backends.get(await getActiveBackendId());

    const adminService = createSecretAdminService({
      getActiveBackend,
      onChanged: emitChanged,
    });
    env.registerService(secretAdminRef, adminService);

    // Internal secrets always use the local backend (always-writable),
    // never the active external backend.
    const internalSecrets = createInternalSecretsService({
      getLocalBackend: () => backends.get(DEFAULT_BACKEND_ID),
    });
    env.registerService(internalSecretsRef, internalSecrets);

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        config: coreServices.config,
      },
      init: async ({ logger, rpc, config }) => {
        logger.debug("🔐 Initializing Secrets Backend...");

        (env as unknown as EnvStash).configStore = createBackendConfigStore({
          config,
        });

        const router = createSecretsRouter({
          backends,
          getActiveBackendId,
          setActiveBackendId,
          emitChanged,
        });
        rpc.registerRouter(router, secretsContract);

        logger.debug("✅ Secrets Backend initialized.");
      },

      afterPluginsReady: async ({ logger, emitHook }) => {
        (env as unknown as EnvStash).emitChanged = async (input) => {
          await emitHook(secretsChangedHook, input);
        };
        logger.debug("✅ Secrets Backend afterPluginsReady complete.");
      },
    });
  },
});

// ─── Public surface ──────────────────────────────────────────────────────

export {
  secretBackendExtensionPoint,
  type SecretBackend,
  type SecretBackendExtensionPoint,
} from "./secret-backend";
export {
  createSecretBackendRegistry,
  type SecretBackendRegistry,
} from "./secret-backend-registry";
export {
  resolveSecretsBySchema,
  type SecretStore,
  type SecretResolutionResult,
} from "./secret-resolver";
export { walkSecretFields } from "./walk-secret-fields";
export {
  createSecretResolverService,
  type SecretResolverService,
} from "./resolver-service";
export {
  createSecretAdminService,
  type SecretAdminService,
} from "./admin-service";
export {
  createInternalSecretsService,
  type InternalSecretsService,
} from "./internal-secrets-service";
export {
  createMaskingContext,
  EMPTY_MASKING_CONTEXT,
  type SecretMaskingContext,
} from "./masking-context";
export { secretsChangedHook } from "./hooks";
