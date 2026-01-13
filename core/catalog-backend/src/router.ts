import { implement, ORPCError } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkstack/backend-api";
import { catalogContract } from "@checkstack/catalog-common";
import { EntityService } from "./services/entity-service";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { NotificationApi } from "@checkstack/notification-common";
import type { InferClient } from "@checkstack/common";
import { catalogHooks } from "./hooks";
import { eq } from "drizzle-orm";

/**
 * Creates the catalog router using contract-based implementation.
 *
 * Auth and permissions are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.permissions.
 */
const os = implement(catalogContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export interface CatalogRouterDeps {
  database: NodePgDatabase<typeof schema>;
  notificationClient: InferClient<typeof NotificationApi>;
  pluginId: string;
}

export const createCatalogRouter = ({
  database,
  notificationClient,
  pluginId,
}: CatalogRouterDeps) => {
  const entityService = new EntityService(database);

  // Helper to create notification group for an entity
  const createNotificationGroup = async (
    type: "system" | "group",
    id: string,
    name: string
  ) => {
    try {
      await notificationClient.createGroup({
        groupId: `${type}.${id}`,
        name: `${name} Notifications`,
        description: `Notifications for the ${name} ${type}`,
        ownerPlugin: pluginId,
      });
    } catch (error) {
      // Log but don't fail the operation
      console.warn(
        `Failed to create notification group for ${type} ${id}:`,
        error
      );
    }
  };

  // Helper to delete notification group for an entity
  const deleteNotificationGroup = async (
    type: "system" | "group",
    id: string
  ) => {
    try {
      await notificationClient.deleteGroup({
        groupId: `${pluginId}.${type}.${id}`,
        ownerPlugin: pluginId,
      });
    } catch (error) {
      // Log but don't fail the operation
      console.warn(
        `Failed to delete notification group for ${type} ${id}:`,
        error
      );
    }
  };

  // Implement each contract method
  const getEntities = os.getEntities.handler(async () => {
    const systems = await entityService.getSystems();
    const groups = await entityService.getGroups();
    // Cast to match contract - Drizzle json() returns unknown, but we expect Record | null
    return {
      systems: systems as unknown as Array<
        (typeof systems)[number] & {
          metadata: Record<string, unknown> | null;
        }
      >,
      groups: groups as unknown as Array<
        (typeof groups)[number] & { metadata: Record<string, unknown> | null }
      >,
    };
  });

  const getSystems = os.getSystems.handler(async () => {
    const systems = await entityService.getSystems();
    return {
      systems: systems as unknown as Array<
        (typeof systems)[number] & { metadata: Record<string, unknown> | null }
      >,
    };
  });

  const getSystem = os.getSystem.handler(async ({ input }) => {
    const system = await entityService.getSystem(input.systemId);
    if (!system) {
      // oRPC contract uses .nullable() which requires null
      // eslint-disable-next-line unicorn/no-null
      return null;
    }
    return system as typeof system & {
      metadata: Record<string, unknown> | null;
    };
  });

  const getGroups = os.getGroups.handler(async () => {
    const groups = await entityService.getGroups();
    return groups as unknown as Array<
      (typeof groups)[number] & { metadata: Record<string, unknown> | null }
    >;
  });

  const createSystem = os.createSystem.handler(async ({ input }) => {
    const result = await entityService.createSystem(input);

    // Create a notification group for this system
    await createNotificationGroup("system", result.id, result.name);

    return result as typeof result & {
      metadata: Record<string, unknown> | null;
    };
  });

  const updateSystem = os.updateSystem.handler(async ({ input }) => {
    // Convert null to undefined and filter out fields
    const cleanData: Partial<{
      name: string;
      description?: string;
      owner?: string;
      metadata?: Record<string, unknown>;
    }> = {};
    if (input.data.name !== undefined) cleanData.name = input.data.name;
    if (input.data.description !== undefined)
      cleanData.description = input.data.description ?? undefined;
    if (input.data.owner !== undefined)
      cleanData.owner = input.data.owner ?? undefined;
    if (input.data.metadata !== undefined)
      cleanData.metadata = input.data.metadata ?? undefined;

    const result = await entityService.updateSystem(input.id, cleanData);
    if (!result) {
      throw new ORPCError("NOT_FOUND", {
        message: "System not found",
      });
    }
    return result as typeof result & {
      metadata: Record<string, unknown> | null;
    };
  });

  const deleteSystem = os.deleteSystem.handler(async ({ input, context }) => {
    await entityService.deleteSystem(input);

    // Delete the notification group for this system
    await deleteNotificationGroup("system", input);

    // Emit hook for other plugins to clean up related data
    await context.emitHook(catalogHooks.systemDeleted, { systemId: input });

    return { success: true };
  });

  const createGroup = os.createGroup.handler(async ({ input }) => {
    const result = await entityService.createGroup({
      name: input.name,
      metadata: input.metadata,
    });

    // Create a notification group for this catalog group
    await createNotificationGroup("group", result.id, result.name);

    // New groups have no systems yet
    return {
      ...result,
      systemIds: [],
      metadata: result.metadata as Record<string, unknown> | null,
    };
  });

  const updateGroup = os.updateGroup.handler(async ({ input }) => {
    // Convert null to undefined for optional fields
    const cleanData = {
      ...input.data,
      metadata: input.data.metadata ?? undefined,
    };
    const result = await entityService.updateGroup(input.id, cleanData);
    if (!result) {
      throw new ORPCError("NOT_FOUND", {
        message: "Group not found",
      });
    }
    // Get the full group with systemIds after update
    const groups = await entityService.getGroups();
    const fullGroup = groups.find((g) => g.id === result.id);
    if (!fullGroup) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Group not found after update",
      });
    }
    return fullGroup as unknown as typeof fullGroup & {
      metadata: Record<string, unknown> | null;
    };
  });

  const deleteGroup = os.deleteGroup.handler(async ({ input, context }) => {
    await entityService.deleteGroup(input);

    // Delete the notification group for this catalog group
    await deleteNotificationGroup("group", input);

    // Emit hook for other plugins to clean up related data
    await context.emitHook(catalogHooks.groupDeleted, { groupId: input });

    return { success: true };
  });

  const addSystemToGroup = os.addSystemToGroup.handler(async ({ input }) => {
    await entityService.addSystemToGroup(input);
    return { success: true };
  });

  const removeSystemFromGroup = os.removeSystemFromGroup.handler(
    async ({ input }) => {
      await entityService.removeSystemFromGroup(input);
      return { success: true };
    }
  );

  const getViews = os.getViews.handler(async () => entityService.getViews());

  const createView = os.createView.handler(async ({ input }) => {
    return entityService.createView({
      name: input.name,
      type: "custom",
      config: input.configuration as Record<string, unknown>,
    });
  });

  /**
   * Notify all users subscribed to a system (and optionally its groups).
   * Delegates deduplication to notification-backend via notifyGroups RPC.
   */
  const notifySystemSubscribers = os.notifySystemSubscribers.handler(
    async ({ input }) => {
      const {
        systemId,
        title,
        body,
        importance,
        action,
        includeGroupSubscribers,
      } = input;

      // Collect all notification group IDs to notify
      // Start with the system's notification group
      const groupIds = [`${pluginId}.system.${systemId}`];

      // If includeGroupSubscribers is true, add groups containing this system
      if (includeGroupSubscribers) {
        const systemGroups = await database
          .select({ groupId: schema.systemsGroups.groupId })
          .from(schema.systemsGroups)
          .where(eq(schema.systemsGroups.systemId, systemId));

        // Spread to avoid mutation
        groupIds.push(
          ...systemGroups.map(({ groupId }) => `${pluginId}.group.${groupId}`)
        );
      }

      // 3. Send to notification-backend, which handles deduplication
      const result = await notificationClient.notifyGroups({
        groupIds,
        title,
        body,
        importance: importance ?? "info",
        action,
      });

      return { notifiedCount: result.notifiedCount };
    }
  );

  // Build and return the router
  return os.router({
    getEntities,
    getSystems,
    getSystem,
    getGroups,
    createSystem,
    updateSystem,
    deleteSystem,
    createGroup,
    updateGroup,
    deleteGroup,
    addSystemToGroup,
    removeSystemFromGroup,
    getViews,
    createView,
    notifySystemSubscribers,
  });
};

export type CatalogRouter = ReturnType<typeof createCatalogRouter>;
