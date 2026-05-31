import { implement, ORPCError } from "@orpc/server";
import { autoAuthMiddleware, correlationMiddleware, type RpcContext } from "@checkstack/backend-api";
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
import { eq } from "drizzle-orm";
import { GitOpsApi } from "@checkstack/gitops-common";
import type { CatalogCache } from "./cache";
import type { EntityHandle } from "@checkstack/automation-backend";
import {
  removeCatalogEntity,
  toCatalogGroupState,
  toCatalogSystemState,
  writeCatalogGroupEntity,
  writeCatalogSystemEntity,
  type CatalogGroupState,
  type CatalogSystemState,
} from "./catalog-entity";

/**
 * Creates the catalog router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
const os = implement(catalogContract)
  .$context<RpcContext>()
  .use(correlationMiddleware)
  .use(autoAuthMiddleware);

export interface CatalogRouterDeps {
  database: SafeDatabase<typeof schema>;
  notificationClient: InferClient<typeof NotificationApi>;
  authClient: InferClient<typeof AuthApi>;
  gitOpsClient: InferClient<typeof GitOpsApi>;
  pluginId: string;
  cache: CatalogCache;
  /** Resolvers for the reactive catalog entities (§10.4). Undefined in tests. */
  getSystemEntity?: () => EntityHandle<CatalogSystemState> | undefined;
  getGroupEntity?: () => EntityHandle<CatalogGroupState> | undefined;
}

