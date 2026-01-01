import { implement, ORPCError } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkmate/backend-api";
import { catalogContract } from "@checkmate/catalog-common";
import { EntityService } from "./services/entity-service";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import type { NotificationClient } from "@checkmate/notification-common";

/**
 * Creates the catalog router using contract-based implementation.
 *
 * Auth and permissions are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.permissions.
 */
const os = implement(catalogContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export const createCatalogRouter = (
  database: NodePgDatabase<typeof schema>,
  notificationClient: NotificationClient,
  pluginId: string
) => {
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
    return systems as unknown as Array<
      (typeof systems)[number] & { metadata: Record<string, unknown> | null }
    >;
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

  const deleteSystem = os.deleteSystem.handler(async ({ input }) => {
    await entityService.deleteSystem(input);

    // Delete the notification group for this system
    await deleteNotificationGroup("system", input);

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

  const deleteGroup = os.deleteGroup.handler(async ({ input }) => {
    await entityService.deleteGroup(input);

    // Delete the notification group for this catalog group
    await deleteNotificationGroup("group", input);

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

  // Build and return the router
  return os.router({
    getEntities,
    getSystems,
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
  });
};

export type CatalogRouter = ReturnType<typeof createCatalogRouter>;
