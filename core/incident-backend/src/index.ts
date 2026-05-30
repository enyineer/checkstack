import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  incidentAccessRules,
  incidentAccess,
  pluginMetadata,
  incidentContract,
  incidentRoutes,
  incidentSystemSubscription,
  incidentGroupSubscription,
} from "@checkstack/incident-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationTriggerExtensionPoint,
} from "@checkstack/automation-backend";
import {
  NotificationApi,
  specToRegistration,
} from "@checkstack/notification-common";
import { IncidentService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import { catalogHooks } from "@checkstack/catalog-backend";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { createIncidentCache } from "./cache";
import {
  createIncidentActions,
  incidentArtifactType,
  incidentTriggers,
} from "./automations";

// =============================================================================
// Plugin Definition
// =============================================================================

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(incidentAccessRules);
    env.registerSubscriptionSpecs([
      incidentSystemSubscription,
      incidentGroupSubscription,
    ]);

    // Register hooks as automation triggers — buffered until the
    // automation plugin's `register()` runs and the extension point
    // resolves. Triggers expose `contextKey` so wait_for_trigger can
    // match resume events back to the originating incident.
    const automationTriggers = env.getExtensionPoint(
      automationTriggerExtensionPoint,
    );
    for (const trigger of incidentTriggers) {
      automationTriggers.registerTrigger(trigger, pluginMetadata);
    }

    // Register the `incident` artifact type so `incident.create` can
    // `produces` it and the close/update actions can `consumes` it.
    const automationArtifactTypes = env.getExtensionPoint(
      automationArtifactTypeExtensionPoint,
    );
    automationArtifactTypes.registerArtifactType(
      incidentArtifactType,
      pluginMetadata,
    );

    let incidentCache:
      | ReturnType<typeof createIncidentCache>
      | undefined;

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
        cacheManager: coreServices.cacheManager,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        signalService,
        cacheManager,
      }) => {
        logger.debug("🔧 Initializing Incident Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);
        const authClient = rpcClient.forPlugin(AuthApi);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        const service = new IncidentService(
          database as SafeDatabase<typeof schema>,
        );
        const cache = createIncidentCache({ cacheManager, logger });
        incidentCache = cache;
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          notificationClient,
          authClient,
          logger,
          cache,
        );
        rpc.registerRouter(router, incidentContract);

        // Register incident actions with the Automation platform. We
        // capture the service in closure here (rather than via a
        // service ref + ctx.getService at execute time) because the
        // service has no per-request state — one instance for the life
        // of the plugin is correct.
        const automationActions = env.getExtensionPoint(
          automationActionExtensionPoint,
        );
        for (const action of createIncidentActions({ service })) {
          automationActions.registerAction(action, pluginMetadata);
        }

        // Register "Create Incident" command in the command palette
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Incident",
              subtitle: "Report a new incident affecting systems",
              iconName: "CircleAlert",
              route:
                resolveRoute(incidentRoutes.routes.config) + "?action=create",
              requiredAccessRules: [incidentAccess.incident.manage],
            },
            {
              id: "manage",
              title: "Manage Incidents",
              subtitle: "Manage incidents affecting systems",
              iconName: "CircleAlert",
              shortcuts: ["meta+shift+i", "ctrl+shift+i"],
              route: resolveRoute(incidentRoutes.routes.config),
              requiredAccessRules: [incidentAccess.incident.manage],
            },
          ],
        });

        logger.debug("✅ Incident Backend initialized.");
      },
      // Subscribe to catalog system deletion (clean up incident
      // associations) + register subscription specs. Per-system /
      // per-group notification group lifecycle is fully owned by
      // notification-backend now — incident never touches it.
      afterPluginsReady: async ({ database, logger, onHook, rpcClient }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const service = new IncidentService(typedDb);
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        await Promise.all([
          notificationClient.registerSubscriptionSpec(
            specToRegistration(incidentSystemSubscription),
          ),
          notificationClient.registerSubscriptionSpec(
            specToRegistration(incidentGroupSubscription),
          ),
        ]);

        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up incident associations for deleted system: ${payload.systemId}`,
            );
            await service.removeSystemAssociations(payload.systemId);
            await incidentCache?.invalidateSystem(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "incident-system-cleanup" },
        );

        logger.debug("✅ Incident Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { incidentHooks } from "./hooks";
