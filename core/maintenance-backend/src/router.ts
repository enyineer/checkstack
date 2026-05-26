import { implement, ORPCError } from "@orpc/server";
import {
  maintenanceContract,
  MAINTENANCE_UPDATED,
} from "@checkstack/maintenance-common";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  Logger,
  type RpcContext,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { MaintenanceService } from "./service";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import type { InferClient } from "@checkstack/common";
import { maintenanceHooks } from "./hooks";
import { notifyAffectedSystems } from "./notifications";
import type { MaintenanceUpdate } from "@checkstack/maintenance-common";
import type { MaintenanceCache } from "./cache";

export function createRouter(
  service: MaintenanceService,
  signalService: SignalService,
  catalogClient: InferClient<typeof CatalogApi>,
  notificationClient: InferClient<
    typeof import("@checkstack/notification-common").NotificationApi
  >,
  authClient: InferClient<typeof AuthApi>,
  logger: Logger,
  cache: MaintenanceCache,
) {
  /**
   * Resolve user IDs to profile names for a list of updates.
   * Falls back to undefined if the user cannot be found.
   */
  async function resolveUserNames(
    updates: MaintenanceUpdate[],
  ): Promise<MaintenanceUpdate[]> {
    const userIds = [
      ...new Set(updates.map((u) => u.createdBy).filter(Boolean)),
    ];
    if (userIds.length === 0) return updates;

    const userMap = new Map<string, string>();
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await authClient.getUserById({ userId: userId! });
          if (user?.name) {
            userMap.set(userId!, user.name);
          }
        } catch {
          // User not found, skip
        }
      }),
    );

    return updates.map((update) => ({
      ...update,
      createdByName: update.createdBy
        ? (userMap.get(update.createdBy) ?? undefined)
        : undefined,
    }));
  }

  /**
   * Fetch system names for a list of system IDs.
   */
  async function resolveSystemNames(
    systemIds: string[],
  ): Promise<Map<string, string>> {
    const systemNames = new Map<string, string>();
    if (systemIds.length === 0) return systemNames;

    await Promise.all(
      [...new Set(systemIds)].map(async (systemId) => {
        try {
          const system = await catalogClient.getSystem({ systemId });
          if (system?.name) {
            systemNames.set(systemId, system.name);
          }
        } catch {
          // System not found, skip
        }
      }),
    );
    return systemNames;
  }

  const os = implement(maintenanceContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    listMaintenances: os.listMaintenances.handler(async ({ input }) => {
      return {
        maintenances: await cache.wrapList(input ?? {}, () =>
          service.listMaintenances(input ?? {}),
        ),
      };
    }),

    getMaintenance: os.getMaintenance.handler(async ({ input }) => {
      const result = await cache.wrapMaintenance(input.id, () =>
        service.getMaintenance(input.id),
      );
      if (!result) {
         
        return null;
      }
      // User-name resolution stays outside the cache: it's a foreign-system
      // lookup with its own freshness needs.
      const updatesWithNames = await resolveUserNames(result.updates);
      return { ...result, updates: updatesWithNames };
    }),

    getMaintenancesForSystem: os.getMaintenancesForSystem.handler(
      async ({ input }) => {
        return cache.wrapSystem(input.systemId, () =>
          service.getMaintenancesForSystem(input.systemId),
        );
      },
    ),

    getBulkMaintenancesForSystems: os.getBulkMaintenancesForSystems.handler(
      async ({ input }) => {
        // Per-entity caching: see ./cache.ts for the invalidation contract.
        const maintenances: Record<
          string,
          Awaited<ReturnType<typeof service.getMaintenancesForSystem>>
        > = {};
        await Promise.all(
          input.systemIds.map(async (systemId) => {
            maintenances[systemId] = await cache.wrapSystem(systemId, () =>
              service.getMaintenancesForSystem(systemId),
            );
          }),
        );
        return { maintenances };
      },
    ),

    createMaintenance: os.createMaintenance.handler(
      async ({ input, context }) => {
        const result = await service.createMaintenance(input);

        // Invalidate before signal so any frontend that refetches in
        // response sees fresh data. Mutation invariant in this file:
        // db.write → cache.invalidate (await) → signals.emit.
        await cache.invalidateForMutation({
          maintenanceId: result.id,
          systemIds: result.systemIds,
        });

        // Broadcast signal for realtime updates
        await signalService.broadcast(MAINTENANCE_UPDATED, {
          maintenanceId: result.id,
          systemIds: result.systemIds,
          action: "created",
        });

        // Emit hook for cross-plugin coordination and integrations
        await context.emitHook(maintenanceHooks.maintenanceCreated, {
          maintenanceId: result.id,
          systemIds: result.systemIds,
          title: result.title,
          description: result.description,
          status: result.status,
          startAt: result.startAt.toISOString(),
          endAt: result.endAt.toISOString(),
        });

        // Send notifications to system subscribers
        const systemNames = await resolveSystemNames(result.systemIds);
        await notifyAffectedSystems({
          catalogClient,
          notificationClient,
          logger,
          maintenanceId: result.id,
          maintenanceTitle: result.title,
          systemIds: result.systemIds,
          systemNames,
          action: "created",
        });

        return result;
      },
    ),

    updateMaintenance: os.updateMaintenance.handler(
      async ({ input, context }) => {
        const result = await service.updateMaintenance(input);
        if (!result) {
          throw new ORPCError("NOT_FOUND", {
            message: "Maintenance not found",
          });
        }

        await cache.invalidateForMutation({
          maintenanceId: result.id,
          systemIds: result.systemIds,
        });

        // Broadcast signal for realtime updates
        await signalService.broadcast(MAINTENANCE_UPDATED, {
          maintenanceId: result.id,
          systemIds: result.systemIds,
          action: "updated",
        });

        // Emit hook for cross-plugin coordination and integrations
        await context.emitHook(maintenanceHooks.maintenanceUpdated, {
          maintenanceId: result.id,
          systemIds: result.systemIds,
          title: result.title,
          description: result.description,
          status: result.status,
          startAt: result.startAt.toISOString(),
          endAt: result.endAt.toISOString(),
          action: "updated",
        });

        return result;
      },
    ),

    addUpdate: os.addUpdate.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;

      // Get previous status before update for comparison
      const previousMaintenance = input.statusChange
        ? await service.getMaintenance(input.maintenanceId)
        : undefined;
      const previousStatus = previousMaintenance?.status;

      const result = await service.addUpdate(input, userId);
      // Read post-write state directly from the service so the broadcast
      // payload is fresh; the cache is invalidated below before the signal.
      const maintenance = await service.getMaintenance(input.maintenanceId);
      if (maintenance) {
        await cache.invalidateForMutation({
          maintenanceId: input.maintenanceId,
          systemIds: maintenance.systemIds,
        });

        // Determine action based on status change
        const action =
          input.statusChange === "completed" ? "closed" : "updated";

        await signalService.broadcast(MAINTENANCE_UPDATED, {
          maintenanceId: input.maintenanceId,
          systemIds: maintenance.systemIds,
          action,
        });

        // Emit hook for cross-plugin coordination and integrations
        await context.emitHook(maintenanceHooks.maintenanceUpdated, {
          maintenanceId: input.maintenanceId,
          systemIds: maintenance.systemIds,
          title: maintenance.title,
          description: maintenance.description,
          status: maintenance.status,
          startAt: maintenance.startAt.toISOString(),
          endAt: maintenance.endAt.toISOString(),
          action,
        });

        // Send notifications when status actually changes
        if (input.statusChange && previousStatus !== input.statusChange) {
          // Determine notification action based on the actual status transition
          let notificationAction: "started" | "completed" | "updated";
          if (
            input.statusChange === "in_progress" &&
            previousStatus !== "in_progress"
          ) {
            notificationAction = "started";
          } else if (input.statusChange === "completed") {
            notificationAction = "completed";
          } else {
            notificationAction = "updated";
          }

          const systemNames = await resolveSystemNames(maintenance.systemIds);
          await notifyAffectedSystems({
            catalogClient,
            notificationClient,
            logger,
            maintenanceId: input.maintenanceId,
            maintenanceTitle: maintenance.title,
            systemIds: maintenance.systemIds,
            systemNames,
            action: notificationAction,
          });
        }
      }
      return result;
    }),

    closeMaintenance: os.closeMaintenance.handler(
      async ({ input, context }) => {
        const userId =
          context.user && "id" in context.user ? context.user.id : undefined;
        const result = await service.closeMaintenance(
          input.id,
          input.message,
          userId,
        );
        if (!result) {
          throw new ORPCError("NOT_FOUND", {
            message: "Maintenance not found",
          });
        }
        await cache.invalidateForMutation({
          maintenanceId: result.id,
          systemIds: result.systemIds,
        });
        // Broadcast signal for realtime updates
        await signalService.broadcast(MAINTENANCE_UPDATED, {
          maintenanceId: result.id,
          systemIds: result.systemIds,
          action: "closed",
        });

        // Emit hook for cross-plugin coordination and integrations
        await context.emitHook(maintenanceHooks.maintenanceUpdated, {
          maintenanceId: result.id,
          systemIds: result.systemIds,
          title: result.title,
          description: result.description,
          status: result.status,
          startAt: result.startAt.toISOString(),
          endAt: result.endAt.toISOString(),
          action: "closed",
        });

        // Send notifications to system subscribers
        const systemNames = await resolveSystemNames(result.systemIds);
        await notifyAffectedSystems({
          catalogClient,
          notificationClient,
          logger,
          maintenanceId: result.id,
          maintenanceTitle: result.title,
          systemIds: result.systemIds,
          systemNames,
          action: "completed",
        });

        return result;
      },
    ),

    deleteMaintenance: os.deleteMaintenance.handler(async ({ input }) => {
      // Get maintenance before deleting to get systemIds
      const maintenance = await service.getMaintenance(input.id);
      const success = await service.deleteMaintenance(input.id);
      if (success && maintenance) {
        await cache.invalidateForMutation({
          maintenanceId: input.id,
          systemIds: maintenance.systemIds,
        });

        await signalService.broadcast(MAINTENANCE_UPDATED, {
          maintenanceId: input.id,
          systemIds: maintenance.systemIds,
          action: "closed", // Use "closed" for delete as well
        });
      }
      return { success };
    }),

    hasActiveMaintenanceWithSuppression:
      os.hasActiveMaintenanceWithSuppression.handler(async ({ input }) => {
        const suppressed = await service.hasActiveMaintenanceWithSuppression(
          input.systemId,
        );
        return { suppressed };
      }),

    addLink: os.addLink.handler(async ({ input }) => {
      const maintenance = await service.getMaintenance(input.maintenanceId);
      if (!maintenance) {
        throw new ORPCError("NOT_FOUND", { message: "Maintenance not found" });
      }
      const link = await service.addLink(input);
      await cache.invalidateForMutation({
        maintenanceId: maintenance.id,
        systemIds: maintenance.systemIds,
      });
      return link;
    }),

    removeLink: os.removeLink.handler(async ({ input }) => {
      const maintenanceId = await service.removeLink(input.id);
      if (!maintenanceId) {
        return { success: false };
      }
      const maintenance = await service.getMaintenance(maintenanceId);
      if (maintenance) {
        await cache.invalidateForMutation({
          maintenanceId,
          systemIds: maintenance.systemIds,
        });
      }
      return { success: true };
    }),
  });
}
