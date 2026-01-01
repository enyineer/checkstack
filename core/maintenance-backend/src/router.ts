import { implement, ORPCError } from "@orpc/server";
import { maintenanceContract } from "@checkmate/maintenance-common";
import { autoAuthMiddleware, type RpcContext } from "@checkmate/backend-api";
import type { MaintenanceService } from "./service";

export function createRouter(service: MaintenanceService) {
  const os = implement(maintenanceContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

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

    createMaintenance: os.createMaintenance.handler(async ({ input }) => {
      const result = await service.createMaintenance(input);
      return result;
    }),

    updateMaintenance: os.updateMaintenance.handler(async ({ input }) => {
      const result = await service.updateMaintenance(input);
      if (!result) {
        throw new ORPCError("NOT_FOUND", { message: "Maintenance not found" });
      }
      return result;
    }),

    addUpdate: os.addUpdate.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
      return service.addUpdate(input, userId);
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
        return result;
      }
    ),

    deleteMaintenance: os.deleteMaintenance.handler(async ({ input }) => {
      const success = await service.deleteMaintenance(input.id);
      return { success };
    }),
  });
}
