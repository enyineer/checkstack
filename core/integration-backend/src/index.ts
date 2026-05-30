import {
  createBackendPlugin,
  coreServices,
  createExtensionPoint,
  createServiceRef,
} from "@checkstack/backend-api";
import {
  integrationAccessRules,
  integrationAccess,
  pluginMetadata,
  integrationContract,
  integrationRoutes,
} from "@checkstack/integration-common";
import { resolveRoute } from "@checkstack/common";
import type { PluginMetadata } from "@checkstack/common";
import type { IntegrationProvider } from "./provider-types";

import * as schema from "./schema";
import { createIntegrationProviderRegistry } from "./provider-registry";
import {
  createConnectionStore,
  type ConnectionStore,
} from "./connection-store";
import { createIntegrationRouter } from "./router";
import { registerSearchProvider } from "@checkstack/command-backend";
import {
  secretResolverRef,
  internalSecretsRef,
} from "@checkstack/secrets-backend";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service References
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Service reference for the connection store. Provider plugins inject
 * this to look up credentials when an automation action runs.
 */
export const connectionStoreRef = createServiceRef<ConnectionStore>(
  "integration.connectionStore",
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Extension Points
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extension point for registering integration providers. After the
 * migration to the Automation Platform a provider is just the
 * connection metadata + dropdown resolvers + a test endpoint — the
 * per-event delivery work moved onto automation actions.
 */
export interface IntegrationProviderExtensionPoint {
  addProvider<TConnection = undefined>(
    provider: IntegrationProvider<TConnection>,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const integrationProviderExtensionPoint =
  createExtensionPoint<IntegrationProviderExtensionPoint>(
    "integration.providerExtensionPoint",
  );

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface EnvStash {
  /** Set in `init`, used by `afterPluginsReady` for the credential migration. */
  runCredentialMigration?: () => Promise<void>;
}

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const providerRegistry = createIntegrationProviderRegistry();

    env.registerAccessRules(integrationAccessRules);

    env.registerExtensionPoint(integrationProviderExtensionPoint, {
      addProvider: (provider, metadata) => {
        providerRegistry.register(
          provider as IntegrationProvider<unknown>,
          metadata,
        );
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        config: coreServices.config,
        secretResolver: secretResolverRef,
        internalSecrets: internalSecretsRef,
      },
      init: async ({
        logger,
        rpc,
        config,
        database,
        secretResolver,
        internalSecrets,
      }) => {
        logger.debug("🔌 Initializing Integration Backend...");

        const connectionStore = createConnectionStore({
          configService: config,
          providerRegistry,
          logger,
          // Unified credential resolution through the ONE secrets channel.
          credentials: { secretResolver, internalSecrets },
        });
        env.registerService(connectionStoreRef, connectionStore);
        // Stash the migration for afterPluginsReady (all providers + their
        // connectionSchemas are registered only by then).
        (env as unknown as EnvStash).runCredentialMigration = () =>
          connectionStore.runCredentialMigration();

        const router = createIntegrationRouter({
          db: database,
          providerRegistry,
          connectionStore,
          logger,
        });
        rpc.registerRouter(router, integrationContract);

        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "connections",
              title: "Manage Integration Connections",
              subtitle: "Configure credentials for Jira, Teams, Webex, etc.",
              iconName: "Webhook",
              shortcuts: ["meta+shift+g", "ctrl+shift+g"],
              route: resolveRoute(integrationRoutes.routes.list),
              requiredAccessRules: [integrationAccess.manage],
            },
          ],
        });

        logger.debug(
          `📡 Integration Backend init complete with ${providerRegistry.getProviders().length} providers`,
        );
      },

      // Consolidate legacy inline connection credentials onto the secrets
      // platform once every provider (and its connectionSchema) is
      // registered. Idempotent + parity-verified + reversible (backup).
      afterPluginsReady: async ({ logger }) => {
        try {
          await (env as unknown as EnvStash).runCredentialMigration?.();
        } catch (error) {
          logger.error(
            `Connection credential migration failed: ${String(error)}`,
          );
        }
      },
    });
  },
});

// ─── Re-exports ─────────────────────────────────────────────────────────

export { integrationProviderExtensionPoint as providerExtensionPoint };

export type {
  TestConnectionResult,
  ProviderDocumentation,
  ConnectionOption,
  GetConnectionOptionsParams,
  IntegrationProvider,
  RegisteredIntegrationProvider,
} from "./provider-types";

export type { ConnectionStore } from "./connection-store";
