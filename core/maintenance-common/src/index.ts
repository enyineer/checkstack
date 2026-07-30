export {
  maintenanceAccess,
  maintenanceAccessRules,
  maintenanceResourceTypes,
} from "./access";
export {
  maintenanceContract,
  MaintenanceApi,
  type MaintenanceContract,
} from "./rpc-contract";
export {
  MaintenanceStatusEnum,
  MaintenanceVisibilityEnum,
  type MaintenanceVisibility,
  MaintenanceSchema,
  MaintenanceWithSystemsSchema,
  MaintenanceUpdateSchema,
  MaintenanceUpdateEditSnapshotSchema,
  MaintenanceDetailSchema,
  MaintenanceLinkSchema,
  AddMaintenanceLinkInputSchema,
  UpdateMaintenanceLinkInputSchema,
  CreateMaintenanceInputSchema,
  UpdateMaintenanceInputSchema,
  AddMaintenanceUpdateInputSchema,
  EditMaintenanceUpdateInputSchema,
  DeleteMaintenanceUpdateInputSchema,
  BulkMaintenanceActionStatusEnum,
  BulkMaintenanceActionResultSchema,
  BulkMaintenanceIdsInputSchema,
  BulkCloseMaintenancesInputSchema,
  type MaintenanceStatus,
  type Maintenance,
  type MaintenanceWithSystems,
  type MaintenanceUpdate,
  type MaintenanceUpdateEditSnapshot,
  type MaintenanceDetail,
  type MaintenanceLink,
  type AddMaintenanceLinkInput,
  type UpdateMaintenanceLinkInput,
  type CreateMaintenanceInput,
  type UpdateMaintenanceInput,
  type AddMaintenanceUpdateInput,
  type EditMaintenanceUpdateInput,
  type DeleteMaintenanceUpdateInput,
  type BulkMaintenanceActionStatus,
  type BulkMaintenanceActionResult,
  type BulkMaintenanceIdsInput,
  type BulkCloseMaintenancesInput,
} from "./schemas";
export { MaintenanceDetailsSlot, MaintenanceStatusSlot } from "./slots";
export {
  deriveMaintenanceSignals,
  MAINTENANCE_SIGNAL_SOURCE,
} from "./system-signals";
export * from "./plugin-metadata";
export * from "./notifications";
export { maintenanceRoutes } from "./routes";
export { MAINTENANCE_MENTION_TYPE } from "./mentions";

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