export const createCatalogRouter = ({
  database,
  notificationClient,
  authClient,
  gitOpsClient,
  pluginId: _pluginId,
  cache,
  getSystemEntity,
  getGroupEntity,
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

  const createSystem = os.createSystem.handler(async ({ input }) => {
    // Drive the create through the reactive `catalog-system` entity (§10.4):
    // `apply` performs the REAL `systems` write (the plugin's own db/tx) and
    // returns the new reactive state; the deriver fires `catalog.created`
    // from the resulting change. The id is generated up front so the handle
    // is keyed on it and the create's `prev` snapshot correctly reads the
    // not-yet-existing row as absent.
    const systemId = crypto.randomUUID();
    let result!: Awaited<ReturnType<typeof entityService.createSystem>>;
    await writeCatalogSystemEntity({
      handle: getSystemEntity?.(),
      systemId,
      apply: async () => {
        result = await entityService.createSystem(input, systemId);
        return toCatalogSystemState({
          name: result.name,
          description: result.description,
          metadata: result.metadata as Record<string, unknown> | null,
        });
      },
    });

    // Push the new system into notification-backend's resource registry.
    // notification-backend handles all per-spec group provisioning from
    // this single signal — catalog never authors notification groups
    // directly.
    await upsertSystemResource({ id: result.id, name: result.name });
    await refreshSystemParents(result.id);

    await cache.invalidateTopology();

    return result as typeof result & {
      metadata: Record<string, unknown> | null;
    };
  });

  const updateSystem = os.updateSystem.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("System", input.id);
    // Convert null to undefined and filter out fields. The entity mirror
    // diffs internally now, so we no longer track `changedFields` for a
    // hook payload (§10.4).
    const cleanData: Partial<{
      name: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }> = {};
    if (input.data.name !== undefined) {
      cleanData.name = input.data.name;
    }
    if (input.data.description !== undefined) {
      cleanData.description = input.data.description ?? undefined;
    }
    if (input.data.metadata !== undefined) {
      cleanData.metadata = input.data.metadata ?? undefined;
    }

    // Probe existence first so a missing system still surfaces as NOT_FOUND
    // without driving an entity write.
    const exists = await entityService.getSystem(input.id);
    if (!exists) {
      throw new ORPCError("NOT_FOUND", {
        message: "System not found",
      });
    }

    // Drive the update through the reactive `catalog-system` entity (§10.4).
    // The REAL update runs INSIDE `apply`, so `prev` is snapshotted before
    // the write and the deriver fires `catalog.updated` from the resulting
    // change. The handle diffs internally, so a save-with-no-diff stays a
    // no-op — preserving the old "don't fire automations on no-op updates"
    // behavior without the explicit `changedFields` guard.
    let result!: NonNullable<
      Awaited<ReturnType<typeof entityService.updateSystem>>
    >;
    await writeCatalogSystemEntity({
      handle: getSystemEntity?.(),
      systemId: input.id,
      apply: async () => {
        const updated = await entityService.updateSystem(input.id, cleanData);
        if (!updated) {
          throw new ORPCError("NOT_FOUND", { message: "System not found" });
        }
        result = updated;
        return toCatalogSystemState({
          name: result.name,
          description: result.description,
          metadata: result.metadata as Record<string, unknown> | null,
        });
      },
    });

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

  const deleteSystem = os.deleteSystem.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("System", input);

    // Drive the delete through the reactive `catalog-system` entity tombstone
    // (§10.4). The REAL delete runs INSIDE `apply`, so `prev` is snapshotted
    // before it and the deriver fires `catalog.deleted` from the tombstone.
    // Cross-plugin cleanup reactors (incident/dependency/slo/healthcheck)
    // subscribe to that `catalog-system` tombstone via onEntityChanged.
    await removeCatalogEntity({
      handle: getSystemEntity?.(),
      id: input,
      apply: async () => {
        await entityService.deleteSystem(input);
      },
    });

    await removeSystemResource(input);

    // Drop catalog topology + this system's contacts so downstream plugins
    // (e.g. healthcheck) and any frontend that refetches in response see
    // fresh data.
    await Promise.all([
      cache.invalidateTopology(),
      cache.invalidateContacts(input),
    ]);

    return { success: true };
  });

  const createGroup = os.createGroup.handler(async ({ input }) => {
    // Drive the create through the reactive `catalog-group` entity (§10.4):
    // `apply` performs the REAL `groups` write and returns the new reactive
    // state; the deriver fires `catalog.group.created`. The id is generated
    // up front so the handle is keyed on it and the create's `prev` snapshot
    // reads the not-yet-existing row as absent.
    const groupId = crypto.randomUUID();
    let result!: Awaited<ReturnType<typeof entityService.createGroup>>;
    await writeCatalogGroupEntity({
      handle: getGroupEntity?.(),
      groupId,
      apply: async () => {
        result = await entityService.createGroup(
          { name: input.name, metadata: input.metadata },
          groupId,
        );
        return toCatalogGroupState({
          name: result.name,
          metadata: result.metadata as Record<string, unknown> | null,
        });
      },
    });

    await upsertGroupResource({ id: result.id, name: result.name });

    await cache.invalidateTopology();

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
    // Probe existence first so a missing group still surfaces as NOT_FOUND
    // without driving an entity write.
    const existing = await entityService.getGroups();
    const existingGroup = existing.find((g) => g.id === input.id);
    if (!existingGroup) {
      throw new ORPCError("NOT_FOUND", {
        message: "Group not found",
      });
    }

    // Drive the update through the reactive `catalog-group` entity (§10.4).
    // The REAL update runs INSIDE `apply`, so `prev` is snapshotted before
    // the write. There is no `catalog.group.updated` hook, so the deriver
    // fires nothing on a pure update — but the entity state stays current
    // for scope/conditions.
    let fullGroup!: NonNullable<
      Awaited<ReturnType<typeof entityService.getGroups>>[number]
    >;
    await writeCatalogGroupEntity({
      handle: getGroupEntity?.(),
      groupId: input.id,
      apply: async () => {
        const result = await entityService.updateGroup(input.id, cleanData);
        if (!result) {
          throw new ORPCError("NOT_FOUND", { message: "Group not found" });
        }
        // Get the full group with systemIds after update
        const groups = await entityService.getGroups();
        const updated = groups.find((g) => g.id === result.id);
        if (!updated) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Group not found after update",
          });
        }
        fullGroup = updated;
        return toCatalogGroupState({
          name: fullGroup.name,
          metadata: fullGroup.metadata as Record<string, unknown> | null,
        });
      },
    });

    await cache.invalidateTopology();
    if (input.data.name !== undefined) {
      await upsertGroupResource({ id: fullGroup.id, name: fullGroup.name });
    }

    return fullGroup as unknown as typeof fullGroup & {
      metadata: Record<string, unknown> | null;
    };
  });

  const deleteGroup = os.deleteGroup.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("Group", input);

    // Drive the delete through the reactive `catalog-group` entity tombstone
    // (§10.4). The REAL delete runs INSIDE `apply`; the deriver fires
    // `catalog.group.deleted` from the tombstone.
    await removeCatalogEntity({
      handle: getGroupEntity?.(),
      id: input,
      apply: async () => {
        await entityService.deleteGroup(input);
      },
    });

    await removeGroupResource(input);

    await cache.invalidateTopology();

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

  // System Links handlers (free-form URL hotlinks attached to a system)
  const getSystemLinks = os.getSystemLinks.handler(async ({ input }) =>
    cache.wrapLinks(input.systemId, async () =>
      entityService.getLinksForSystem(input.systemId),
    ),
  );

  const addSystemLink = os.addSystemLink.handler(async ({ input }) => {
    await enforceNotGitOpsLocked("System", input.systemId);
    const result = await entityService.addLink({
      systemId: input.systemId,
      label: input.label,
      url: input.url,
    });
    await cache.invalidateLinks(input.systemId);
    return result;
  });

  const removeSystemLink = os.removeSystemLink.handler(async ({ input }) => {
    const removed = await entityService.removeLink(input);
    if (removed) {
      await enforceNotGitOpsLocked("System", removed.systemId);
      await cache.invalidateLinks(removed.systemId);
    }
    return { success: !!removed };
  });

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
    getSystemLinks,
    addSystemLink,
    removeSystemLink,
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
