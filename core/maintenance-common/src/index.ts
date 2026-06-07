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
  MaintenanceLinkSchema,
  AddMaintenanceLinkInputSchema,
  CreateMaintenanceInputSchema,
  UpdateMaintenanceInputSchema,
  AddMaintenanceUpdateInputSchema,
  type MaintenanceStatus,
  type Maintenance,
  type MaintenanceWithSystems,
  type MaintenanceUpdate,
  type MaintenanceDetail,
  type MaintenanceLink,
  type AddMaintenanceLinkInput,
  type CreateMaintenanceInput,
  type UpdateMaintenanceInput,
  type AddMaintenanceUpdateInput,
} from "./schemas";
export { MaintenanceDetailsSlot, MaintenanceStatusSlot } from "./slots";
export {
  deriveMaintenanceSignals,
  MAINTENANCE_SIGNAL_SOURCE,
} from "./system-signals";
export * from "./plugin-metadata";
export * from "./notifications";
export { maintenanceRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when a maintenance is created, updated, or closed.
 * Frontend components listening to this signal can refetch state for affected systems.
 */
export const MAINTENANCE_UPDATED = createSignal({
  pluginMetadata,
  event: "updated",
  payloadSchema: z.object({
    maintenanceId: z.string(),
    systemIds: z.array(z.string()),
    action: z.enum(["created", "updated", "closed"]),
  }),
});
