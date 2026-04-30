import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import { z } from "zod";
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
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
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
import { incidentHooks } from "./hooks";
import { createIncidentCache } from "./cache";

// =============================================================================
// Integration Event Payload Schemas
// =============================================================================

const incidentCreatedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  description: z.string().optional(),
  severity: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

const incidentUpdatedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  description: z.string().optional(),
  severity: z.string(),
  status: z.string(),
  statusChange: z.string().optional(),
});

const incidentResolvedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  severity: z.string(),
  resolvedAt: z.string(),
});

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

    // Register hooks as integration events
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint,
    );

    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentCreated,
        displayName: "Incident Created",
        description: "Fired when a new incident is created",
        category: "Incidents",
        payloadSchema: incidentCreatedPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentUpdated,
        displayName: "Incident Updated",
        description:
          "Fired when an incident is updated (info or status change)",
        category: "Incidents",
        payloadSchema: incidentUpdatedPayloadSchema,
      },
      pluginMetadata,
    );

    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentResolved,
        displayName: "Incident Resolved",
        description: "Fired when an incident is marked as resolved",
        category: "Incidents",
        payloadSchema: incidentResolvedPayloadSchema,
      },
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
