import { implement, ORPCError } from "@orpc/server";
import {
  maintenanceContract,
  MAINTENANCE_UPDATED,
} from "@checkstack/maintenance-common";
import {
  autoAuthMiddleware,
  Logger,
  type RpcContext,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { MaintenanceService } from "./service";
import { CatalogApi } from "@checkstack/catalog-common";
import type { InferClient } from "@checkstack/common";
import { maintenanceHooks } from "./hooks";
import { notifyAffectedSystems } from "./notifications";

export function createRouter(
  service: MaintenanceService,
  signalService: SignalService,
  catalogClient: InferClient<typeof CatalogApi>,
  logger: Logger,
) {
  const os = implement(maintenanceContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    listMaintenances: os.listMaintenances.handler(async ({ input }) => {
      return { maintenances: await service.listMaintenances(input ?? {}) };
    }),

    getMaintenance: os.getMaintenance.handler(async ({ input }) => {
      const result = await service.getMaintenance(input.id);
      // eslint-disable-next-line unicorn/no-null -- oRPC contract requires null for missing values
      return result ?? null;
    }),

    getMaintenancesForSystem: os.getMaintenancesForSystem.handler(
      async ({ input }) => {
        return service.getMaintenancesForSystem(input.systemId);
      },
    ),

    getBulkMaintenancesForSystems: os.getBulkMaintenancesForSystems.handler(
      async ({ input }) => {
        const maintenances: Record<
          string,
          Awaited<ReturnType<typeof service.getMaintenancesForSystem>>
        > = {};

        // Fetch maintenances for each system in parallel
        await Promise.all(
          input.systemIds.map(async (systemId) => {
            maintenances[systemId] =
              await service.getMaintenancesForSystem(systemId);
          }),
        );

        return { maintenances };
      },
    ),

    createMaintenance: os.createMaintenance.handler(
      async ({ input, context }) => {
        const result = await service.createMaintenance(input);

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
        await notifyAffectedSystems({
          catalogClient,
          logger,
          maintenanceId: result.id,
          maintenanceTitle: result.title,
          systemIds: result.systemIds,
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
      // Get maintenance to broadcast with correct systemIds
      const maintenance = await service.getMaintenance(input.maintenanceId);
      if (maintenance) {
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

          await notifyAffectedSystems({
            catalogClient,
            logger,
            maintenanceId: input.maintenanceId,
            maintenanceTitle: maintenance.title,
            systemIds: maintenance.systemIds,
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

        return result;
      },
    ),

    deleteMaintenance: os.deleteMaintenance.handler(async ({ input }) => {
      // Get maintenance before deleting to get systemIds
      const maintenance = await service.getMaintenance(input.id);
      const success = await service.deleteMaintenance(input.id);
      if (success && maintenance) {
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
  });
}
