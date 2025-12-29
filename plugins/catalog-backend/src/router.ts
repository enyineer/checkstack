import { implement } from "@orpc/server";
import type { RpcContext } from "@checkmate/backend-api";
import { catalogContract, permissions } from "@checkmate/catalog-common";
import { EntityService } from "./services/entity-service";
import { OperationService } from "./services/operation-service";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

// Create implementer from contract with our context
const os = implement(catalogContract).$context<RpcContext>();

// Create middleware
const authMiddleware = os.middleware(async ({ next, context }) => {
  if (!context.user) {
    throw new Error("Unauthorized");
  }
  return next({ context: { user: context.user } });
});

const catalogRead = os.middleware(async ({ next, context }) => {
  const userPermissions = context.user?.permissions || [];
  const hasPermission =
    userPermissions.includes("*") ||
    userPermissions.includes(permissions.catalogRead.id);
  if (!hasPermission) {
    throw new Error(`Forbidden: Missing ${permissions.catalogRead.id}`);
  }
  return next({});
});

const catalogManage = os.middleware(async ({ next, context }) => {
  const userPermissions = context.user?.permissions || [];
  const hasPermission =
    userPermissions.includes("*") ||
    userPermissions.includes(permissions.catalogManage.id);
  if (!hasPermission) {
    throw new Error(`Forbidden: Missing ${permissions.catalogManage.id}`);
  }
  return next({});
});

export const createCatalogRouter = (
  database: NodePgDatabase<typeof schema>
) => {
  const entityService = new EntityService(database);
  const operationService = new OperationService(database);

  // Implement each contract method
  const getEntities = os.getEntities
    .use(authMiddleware)
    .use(catalogRead)
    .handler(async () => {
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

  const getSystems = os.getSystems
    .use(authMiddleware)
    .use(catalogRead)
    .handler(async () => {
      const systems = await entityService.getSystems();
      return systems as unknown as Array<
        (typeof systems)[number] & { metadata: Record<string, unknown> | null }
      >;
    });

  const getGroups = os.getGroups
    .use(authMiddleware)
    .use(catalogRead)
    .handler(async () => {
      const groups = await entityService.getGroups();
      return groups as unknown as Array<
        (typeof groups)[number] & { metadata: Record<string, unknown> | null }
      >;
    });

  const createSystem = os.createSystem
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      const result = await entityService.createSystem(input);
      return result as typeof result & {
        metadata: Record<string, unknown> | null;
      };
    });

  const updateSystem = os.updateSystem
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      // Convert null to undefined and filter out fields
      const cleanData: Partial<{
        name: string;
        description?: string;
        owner?: string;
        status?: "healthy" | "degraded" | "unhealthy";
        metadata?: Record<string, unknown>;
      }> = {};
      if (input.data.name !== undefined) cleanData.name = input.data.name;
      if (input.data.description !== undefined)
        cleanData.description = input.data.description ?? undefined;
      if (input.data.owner !== undefined)
        cleanData.owner = input.data.owner ?? undefined;
      if (input.data.status !== undefined)
        cleanData.status = input.data.status as
          | "healthy"
          | "degraded"
          | "unhealthy";
      if (input.data.metadata !== undefined)
        cleanData.metadata = input.data.metadata ?? undefined;

      const result = await entityService.updateSystem(input.id, cleanData);
      if (!result) throw new Error("System not found");
      return result as typeof result & {
        metadata: Record<string, unknown> | null;
      };
    });

  const deleteSystem = os.deleteSystem
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      await entityService.deleteSystem(input);
      return { success: true };
    });

  const createGroup = os.createGroup
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      const result = await entityService.createGroup({
        name: input.name,
        metadata: input.metadata,
      });
      // New groups have no systems yet
      return {
        ...result,
        systemIds: [],
        metadata: result.metadata as Record<string, unknown> | null,
      };
    });

  const updateGroup = os.updateGroup
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      // Convert null to undefined for optional fields
      const cleanData = {
        ...input.data,
        metadata: input.data.metadata ?? undefined,
      };
      const result = await entityService.updateGroup(input.id, cleanData);
      if (!result) throw new Error("Group not found");
      // Get the full group with systemIds after update
      const groups = await entityService.getGroups();
      const fullGroup = groups.find((g) => g.id === result.id);
      if (!fullGroup) throw new Error("Group not found after update");
      return fullGroup as unknown as typeof fullGroup & {
        metadata: Record<string, unknown> | null;
      };
    });

  const deleteGroup = os.deleteGroup
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      await entityService.deleteGroup(input);
      return { success: true };
    });

  const addSystemToGroup = os.addSystemToGroup
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      await entityService.addSystemToGroup(input);
      return { success: true };
    });

  const removeSystemFromGroup = os.removeSystemFromGroup
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      await entityService.removeSystemFromGroup(input);
      return { success: true };
    });

  const getViews = os.getViews
    .use(authMiddleware)
    .use(catalogRead)
    .handler(async () => entityService.getViews());

  const createView = os.createView
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      return entityService.createView(input);
    });

  const getIncidents = os.getIncidents
    .use(authMiddleware)
    .use(catalogRead)
    .handler(async () => operationService.getIncidents());

  const createIncident = os.createIncident
    .use(authMiddleware)
    .use(catalogManage)
    .handler(async ({ input }) => {
      // Ensure status and severity have defaults
      return operationService.createIncident({
        ...input,
        status: input.status ?? "open",
        severity: input.severity ?? "medium",
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
    getIncidents,
    createIncident,
  });
};

export type CatalogRouter = ReturnType<typeof createCatalogRouter>;
