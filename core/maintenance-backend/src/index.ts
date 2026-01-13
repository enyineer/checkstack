import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import {
  maintenanceAccessRules,
  maintenanceAccess,
  pluginMetadata,
  maintenanceContract,
  maintenanceRoutes,
} from "@checkstack/maintenance-common";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
import { MaintenanceService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkstack/catalog-common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { resolveRoute } from "@checkstack/common";
import { maintenanceHooks } from "./hooks";

// =============================================================================
// Integration Event Payload Schemas
// =============================================================================

const maintenanceCreatedPayloadSchema = z.object({
  maintenanceId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string(),
});

const maintenanceUpdatedPayloadSchema = z.object({
  maintenanceId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  action: z.enum(["updated", "closed"]),
});

// =============================================================================
// Plugin Definition
// =============================================================================

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(maintenanceAccessRules);

    // Register hooks as integration events
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint
    );

    integrationEvents.registerEvent(
      {
        hook: maintenanceHooks.maintenanceCreated,
        displayName: "Maintenance Created",
        description: "Fired when a new maintenance is scheduled",
        category: "Maintenance",
        payloadSchema: maintenanceCreatedPayloadSchema,
      },
      pluginMetadata
    );

    integrationEvents.registerEvent(
      {
        hook: maintenanceHooks.maintenanceUpdated,
        displayName: "Maintenance Updated",
        description: "Fired when a maintenance is updated or closed",
        category: "Maintenance",
        payloadSchema: maintenanceUpdatedPayloadSchema,
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
        logger.debug("🔧 Initializing Maintenance Backend...");

        const catalogClient = rpcClient.forPlugin(CatalogApi);

        const service = new MaintenanceService(
          database as NodePgDatabase<typeof schema>
        );
        const router = createRouter(
          service,
          signalService,
          catalogClient,
          logger
        );
        rpc.registerRouter(router, maintenanceContract);

        // Register "Create Maintenance" command in the command palette
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Maintenance",
              subtitle: "Schedule a maintenance window",
              iconName: "Wrench",
              route:
                resolveRoute(maintenanceRoutes.routes.config) +
                "?action=create",
              requiredAccessRules: [maintenanceAccess.maintenance.manage],
            },
            {
              id: "manage",
              title: "Manage Maintenance",
              subtitle: "Manage maintenance windows",
              iconName: "Wrench",
              shortcuts: ["meta+shift+m", "ctrl+shift+m"],
              route: resolveRoute(maintenanceRoutes.routes.config),
              requiredAccessRules: [maintenanceAccess.maintenance.manage],
            },
          ],
        });

        logger.debug("✅ Maintenance Backend initialized.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { maintenanceHooks } from "./hooks";
