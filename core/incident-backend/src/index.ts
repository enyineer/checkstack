import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import {
  permissionList,
  pluginMetadata,
  incidentContract,
  incidentRoutes,
  permissions,
} from "@checkmate-monitor/incident-common";
import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { integrationEventExtensionPoint } from "@checkmate-monitor/integration-backend";
import { IncidentService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkmate-monitor/catalog-common";
import { catalogHooks } from "@checkmate-monitor/catalog-backend";
import { registerSearchProvider } from "@checkmate-monitor/command-backend";
import { resolveRoute } from "@checkmate-monitor/common";
import { incidentHooks } from "./hooks";

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
    env.registerPermissions(permissionList);

    // Register hooks as integration events
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint
    );

    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentCreated,
        displayName: "Incident Created",
        description: "Fired when a new incident is created",
        category: "Incidents",
        payloadSchema: incidentCreatedPayloadSchema,
      },
      pluginMetadata
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
      pluginMetadata
    );

    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentResolved,
        displayName: "Incident Resolved",
        description: "Fired when an incident is marked as resolved",
        category: "Incidents",
        payloadSchema: incidentResolvedPayloadSchema,
      },
      pluginMetadata
    );

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
      },
      init: async ({ logger, database, rpc, rpcClient, signalService }) => {
        logger.debug("🔧 Initializing Incident Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);

        const service = new IncidentService(
          database as NodePgDatabase<typeof schema>
        );
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          logger
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
              requiredPermissions: [permissions.incidentManage],
            },
            {
              id: "manage",
              title: "Manage Incidents",
              subtitle: "Manage incidents affecting systems",
              iconName: "CircleAlert",
              shortcuts: ["meta+shift+i", "ctrl+shift+i"],
              route: resolveRoute(incidentRoutes.routes.config),
              requiredPermissions: [permissions.incidentManage],
            },
          ],
        });

        logger.debug("✅ Incident Backend initialized.");
      },
      // Phase 3: Subscribe to catalog events for cleanup
      afterPluginsReady: async ({ database, logger, onHook }) => {
        const typedDb = database as NodePgDatabase<typeof schema>;
        const service = new IncidentService(typedDb);

        // Subscribe to catalog system deletion to clean up associations
        onHook(
          catalogHooks.systemDeleted,
          async (payload) => {
            logger.debug(
              `Cleaning up incident associations for deleted system: ${payload.systemId}`
            );
            await service.removeSystemAssociations(payload.systemId);
          },
          { mode: "work-queue", workerGroup: "incident-system-cleanup" }
        );

        logger.debug("✅ Incident Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { incidentHooks } from "./hooks";
