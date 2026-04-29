import {
  createBackendPlugin,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { coreServices } from "@checkstack/backend-api";
import {
  catalogAccessRules,
  catalogAccess,
  pluginMetadata,
  catalogContract,
  catalogRoutes,
} from "@checkstack/catalog-common";
import { createCatalogRouter } from "./router";
import { createCatalogCache } from "./cache";
import { NotificationApi } from "@checkstack/notification-common";
import { AuthApi } from "@checkstack/auth-common";
import { authHooks } from "@checkstack/auth-backend";
import { resolveRoute, type InferClient, extractErrorMessage} from "@checkstack/common";
import { registerSearchProvider } from "@checkstack/command-backend";
import { EntityService } from "./services/entity-service";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { CHECKSTACK_API_VERSION, entityRefSchema, GitOpsApi } from "@checkstack/gitops-common";
import { z } from "zod";

// Database schema is still needed for types in creating the router
import * as schema from "./schema";

export let db: SafeDatabase<typeof schema> | undefined;

// Export hooks for other plugins to subscribe to
export { catalogHooks } from "./hooks";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(catalogAccessRules);

    // ─── GitOps Entity Kind Registration ───────────────────────────────
    // Mutable DB reference — populated during init(), consumed by reconcile closures.
    // Safe because reconcile is only called during sync (afterPluginsReady), by which
    // point init() has already completed.
    let gitopsDb: SafeDatabase<typeof schema> | undefined;

    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);

    // Register kind: System
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({}),
      reconcile: async ({ entity, existingEntityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        const entityService = new EntityService(gitopsDb);
        const displayName = entity.metadata.title ?? entity.metadata.name;
        const description = entity.metadata.description;

        if (existingEntityId) {
          await entityService.updateSystem(existingEntityId, {
            name: displayName,
            description,
          });
          context.logger.info(
            `GitOps: updated System "${displayName}" (id: ${existingEntityId})`,
          );
          return { entityId: existingEntityId };
        }

        const system = await entityService.createSystem({
          name: displayName,
          description,
        });
        context.logger.info(
          `GitOps: created System "${displayName}" (id: ${system.id})`,
        );
        return { entityId: system.id };
      },
      delete: async ({ entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!entityId) return;
        const entityService = new EntityService(gitopsDb);
        await entityService.deleteSystem(entityId);
        context.logger.info(`GitOps: deleted System (id: ${entityId})`);
      },
    });

    // Register kind extension: System -> groups
    kindRegistry.registerKindExtension({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "groups",
      specSchema: z.array(entityRefSchema).optional(),
      reconcile: async ({ entity, extensionSpec, entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!extensionSpec || extensionSpec.length === 0) return;

        const entityService = new EntityService(gitopsDb);
        const systemEntityId = entityId;

        const desiredGroupIds = new Set<string>();

        for (const entry of extensionSpec) {
          const groupId = await context.resolveEntityRef({
            kind: entry.kind,
            entityName: entry.name,
          });

          if (!groupId) {
            throw new Error(
              `Cannot resolve ${entry.kind} ref "${entry.name}" — ensure the entity exists`
            );
          }

          desiredGroupIds.add(groupId);

          await entityService.addSystemToGroup({
            groupId: groupId,
            systemId: systemEntityId,
          });

          context.logger.info(
            `GitOps: associated System "${entity.metadata.name}" with Group "${entry.name}" (${groupId})`
          );
        }

        // Remove stale associations not in the spec
        const currentAssociations = await entityService.getGroupsForSystem(systemEntityId);
        for (const existing of currentAssociations) {
          if (!desiredGroupIds.has(existing.groupId)) {
            await entityService.removeSystemFromGroup({
              groupId: existing.groupId,
              systemId: systemEntityId,
            });
            context.logger.info(
              `GitOps: removed stale association ${existing.groupId} from System "${entity.metadata.name}"`
            );
          }
        }
      },
    });

    // Register kind: Group
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Group",
      specSchema: z.object({}),
      reconcile: async ({ entity, existingEntityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        const entityService = new EntityService(gitopsDb);
        const displayName = entity.metadata.title ?? entity.metadata.name;

        if (existingEntityId) {
          await entityService.updateGroup(existingEntityId, {
            name: displayName,
          });
          context.logger.info(
            `GitOps: updated Group "${displayName}" (id: ${existingEntityId})`,
          );
          return { entityId: existingEntityId };
        }

        const group = await entityService.createGroup({
          name: displayName,
        });
        context.logger.info(
          `GitOps: created Group "${displayName}" (id: ${group.id})`,
        );
        return { entityId: group.id };
      },
      delete: async ({ entityId, context }) => {
        if (!gitopsDb) throw new Error("Catalog database not initialized");
        if (!entityId) return;
        const entityService = new EntityService(gitopsDb);
        await entityService.deleteGroup(entityId);
        context.logger.info(`GitOps: deleted Group (id: ${entityId})`);
      },
    });

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
        cacheManager: coreServices.cacheManager,
      },
      // Phase 2: Register router only - no RPC calls to other plugins
      init: async ({ database, rpc, rpcClient, logger, cacheManager }) => {
        logger.debug("Initializing Catalog Backend...");

        // Populate the mutable DB reference for GitOps reconcile closures
        gitopsDb = database as SafeDatabase<typeof schema>;

        const typedDb = database as SafeDatabase<typeof schema>;

        // Get notification client for group management and sending notifications
        const notificationClient = rpcClient.forPlugin(NotificationApi);
        const authClient = rpcClient.forPlugin(AuthApi);
        const gitOpsClient = rpcClient.forPlugin(GitOpsApi);

        const cache = createCatalogCache({ cacheManager, logger });

        // Register oRPC router with notification client and auth client
        const catalogRouter = createCatalogRouter({
          database: typedDb,
          notificationClient,
          authClient,
          gitOpsClient,
          pluginId: pluginMetadata.pluginId,
          cache,
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
                    s.description?.toLowerCase().includes(q),
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
              requiredAccessRules: [catalogAccess.system.manage],
            },
            {
              id: "manage",
              title: "Manage Systems",
              subtitle: "Manage systems in the catalog",
              iconName: "Activity",
              shortcuts: ["meta+shift+s", "ctrl+shift+s"],
              route: resolveRoute(catalogRoutes.routes.config),
              requiredAccessRules: [catalogAccess.system.manage],
            },
          ],
        });

        logger.debug("✅ Catalog Backend initialized.");
      },
      // Phase 3: Safe to make RPC calls after all plugins are ready
      afterPluginsReady: async ({ database, rpcClient, logger, onHook }) => {
        const typedDb = database as SafeDatabase<typeof schema>;
        const notificationClient = rpcClient.forPlugin(NotificationApi);

        // Bootstrap: Create notification groups for existing systems and groups
        await bootstrapNotificationGroups(typedDb, notificationClient, logger);

        // Subscribe to user deletion to clean up user contacts
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(`Cleaning up contacts for deleted user: ${userId}`);
            const entityService = new EntityService(typedDb);
            await entityService.deleteContactsByUserId(userId);
            logger.debug(`Cleaned up contacts for user: ${userId}`);
          },
          { mode: "work-queue", workerGroup: "user-cleanup" },
        );
      },
    });
  },
});

/**
 * Bootstrap notification groups for existing catalog entities
 */
async function bootstrapNotificationGroups(
  database: SafeDatabase<typeof schema>,
  notificationClient: InferClient<typeof NotificationApi>,
  logger: { debug: (msg: string) => void },
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
      `Bootstrapped notification groups for ${systems.length} systems and ${groups.length} groups`,
    );
  } catch (error) {
    // Don't fail startup if notification service is unavailable
    logger.debug(
      `Failed to bootstrap notification groups: ${
        extractErrorMessage(error, "Unknown error")
      }`,
    );
  }
}
