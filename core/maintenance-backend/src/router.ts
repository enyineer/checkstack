import { implement, ORPCError } from "@orpc/server";
import {
  maintenanceContract,
  MAINTENANCE_UPDATED,
} from "@checkstack/maintenance-common";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  Logger,
  resolveActor,
  type RpcContext,
} from "@checkstack/backend-api";
import type { EntityHandle } from "@checkstack/automation-backend";
import type { SignalService } from "@checkstack/signal-common";
import type { MaintenanceService } from "./service";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import type { InferClient } from "@checkstack/common";
import { notifyAffectedSystems } from "./notifications";
import type { MaintenanceUpdate } from "@checkstack/maintenance-common";
import type { MaintenanceCache } from "./cache";
import {
  removeMaintenanceEntity,
  toMaintenanceEntityState,
  writeMaintenanceEntity,
  type MaintenanceEntityState,
} from "./entity";

export interface MaintenanceRouterDeps {
  service: MaintenanceService;
  signalService: SignalService;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<
    typeof import("@checkstack/notification-common").NotificationApi
  >;
  authClient: InferClient<typeof AuthApi>;
  logger: Logger;
  cache: MaintenanceCache;
  /**
   * Reactive `maintenance` entity handle (reactive automation engine §10.2).
   * PLUGIN-BACKED (Model B): the `maintenances` + `maintenance_systems` tables
   * ARE the current-state storage. Mutation sites drive the REAL write through
   * `handle.mutate` / `handle.remove` (the write runs inside `apply`); the
   * change-deriver re-emits the `maintenance.created` / `maintenance.updated`
   * trigger events that automations match.
   */
  entityHandle: EntityHandle<MaintenanceEntityState>;
}

export function createRouter({
  service,
  signalService,
  catalogClient,
  notificationClient,
  authClient,
  logger,
  cache,
  entityHandle,
}: MaintenanceRouterDeps) {
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
        // Drive the create through the reactive `maintenance` entity (§10.2):
        // `apply` performs the REAL `maintenances`/junction write (the plugin's
        // own db/tx) and returns the new reactive state; the deriver fires
        // `maintenance.created` from the resulting change. The id is generated
        // up front so the handle is keyed on it and the create's `prev`
        // snapshot correctly reads the not-yet-existing row as absent.
        const maintenanceId = crypto.randomUUID();
        let result!: Awaited<ReturnType<typeof service.createMaintenance>>;
        await writeMaintenanceEntity({
          handle: entityHandle,
          maintenanceId,
          opts: { actor: resolveActor(context.user) },
          apply: async () => {
            result = await service.createMaintenance(input, maintenanceId);
            return toMaintenanceEntityState(result);
          },
        });

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
        // Probe existence first so a missing maintenance still surfaces as
        // NOT_FOUND without driving an entity write.
        const exists = await service.getMaintenance(input.id);
        if (!exists) {
          throw new ORPCError("NOT_FOUND", {
            message: "Maintenance not found",
          });
        }

        // Drive the update through the reactive `maintenance` entity (§10.2);
        // `apply` performs the REAL update (the plugin's own db/tx) and returns
        // the new reactive state. The deriver fires `maintenance.updated` from
        // the resulting change.
        let result!: NonNullable<
          Awaited<ReturnType<typeof service.updateMaintenance>>
        >;
        await writeMaintenanceEntity({
          handle: entityHandle,
          maintenanceId: input.id,
          opts: { actor: resolveActor(context.user) },
          apply: async () => {
            const updated = await service.updateMaintenance(input);
            if (!updated) {
              throw new ORPCError("NOT_FOUND", {
                message: "Maintenance not found",
              });
            }
            result = updated;
            return toMaintenanceEntityState(result);
          },
        });

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

      // Drive the update through the reactive `maintenance` entity (§10.2).
      // `apply` posts the update row + (optionally) flips status in the
      // plugin's own db/tx, then re-reads the post-write reactive state. The
      // deriver fires `maintenance.updated` purely from the entity diff; when
      // the status/window is unchanged, the diff is empty and no event fires.
      let result!: Awaited<ReturnType<typeof service.addUpdate>>;
      let maintenance: Awaited<ReturnType<typeof service.getMaintenance>>;
      await writeMaintenanceEntity({
        handle: entityHandle,
        maintenanceId: input.maintenanceId,
        opts: { actor: resolveActor(context.user) },
        apply: async () => {
          result = await service.addUpdate(input, userId);
          maintenance = await service.getMaintenance(input.maintenanceId);
          // The maintenance must exist (the update FK-references it); guard for
          // the type and to fail loudly if it vanished mid-write.
          if (!maintenance) {
            throw new ORPCError("NOT_FOUND", {
              message: "Maintenance not found",
            });
          }
          return toMaintenanceEntityState(maintenance);
        },
      });

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

        // Probe existence first so a missing maintenance still surfaces as
        // NOT_FOUND without driving an entity write.
        const exists = await service.getMaintenance(input.id);
        if (!exists) {
          throw new ORPCError("NOT_FOUND", {
            message: "Maintenance not found",
          });
        }

        // Drive the close through the reactive `maintenance` entity (§10.2);
        // `apply` performs the REAL close (status → completed, the plugin's own
        // db/tx) and returns the new reactive state. The deriver fires
        // `maintenance.updated` from the status transition.
        let result!: NonNullable<
          Awaited<ReturnType<typeof service.closeMaintenance>>
        >;
        await writeMaintenanceEntity({
          handle: entityHandle,
          maintenanceId: input.id,
          opts: { actor: resolveActor(context.user) },
          apply: async () => {
            const closed = await service.closeMaintenance(
              input.id,
              input.message,
              userId,
            );
            if (!closed) {
              throw new ORPCError("NOT_FOUND", {
                message: "Maintenance not found",
              });
            }
            result = closed;
            return toMaintenanceEntityState(result);
          },
        });

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

    deleteMaintenance: os.deleteMaintenance.handler(async ({ input, context }) => {
      // Get maintenance before deleting to get systemIds
      const maintenance = await service.getMaintenance(input.id);

      // Drive the delete through the reactive `maintenance` entity tombstone
      // (§10.2). `apply` performs the REAL delete (the plugin's own db/tx);
      // the framework records the tombstone transition and emits a tombstone
      // change. The deriver fires nothing, matching the historical behaviour
      // where delete emitted no maintenance hook.
      let success = false;
      await removeMaintenanceEntity({
        handle: entityHandle,
        maintenanceId: input.id,
        opts: { actor: resolveActor(context.user) },
        apply: async () => {
          success = await service.deleteMaintenance(input.id);
        },
      });

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

    hasActiveMaintenance: os.hasActiveMaintenance.handler(async ({ input }) => {
      const active = await service.hasActiveMaintenance(input.systemId);
      return { active };
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
