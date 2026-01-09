import {
  createBackendPlugin,
  coreServices,
  createExtensionPoint,
  createServiceRef,
} from "@checkmate-monitor/backend-api";
import {
  permissionList,
  pluginMetadata,
  integrationContract,
  integrationRoutes,
  permissions,
} from "@checkmate-monitor/integration-common";
import { resolveRoute } from "@checkmate-monitor/common";
import type { PluginMetadata } from "@checkmate-monitor/common";
import type {
  IntegrationEventDefinition,
  IntegrationProvider,
} from "./provider-types";

import * as schema from "./schema";
import {
  createIntegrationEventRegistry,
  type IntegrationEventRegistry,
} from "./event-registry";
import {
  createIntegrationProviderRegistry,
  type IntegrationProviderRegistry,
} from "./provider-registry";
import { createDeliveryCoordinator } from "./delivery-coordinator";
import {
  createConnectionStore,
  type ConnectionStore,
} from "./connection-store";
import { subscribeToRegisteredEvents } from "./hook-subscriber";
import { createIntegrationRouter } from "./router";
import { registerSearchProvider } from "@checkmate-monitor/command-backend";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service References
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Service reference for the connection store.
 * Provider plugins can inject this to access connection credentials.
 */
export const connectionStoreRef = createServiceRef<ConnectionStore>(
  "integration.connectionStore"
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Extension Points
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extension point for registering integration events.
 * Plugins use this to expose their hooks for external webhook subscriptions.
 */
export interface IntegrationEventExtensionPoint {
  /**
   * Register a hook as an integration event.
   * The event will be namespaced by the plugin's ID automatically.
   */
  registerEvent<T>(
    definition: IntegrationEventDefinition<T>,
    pluginMetadata: PluginMetadata
  ): void;
}

export const integrationEventExtensionPoint =
  createExtensionPoint<IntegrationEventExtensionPoint>(
    "integration.eventExtensionPoint"
  );

/**
 * Extension point for registering integration providers.
 * Plugins use this to register webhook delivery providers.
 */
export interface IntegrationProviderExtensionPoint {
  /**
   * Register an integration provider.
   * The provider will be namespaced by the plugin's ID automatically.
   * @template TConfig - Per-subscription configuration type
   * @template TConnection - Site-wide connection configuration type (optional)
   */
  addProvider<TConfig, TConnection = undefined>(
    provider: IntegrationProvider<TConfig, TConnection>,
    pluginMetadata: PluginMetadata
  ): void;
}

export const integrationProviderExtensionPoint =
  createExtensionPoint<IntegrationProviderExtensionPoint>(
    "integration.providerExtensionPoint"
  );

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Create the registries
    const eventRegistry = createIntegrationEventRegistry();
    const providerRegistry = createIntegrationProviderRegistry();

    // Register static permissions
    env.registerPermissions(permissionList);

    // Register the event extension point
    env.registerExtensionPoint(integrationEventExtensionPoint, {
      registerEvent: <T>(
        definition: IntegrationEventDefinition<T>,
        metadata: PluginMetadata
      ) => {
        // Type erasure: cast to unknown for storage (the registry handles this internally)
        eventRegistry.register(
          definition as IntegrationEventDefinition<unknown>,
          metadata
        );
      },
    });

    // Register the provider extension point
    env.registerExtensionPoint(integrationProviderExtensionPoint, {
      addProvider: (provider, metadata) => {
        // Type erasure: cast to unknown for storage (the registry handles this internally)
        providerRegistry.register(
          provider as IntegrationProvider<unknown>,
          metadata
        );
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        config: coreServices.config,
        signalService: coreServices.signalService,
        queueManager: coreServices.queueManager,
      },
      init: async ({
        logger,
        database,
        rpc,
        config,
        signalService,
        queueManager,
      }) => {
        logger.debug("🔌 Initializing Integration Backend...");

        const db = database;

        // Create connection store for generic connection management
        const connectionStore = createConnectionStore({
          configService: config,
          providerRegistry,
          logger,
        });

        // Publish connection store for provider plugins to inject
        env.registerService(connectionStoreRef, connectionStore);

        // Create delivery coordinator
        const deliveryCoordinator = createDeliveryCoordinator({
          db,
          providerRegistry,
          connectionStore,
          queueManager,
          signalService,
          logger,
        });

        // Store for afterPluginsReady access
        (
          env as unknown as {
            eventRegistry: IntegrationEventRegistry;
            providerRegistry: IntegrationProviderRegistry;
            deliveryCoordinator: typeof deliveryCoordinator;
          }
        ).eventRegistry = eventRegistry;
        (
          env as unknown as {
            eventRegistry: IntegrationEventRegistry;
            providerRegistry: IntegrationProviderRegistry;
            deliveryCoordinator: typeof deliveryCoordinator;
          }
        ).providerRegistry = providerRegistry;
        (
          env as unknown as {
            eventRegistry: IntegrationEventRegistry;
            providerRegistry: IntegrationProviderRegistry;
            deliveryCoordinator: typeof deliveryCoordinator;
          }
        ).deliveryCoordinator = deliveryCoordinator;

        // Create and register the router
        const router = createIntegrationRouter({
          db,
          eventRegistry,
          providerRegistry,
          deliveryCoordinator,
          connectionStore,
          signalService,
          logger,
        });
        rpc.registerRouter(router, integrationContract);

        // Register command palette commands
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Integration Subscription",
              subtitle: "Create a new subscription for integration events",
              iconName: "Webhook",
              route:
                resolveRoute(integrationRoutes.routes.list) + "?action=create",
              requiredPermissions: [permissions.integrationManage],
            },
            {
              id: "manage",
              title: "Manage Integrations",
              subtitle: "Manage integration subscriptions and connections",
              iconName: "Webhook",
              shortcuts: ["meta+shift+g", "ctrl+shift+g"],
              route: resolveRoute(integrationRoutes.routes.list),
              requiredPermissions: [permissions.integrationManage],
            },
            {
              id: "logs",
              title: "View Integration Logs",
              subtitle: "View integration delivery logs",
              iconName: "FileText",
              route: resolveRoute(integrationRoutes.routes.logs),
              requiredPermissions: [permissions.integrationManage],
            },
          ],
        });

        logger.debug("✅ Integration Backend initialized.");
      },
      afterPluginsReady: async ({ logger, onHook }) => {
        // Get registries from env
        const stored = env as unknown as {
          eventRegistry: IntegrationEventRegistry;
          providerRegistry: IntegrationProviderRegistry;
          deliveryCoordinator: ReturnType<typeof createDeliveryCoordinator>;
        };

        const events = stored.eventRegistry.getEvents();
        const providers = stored.providerRegistry.getProviders();

        logger.debug(
          `🔌 Registered ${events.length} integration events: ${events
            .map((e) => e.eventId)
            .join(", ")}`
        );

        logger.debug(
          `📡 Registered ${providers.length} integration providers: ${providers
            .map((p) => p.qualifiedId)
            .join(", ")}`
        );

        // Subscribe to all registered integration events
        // Uses work-queue mode to ensure only ONE instance processes each event
        subscribeToRegisteredEvents({
          onHook,
          eventRegistry: stored.eventRegistry,
          deliveryCoordinator: stored.deliveryCoordinator,
          logger,
        });

        // Start the delivery worker
        await stored.deliveryCoordinator.startWorker();

        logger.debug("✅ Integration Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export extension points for consumer plugins
export { integrationEventExtensionPoint as eventExtensionPoint };
export { integrationProviderExtensionPoint as providerExtensionPoint };

// Re-export provider types for consumer plugins
// All backend-only types are defined here (not in integration-common)
export type {
  IntegrationEventDefinition,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  TestConnectionResult,
  ProviderDocumentation,
  ConnectionOption,
  GetConnectionOptionsParams,
  IntegrationProvider,
  RegisteredIntegrationProvider,
  RegisteredIntegrationEvent,
} from "./provider-types";
