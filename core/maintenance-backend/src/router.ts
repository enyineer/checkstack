import { implement, ORPCError } from "@orpc/server";
import {
  maintenanceContract,
  MAINTENANCE_UPDATED,
  maintenanceRoutes,
} from "@checkmate-monitor/maintenance-common";
import {
  autoAuthMiddleware,
  Logger,
  type RpcContext,
} from "@checkmate-monitor/backend-api";
import type { SignalService } from "@checkmate-monitor/signal-common";
import type { MaintenanceService } from "./service";
import { CatalogApi } from "@checkmate-monitor/catalog-common";
import type { InferClient } from "@checkmate-monitor/common";
import { resolveRoute } from "@checkmate-monitor/common";
import { maintenanceHooks } from "./hooks";

export function createRouter(
  service: MaintenanceService,
  signalService: SignalService,
  catalogClient: InferClient<typeof CatalogApi>,
  logger: Logger
) {
  const os = implement(maintenanceContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  /**
   * Helper to notify subscribers of affected systems about a maintenance event.
   * Each system triggers a separate notification call, but within each call
   * the subscribers are deduplicated (system + its groups).
   */
  const notifyAffectedSystems = async (props: {
    maintenanceId: string;
    maintenanceTitle: string;
    systemIds: string[];
    action: "created" | "updated";
  }) => {
    const { maintenanceId, maintenanceTitle, systemIds, action } = props;

    const actionText = action === "created" ? "scheduled" : "updated";
    const maintenanceDetailPath = resolveRoute(
      maintenanceRoutes.routes.detail,
      {
        maintenanceId,
      }
    );

    for (const systemId of systemIds) {
      try {
        await catalogClient.notifySystemSubscribers({
          systemId,
          title: `Maintenance ${actionText}`,
          body: `A maintenance **"${maintenanceTitle}"** has been ${actionText} for a system you're subscribed to.`,
          importance: "info",
          action: { label: "View Maintenance", url: maintenanceDetailPath },
          includeGroupSubscribers: true,
        });
      } catch (error) {
        // Log but don't fail the operation - notifications are best-effort
        logger.warn(
          `Failed to notify subscribers for system ${systemId}:`,
          error
        );
      }
    }
  };

  return os.router({
    listMaintenances: os.listMaintenances.handler(async ({ input }) => {
      return service.listMaintenances(input ?? {});
    }),

    getMaintenance: os.getMaintenance.handler(async ({ input }) => {
      const result = await service.getMaintenance(input.id);
      // eslint-disable-next-line unicorn/no-null -- oRPC contract requires null for missing values
      return result ?? null;
    }),

    getMaintenancesForSystem: os.getMaintenancesForSystem.handler(
      async ({ input }) => {
        return service.getMaintenancesForSystem(input.systemId);
      }
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
          startAt: result.startAt.toISOString(),
          endAt: result.endAt.toISOString(),
        });

        // Send notifications to system subscribers
        await notifyAffectedSystems({
          maintenanceId: result.id,
          maintenanceTitle: result.title,
          systemIds: result.systemIds,
          action: "created",
        });

        return result;
      }
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
          action: "updated",
        });

        // Send notifications to system subscribers
        await notifyAffectedSystems({
          maintenanceId: result.id,
          maintenanceTitle: result.title,
          systemIds: result.systemIds,
          action: "updated",
        });

        return result;
      }
    ),

    addUpdate: os.addUpdate.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
      const result = await service.addUpdate(input, userId);
      // Get maintenance to broadcast with correct systemIds
      const maintenance = await service.getMaintenance(input.maintenanceId);
      if (maintenance) {
        await signalService.broadcast(MAINTENANCE_UPDATED, {
          maintenanceId: input.maintenanceId,
          systemIds: maintenance.systemIds,
          action: "updated",
        });

        // Emit hook for cross-plugin coordination and integrations
        await context.emitHook(maintenanceHooks.maintenanceUpdated, {
          maintenanceId: input.maintenanceId,
          systemIds: maintenance.systemIds,
          title: maintenance.title,
          action: "updated",
        });
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
          userId
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
          action: "closed",
        });

        return result;
      }
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
  });
}
