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
import type {
  MaintenanceUpdate,
  MaintenanceWithSystems,
  BulkMaintenanceActionResult,
} from "@checkstack/maintenance-common";
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

  /**
   * Close a single maintenance early (status → completed) and run the full
   * post-mutation sequence (entity write → cache invalidate → signal → notify).
   * Returns `"notFound"` for a missing maintenance WITHOUT throwing, so the
   * single-item handler (404) and the bulk handler (per-id outcome) share one
   * path. This is the "resolve"-equivalent action for a maintenance.
   */
  async function closeOneMaintenance({
    id,
    message,
    userId,
    actor,
  }: {
    id: string;
    message?: string;
    userId?: string;
    actor: ReturnType<typeof resolveActor>;
  }): Promise<{
    status: "completed" | "notFound";
    maintenance?: MaintenanceWithSystems;
  }> {
    const existing = await service.getMaintenance(id);
    if (!existing) return { status: "notFound" };

    let closed: MaintenanceWithSystems | undefined;
    await writeMaintenanceEntity({
      handle: entityHandle,
      maintenanceId: id,
      opts: { actor },
      apply: async () => {
        closed = await service.closeMaintenance(id, message, userId);
        // A race could delete the maintenance between probe and write; fall
        // back to the pre-write snapshot so the entity diff is a no-op.
        return toMaintenanceEntityState(closed ?? existing);
      },
    });
    if (!closed) return { status: "notFound" };

    await cache.invalidateForMutation({
      maintenanceId: closed.id,
      systemIds: closed.systemIds,
    });
    await signalService.broadcast(MAINTENANCE_UPDATED, {
      maintenanceId: closed.id,
      systemIds: closed.systemIds,
      action: "closed",
    });
    const systemNames = await resolveSystemNames(closed.systemIds);
    await notifyAffectedSystems({
      catalogClient,
      notificationClient,
      logger,
      maintenanceId: closed.id,
      maintenanceTitle: closed.title,
      systemIds: closed.systemIds,
      systemNames,
      action: "completed",
    });
    return { status: "completed", maintenance: closed };
  }

  /**
   * Delete a single maintenance + post-mutation sequence (entity tombstone →
   * cache invalidate → signal). Returns `"notFound"` when the row does not
   * exist, matching the single-item handler's historical `{ success: false }`.
   */
  async function deleteOneMaintenance({
    id,
    actor,
  }: {
    id: string;
    actor: ReturnType<typeof resolveActor>;
  }): Promise<"deleted" | "notFound"> {
    const maintenance = await service.getMaintenance(id);
    if (!maintenance) return "notFound";

    let success = false;
    await removeMaintenanceEntity({
      handle: entityHandle,
      maintenanceId: id,
      opts: { actor },
      apply: async () => {
        success = await service.deleteMaintenance(id);
      },
    });
    if (!success) return "notFound";

    await cache.invalidateForMutation({
      maintenanceId: id,
      systemIds: maintenance.systemIds,
    });
    await signalService.broadcast(MAINTENANCE_UPDATED, {
      maintenanceId: id,
      systemIds: maintenance.systemIds,
      action: "closed", // "closed" doubles for delete (historical behaviour).
    });
    return "deleted";
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

        // Drive the close through the shared per-id helper. A missing
        // maintenance surfaces as NOT_FOUND.
        const outcome = await closeOneMaintenance({
          id: input.id,
          message: input.message,
          userId,
          actor: resolveActor(context.user),
        });
        if (outcome.status !== "completed" || !outcome.maintenance) {
          throw new ORPCError("NOT_FOUND", {
            message: "Maintenance not found",
          });
        }
        return outcome.maintenance;
      },
    ),

    deleteMaintenance: os.deleteMaintenance.handler(async ({ input, context }) => {
      // Shared per-id delete helper drives the reactive `maintenance` tombstone
      // (§10.2) + cache invalidate + signal. `success` tracks whether the row
      // actually existed and was deleted.
      const status = await deleteOneMaintenance({
        id: input.id,
        actor: resolveActor(context.user),
      });
      return { success: status === "deleted" };
    }),

    bulkDeleteMaintenances: os.bulkDeleteMaintenances.handler(
      async ({ input, context }) => {
        // The `bulkManage` instance-access mode pre-partitioned `input.ids`
        // into the caller's manageable subset and the denied remainder. A
        // missing partition means we cannot prove authorization, so treat the
        // whole batch as denied (fail closed).
        const partition = context.bulkAccess?.ids ?? {
          authorizedIds: [],
          deniedIds: input.ids,
        };
        const actor = resolveActor(context.user);
        const results: BulkMaintenanceActionResult[] = [];
        for (const id of partition.authorizedIds) {
          try {
            results.push({ id, status: await deleteOneMaintenance({ id, actor }) });
          } catch (error) {
            // Isolate per-id failures so one bad row never aborts the batch.
            logger.error(
              `bulkDeleteMaintenances: failed to delete maintenance ${id}`,
              error,
            );
            results.push({ id, status: "error" });
          }
        }
        for (const id of partition.deniedIds) {
          results.push({ id, status: "forbidden" });
        }
        return { results };
      },
    ),

    bulkCloseMaintenances: os.bulkCloseMaintenances.handler(
      async ({ input, context }) => {
        const userId =
          context.user && "id" in context.user ? context.user.id : undefined;
        const partition = context.bulkAccess?.ids ?? {
          authorizedIds: [],
          deniedIds: input.ids,
        };
        const actor = resolveActor(context.user);
        const results: BulkMaintenanceActionResult[] = [];
        for (const id of partition.authorizedIds) {
          try {
            const outcome = await closeOneMaintenance({
              id,
              message: input.message,
              userId,
              actor,
            });
            results.push({ id, status: outcome.status });
          } catch (error) {
            logger.error(
              `bulkCloseMaintenances: failed to close maintenance ${id}`,
              error,
            );
            results.push({ id, status: "error" });
          }
        }
        for (const id of partition.deniedIds) {
          results.push({ id, status: "forbidden" });
        }
        return { results };
      },
    ),

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
