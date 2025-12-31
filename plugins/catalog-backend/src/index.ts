import { createBackendPlugin } from "@checkmate/backend-api";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { coreServices } from "@checkmate/backend-api";
import { permissionList } from "@checkmate/catalog-common";
import { createCatalogRouter } from "./router";
import type { NotificationClient } from "@checkmate/notification-common";

// Database schema is still needed for types in creating the router
import * as schema from "./schema";

export let db: NodePgDatabase<typeof schema> | undefined;

const PLUGIN_ID = "catalog-backend";

export default createBackendPlugin({
  pluginId: PLUGIN_ID,
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
      },
      init: async ({ database, rpc, rpcClient, logger }) => {
        logger.debug("Initializing Catalog Backend...");

        const typedDb = database as NodePgDatabase<typeof schema>;

        // Get notification client for group management
        const notificationClient = rpcClient.forPlugin<NotificationClient>(
          "notification-backend"
        );

        // Bootstrap: Create notification groups for existing systems and groups
        await bootstrapNotificationGroups(typedDb, notificationClient, logger);

        // Register oRPC router with notification client
        const catalogRouter = createCatalogRouter(
          typedDb,
          notificationClient,
          PLUGIN_ID
        );
        rpc.registerRouter("catalog-backend", catalogRouter);

        logger.debug("✅ Catalog Backend initialized.");
      },
    });
  },
});

/**
 * Bootstrap notification groups for existing catalog entities
 */
async function bootstrapNotificationGroups(
  database: NodePgDatabase<typeof schema>,
  notificationClient: NotificationClient,
  logger: { debug: (msg: string) => void }
) {
  try {
    // Get all existing systems and groups
    const systems = await database.select().from(schema.systems);
    const groups = await database.select().from(schema.groups);

    // Create notification groups for each system
    for (const system of systems) {
      await notificationClient.createGroup({
        groupId: `system.${system.id}`,
        name: `${system.name} Notifications`,
        description: `Notifications for the ${system.name} system`,
        ownerPlugin: PLUGIN_ID,
      });
    }

    // Create notification groups for each catalog group
    for (const group of groups) {
      await notificationClient.createGroup({
        groupId: `group.${group.id}`,
        name: `${group.name} Notifications`,
        description: `Notifications for the ${group.name} group`,
        ownerPlugin: PLUGIN_ID,
      });
    }

    logger.debug(
      `Bootstrapped notification groups for ${systems.length} systems and ${groups.length} groups`
    );
  } catch (error) {
    // Don't fail startup if notification service is unavailable
    logger.debug(
      `Failed to bootstrap notification groups: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
