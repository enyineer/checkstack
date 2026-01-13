export { maintenanceAccess, maintenanceAccessRules } from "./access";
export {
  maintenanceContract,
  MaintenanceApi,
  type MaintenanceContract,
} from "./rpc-contract";
export {
  MaintenanceStatusEnum,
  MaintenanceSchema,
  MaintenanceWithSystemsSchema,
  MaintenanceUpdateSchema,
  MaintenanceDetailSchema,
  CreateMaintenanceInputSchema,
  UpdateMaintenanceInputSchema,
  AddMaintenanceUpdateInputSchema,
  type MaintenanceStatus,
  type Maintenance,
  type MaintenanceWithSystems,
  type MaintenanceUpdate,
  type MaintenanceDetail,
  type CreateMaintenanceInput,
  type UpdateMaintenanceInput,
  type AddMaintenanceUpdateInput,
} from "./schemas";
export { MaintenanceDetailsSlot, MaintenanceStatusSlot } from "./slots";
export * from "./plugin-metadata";
export { maintenanceRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";

/**
 * Broadcast when a maintenance is created, updated, or closed.
 * Frontend components listening to this signal can refetch state for affected systems.
 */
export const MAINTENANCE_UPDATED = createSignal(
  "maintenance.updated",
  z.object({
    maintenanceId: z.string(),
    systemIds: z.array(z.string()),
    action: z.enum(["created", "updated", "closed"]),
  })
);
