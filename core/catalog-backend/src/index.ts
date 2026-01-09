import { createBackendPlugin } from "@checkmate-monitor/backend-api";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { coreServices } from "@checkmate-monitor/backend-api";
import {
  permissionList,
  pluginMetadata,
  catalogContract,
  catalogRoutes,
  permissions,
} from "@checkmate-monitor/catalog-common";
import { createCatalogRouter } from "./router";
import { NotificationApi } from "@checkmate-monitor/notification-common";
import { resolveRoute, type InferClient } from "@checkmate-monitor/common";
import { registerSearchProvider } from "@checkmate-monitor/command-backend";

// Database schema is still needed for types in creating the router
import * as schema from "./schema";

export let db: NodePgDatabase<typeof schema> | undefined;

// Export hooks for other plugins to subscribe to
export { catalogHooks } from "./hooks";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerPermissions(permissionList);

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
      },
      // Phase 2: Register router only - no RPC calls to other plugins
      init: async ({ database, rpc, rpcClient, logger }) => {
        logger.debug("Initializing Catalog Backend...");

        const typedDb = database as NodePgDatabase<typeof schema>;

        // Get notification client for group management and sending notifications
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        // Register oRPC router with notification client
        const catalogRouter = createCatalogRouter({
          database: typedDb,
          notificationClient,
          pluginId: pluginMetadata.pluginId,
        });
        rpc.registerRouter(catalogRouter, catalogContract);

        // Register catalog systems as searchable in the command palette
        registerSearchProvider({
          pluginMetadata,
          provider: {
            id: "systems",
            name: "Systems",
            priority: 100, // High priority - systems are primary search target
            search: async (query) => {
              const systems = await typedDb.select().from(schema.systems);
              const q = query.toLowerCase();

              return systems
                .filter(
                  (s) =>
                    !q ||
                    s.name.toLowerCase().includes(q) ||
                    s.description?.toLowerCase().includes(q)
                )
                .map((s) => ({
                  id: s.id,
                  type: "entity" as const,
                  title: s.name,
                  subtitle: s.description ?? undefined,
                  category: "Systems",
                  iconName: "Activity",
                  route: resolveRoute(catalogRoutes.routes.systemDetail, {
                    systemId: s.id,
                  }),
                }));
            },
          },
          commands: [
            {
              id: "create",
              title: "Create System",
              subtitle: "Add a new system to the catalog",
              iconName: "Activity",
              route:
                resolveRoute(catalogRoutes.routes.config) + "?action=create",
              requiredPermissions: [permissions.catalogManage],
            },
            {
              id: "manage",
              title: "Manage Systems",
              subtitle: "Manage systems in the catalog",
              iconName: "Activity",
              shortcuts: ["meta+shift+s", "ctrl+shift+s"],
              route: resolveRoute(catalogRoutes.routes.config),
              requiredPermissions: [permissions.catalogManage],
            },
          ],
        });

        logger.debug("✅ Catalog Backend initialized.");
      },
      // Phase 3: Safe to make RPC calls after all plugins are ready
      afterPluginsReady: async ({ database, rpcClient, logger }) => {
        const typedDb = database as NodePgDatabase<typeof schema>;
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        // Bootstrap: Create notification groups for existing systems and groups
        await bootstrapNotificationGroups(typedDb, notificationClient, logger);
      },
    });
  },
});

/**
 * Bootstrap notification groups for existing catalog entities
 */
async function bootstrapNotificationGroups(
  database: NodePgDatabase<typeof schema>,
  notificationClient: InferClient<typeof NotificationApi>,
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
        ownerPlugin: pluginMetadata.pluginId,
      });
    }

    // Create notification groups for each catalog group
    for (const group of groups) {
      await notificationClient.createGroup({
        groupId: `group.${group.id}`,
        name: `${group.name} Notifications`,
        description: `Notifications for the ${group.name} group`,
        ownerPlugin: pluginMetadata.pluginId,
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
