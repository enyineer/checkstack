import { implement, ORPCError } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkstack/backend-api";
import {
  catalogContract,
  catalogSystemTarget,
  catalogGroupTarget,
  type SystemContact,
} from "@checkstack/catalog-common";
import { EntityService } from "./services/entity-service";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { NotificationApi } from "@checkstack/notification-common";
import { AuthApi } from "@checkstack/auth-common";
import type { InferClient } from "@checkstack/common";
import { catalogHooks } from "./hooks";
import { eq } from "drizzle-orm";
import { GitOpsApi } from "@checkstack/gitops-common";
import type { CatalogCache } from "./cache";

/**
 * Creates the catalog router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
const os = implement(catalogContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export interface CatalogRouterDeps {
  database: SafeDatabase<typeof schema>;
  notificationClient: InferClient<typeof NotificationApi>;
  authClient: InferClient<typeof AuthApi>;
  gitOpsClient: InferClient<typeof GitOpsApi>;
  pluginId: string;
  cache: CatalogCache;
}

export const createCatalogRouter = ({
  database,
  notificationClient,
  authClient,
  gitOpsClient,
  pluginId: _pluginId,
  cache,
}: CatalogRouterDeps) => {
  const entityService = new EntityService(database);

  const enforceNotGitOpsLocked = async (kind: string, entityId: string) => {
    const provenance = await gitOpsClient.getProvenance({
      kind,
      entityId,
    });
    if (provenance) {
      throw new ORPCError("FORBIDDEN", {
        message: `${kind} is managed by GitOps and cannot be modified manually.`,
      });
    }
  };

  // Resource lifecycle: catalog pushes systems and groups into
  // notification-backend's resource registry. The platform takes over
  // from there — registering specs, provisioning per-resource groups,
  // walking parent edges at dispatch time. Catalog never directly
  // creates per-resource notification groups any more.
  const upsertSystemResource = async (system: { id: string; name: string }) => {
    try {
      await notificationClient.upsertNotificationResource({
        targetTypeId: catalogSystemTarget.targetTypeId,
        resource: { resourceKey: system.id, displayLabel: system.name },
      });
    } catch (error) {
      console.warn(
        `Failed to upsert notification resource for system ${system.id}:`,
        error,
      );
    }
  };

  const upsertGroupResource = async (group: { id: string; name: string }) => {
    try {
      await notificationClient.upsertNotificationResource({
        targetTypeId: catalogGroupTarget.targetTypeId,
        resource: { resourceKey: group.id, displayLabel: group.name },
      });
    } catch (error) {
      console.warn(
        `Failed to upsert notification resource for catalog group ${group.id}:`,
        error,
      );
    }
  };

  const refreshSystemParents = async (systemId: string) => {
    try {
      const groups = await entityService.getGroups();
      const parents = groups
        .filter((g) => g.systemIds?.includes(systemId))
        .map((g) => ({
          parentTargetTypeId: catalogGroupTarget.targetTypeId,
          parentResourceKey: g.id,
        }));
      await notificationClient.setNotificationResourceParents({
        childTargetTypeId: catalogSystemTarget.targetTypeId,
        childResourceKey: systemId,
        parents,
      });
    } catch (error) {
      console.warn(
        `Failed to refresh notification parents for system ${systemId}:`,
        error,
      );
    }
  };

  const removeSystemResource = async (systemId: string) => {
    try {
      await notificationClient.removeNotificationResource({
        targetTypeId: catalogSystemTarget.targetTypeId,
        resourceKey: systemId,
      });
    } catch (error) {
      console.warn(
        `Failed to remove notification resource for system ${systemId}:`,
        error,
      );
    }
  };

  const removeGroupResource = async (groupId: string) => {
    try {
      await notificationClient.removeNotificationResource({
        targetTypeId: catalogGroupTarget.targetTypeId,
        resourceKey: groupId,
      });
    } catch (error) {
      console.warn(
        `Failed to remove notification resource for catalog group ${groupId}:`,
        error,
      );
    }
  };

  // Implement each contract method
  const getEntities = os.getEntities.handler(async () =>
    cache.wrapEntities(async () => {
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
          (typeof groups)[number] & {
            metadata: Record<string, unknown> | null;
          }
        >,
      };
    }),
  );

  const getSystems = os.getSystems.handler(async () =>
    cache.wrapSystems(async () => {
      const systems = await entityService.getSystems();
      return {
        systems: systems as unknown as Array<
          (typeof systems)[number] & {
            metadata: Record<string, unknown> | null;
          }
        >,
      };
    }),
  );

  const getSystem = os.getSystem.handler(async ({ input }) =>
    cache.wrapSystem(input.systemId, async () => {
      const system = await entityService.getSystem(input.systemId);
      if (!system) {
        // oRPC contract uses .nullable() which requires null
         
        return null;
      }
      return system as typeof system & {
        metadata: Record<string, unknown> | null;
      };
    }),
  );

  const getGroups = os.getGroups.handler(async () =>
    cache.wrapGroups(async () => {
      const groups = await entityService.getGroups();
      return groups as unknown as Array<
        (typeof groups)[number] & { metadata: Record<string, unknown> | null }
      >;
    }),
  );

  const getSystemGroups = os.getSystemGroups.handler(
    async ({ input }) => {
      // Fetch all groups (cache-warm), then filter to those that contain
      // the system. This is cheaper than a per-system join because
      // `getGroups()` already produces the full populated list and is
      // cached topology-wide; per-system mutations invalidate this cache
      // alongside everything else.
      const groups = await entityService.getGroups();
      const filtered = groups.filter((group) =>
        group.systemIds?.includes(input.systemId),
      );
      return filtered as unknown as Array<
        (typeof filtered)[number] & {
          metadata: Record<string, unknown> | null;
        }
      >;
    },
  );

  const createSystem = os.createSystem.handler(async ({ input, context }) => {
    const result = await entityService.createSystem(input);

    // Push the new system into notification-backend's resource registry.
    // notification-backend handles all per-spec group provisioning from
    // this single signal — catalog never authors notification groups
    // directly.
    await upsertSystemResource({ id: result.id, name: result.name });
    await refreshSystemParents(result.id);

    await cache.invalidateTopology();

    // Hooks remain for non-notification cleanup concerns (e.g. incident
    // associations) — emitting plugins no longer use them for
    // subscription provisioning.
    await context.emitHook(catalogHooks.systemCreated, {
      systemId: result.id,
      systemName: result.name,
    });

    return result as typeof result & {
      metadata: Record<string, unknown> | null;
    };
  });

  const updateSystem = os.updateSystem.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("System", input.id);
    // Convert null to undefined and filter out fields
    const cleanData: Partial<{
      name: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }> = {};
    if (input.data.name !== undefined) cleanData.name = input.data.name;
    if (input.data.description !== undefined)
      cleanData.description = input.data.description ?? undefined;
    if (input.data.metadata !== undefined)
      cleanData.metadata = input.data.metadata ?? undefined;

    const result = await entityService.updateSystem(input.id, cleanData);
    if (!result) {
      throw new ORPCError("NOT_FOUND", {
        message: "System not found",
      });
    }
    await cache.invalidateTopology();
    // Refresh display label in notification-backend on rename so the
    // settings/audit UI shows the current name.
    if (input.data.name !== undefined) {
      await upsertSystemResource({ id: result.id, name: result.name });
    }
    return result as typeof result & {
      metadata: Record<string, unknown> | null;
    };
  });

  const deleteSystem = os.deleteSystem.handler(async ({ input, context }) => {
    await enforceNotGitOpsLocked("System", input);
    await entityService.deleteSystem(input);

    await removeSystemResource(input);

    // Drop catalog topology + this system's contacts BEFORE the hook fires,
    // so downstream plugins (e.g. healthcheck) and any frontend that
    // refetches in response see fresh data.
    await Promise.all([
      cache.invalidateTopology(),
      cache.invalidateContacts(input),
    ]);

    // Emit hook for other plugins to clean up related data
    await context.emitHook(catalogHooks.systemDeleted, { systemId: input });

    return { success: true };
  });

  const createGroup = os.createGroup.handler(async ({ input, context }) => {
    const result = await entityService.createGroup({
      name: input.name,
      metadata: input.metadata,
    });

    await upsertGroupResource({ id: result.id, name: result.name });

    await cache.invalidateTopology();

    await context.emitHook(catalogHooks.groupCreated, {
      groupId: result.id,
      groupName: result.name,
    });

    // New groups have no systems yet
    return {
      ...result,
      systemIds: [],
      metadata: result.metadata as Record<string, unknown> | null,
    };
  });

  const updateGroup = os.updateGroup.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("Group", input.id);
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
    await cache.invalidateTopology();
    if (input.data.name !== undefined) {
      await upsertGroupResource({ id: fullGroup.id, name: fullGroup.name });
    }
    return fullGroup as unknown as typeof fullGroup & {
      metadata: Record<string, unknown> | null;
    };
  });

  const deleteGroup = os.deleteGroup.handler(async ({ input, context }) => {
    await enforceNotGitOpsLocked("Group", input);
    await entityService.deleteGroup(input);

    await removeGroupResource(input);

    await cache.invalidateTopology();

    // Emit hook for other plugins to clean up related data
    await context.emitHook(catalogHooks.groupDeleted, { groupId: input });

    return { success: true };
  });

  const addSystemToGroup = os.addSystemToGroup.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("System", input.systemId);
    await entityService.addSystemToGroup(input);
    await cache.invalidateTopology();
    // Push refreshed parent edges so notification-backend's dispatcher
    // walks the new membership when computing inherited subscribers.
    await refreshSystemParents(input.systemId);
    return { success: true };
  });

  const removeSystemFromGroup = os.removeSystemFromGroup.handler(
    async ({ input }) => {
      await enforceNotGitOpsLocked("System", input.systemId);
      await entityService.removeSystemFromGroup(input);
      await cache.invalidateTopology();
      await refreshSystemParents(input.systemId);
      return { success: true };
    },
  );

  const getViews = os.getViews.handler(async () =>
    cache.wrapViews(() => entityService.getViews()),
  );

  const createView = os.createView.handler(async ({ input }) => {
    const result = await entityService.createView({
      name: input.name,
      type: "custom",
      config: input.configuration as Record<string, unknown>,
    });
    await cache.invalidateViews();
    return result;
  });

  // System Contacts handlers
  const getSystemContacts = os.getSystemContacts.handler(async ({ input }) =>
    cache.wrapContacts(input.systemId, async () => {
      const rawContacts = await entityService.getContactsForSystem(
        input.systemId,
      );

      // Resolve user profiles for user-type contacts
      const enrichedContacts: SystemContact[] = await Promise.all(
      rawContacts.map(async (contact) => {
        if (contact.type === "user" && contact.userId) {
          // Resolve user profile via auth service
          const user = await authClient.getUserById({ userId: contact.userId });
          return {
            id: contact.id,
            systemId: contact.systemId,
            type: "user" as const,
            userId: contact.userId,
            label: contact.label,
            userName: user?.name ?? undefined,
            userEmail: user?.email ?? undefined,
            createdAt: contact.createdAt,
          };
        }
        // Mailbox contact
        return {
          id: contact.id,
          systemId: contact.systemId,
          type: "mailbox" as const,
          email: contact.email ?? "",
          label: contact.label,
          createdAt: contact.createdAt,
        };
      }),
    );

      return enrichedContacts;
    }),
  );

  const addSystemContact = os.addSystemContact.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("System", input.systemId);
    // Validate input based on type
    if (input.type === "user" && !input.userId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "userId is required for user-type contacts",
      });
    }
    if (input.type === "mailbox" && !input.email) {
      throw new ORPCError("BAD_REQUEST", {
        message: "email is required for mailbox-type contacts",
      });
    }

    const result = await entityService.addContact({
      systemId: input.systemId,
      type: input.type,
      userId: input.type === "user" ? input.userId : undefined,
      email: input.type === "mailbox" ? input.email : undefined,
      label: input.label,
    });

    await cache.invalidateContacts(input.systemId);

    // Return the enriched contact
    if (result.type === "user" && result.userId) {
      const user = await authClient.getUserById({ userId: result.userId });
      return {
        id: result.id,
        systemId: result.systemId,
        type: "user" as const,
        userId: result.userId,
        label: result.label,
        userName: user?.name ?? undefined,
        userEmail: user?.email ?? undefined,
        createdAt: result.createdAt,
      };
    }

    return {
      id: result.id,
      systemId: result.systemId,
      type: "mailbox" as const,
      email: result.email ?? "",
      label: result.label,
      createdAt: result.createdAt,
    };
  });

  const removeSystemContact = os.removeSystemContact.handler(
    async ({ input }) => {
      const contacts = await database.select().from(schema.systemContacts).where(eq(schema.systemContacts.id, input));
      if (contacts[0]) {
        await enforceNotGitOpsLocked("System", contacts[0].systemId);
      }
      await entityService.removeContact(input);
      if (contacts[0]) {
        await cache.invalidateContacts(contacts[0].systemId);
      }
      return { success: true };
    },
  );

  /**
   * Get the catalog group IDs that contain a specific system.
   * Used by the dependency plugin for batched notification deduplication.
   */
  const getSystemGroupIds = os.getSystemGroupIds.handler(
    async ({ input }) =>
      cache.wrapGroupsForSystem(input.systemId, async () => {
        const systemGroups = await database
          .select({ groupId: schema.systemsGroups.groupId })
          .from(schema.systemsGroups)
          .where(eq(schema.systemsGroups.systemId, input.systemId));

        return { groupIds: systemGroups.map((sg) => sg.groupId) };
      }),
  );

  // Build and return the router
  return os.router({
    getEntities,
    getSystems,
    getSystem,
    getGroups,
    getSystemGroups,
    createSystem,
    updateSystem,
    deleteSystem,
    getSystemContacts,
    addSystemContact,
    removeSystemContact,
    createGroup,
    updateGroup,
    deleteGroup,
    addSystemToGroup,
    removeSystemFromGroup,
    getViews,
    createView,
    getSystemGroupIds,
  });
};


export type CatalogRouter = ReturnType<typeof createCatalogRouter>;
