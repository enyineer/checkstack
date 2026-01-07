import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import {
  permissionList,
  pluginMetadata,
  maintenanceContract,
} from "@checkmate-monitor/maintenance-common";
import {
  createBackendPlugin,
  coreServices,
} from "@checkmate-monitor/backend-api";
import { integrationEventExtensionPoint } from "@checkmate-monitor/integration-backend";
import { MaintenanceService } from "./service";
import { createRouter } from "./router";
import { CatalogApi } from "@checkmate-monitor/catalog-common";
import { maintenanceHooks } from "./hooks";

// =============================================================================
// Integration Event Payload Schemas
// =============================================================================

const maintenanceCreatedPayloadSchema = z.object({
  maintenanceId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
});

const maintenanceUpdatedPayloadSchema = z.object({
  maintenanceId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  action: z.enum(["updated", "closed"]),
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

        logger.debug("✅ Maintenance Backend initialized.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { maintenanceHooks } from "./hooks";
