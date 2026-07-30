export {
  incidentAccess,
  incidentAccessRules,
  incidentResourceTypes,
} from "./access";
export {
  incidentContract,
  IncidentApi,
  SystemHealthOverrideSchema,
  type SystemHealthOverride,
  type IncidentContract,
} from "./rpc-contract";
export {
  IncidentStatusEnum,
  IncidentSeverityEnum,
  IncidentHealthOverrideEnum,
  type IncidentHealthOverride,
  IncidentVisibilityEnum,
  type IncidentVisibility,
  IncidentSchema,
  IncidentWithSystemsSchema,
  IncidentUpdateSchema,
  IncidentUpdateEditSnapshotSchema,
  IncidentDetailSchema,
  IncidentLinkSchema,
  AddIncidentLinkInputSchema,
  UpdateIncidentLinkInputSchema,
  CreateIncidentInputSchema,
  UpdateIncidentInputSchema,
  AddIncidentUpdateInputSchema,
  EditIncidentUpdateInputSchema,
  DeleteIncidentUpdateInputSchema,
  BulkIncidentActionStatusEnum,
  BulkIncidentActionResultSchema,
  BulkIncidentIdsInputSchema,
  BulkResolveIncidentsInputSchema,
  type IncidentStatus,
  type IncidentSeverity,
  type Incident,
  type IncidentWithSystems,
  type IncidentUpdate,
  type IncidentUpdateEditSnapshot,
  type IncidentDetail,
  type IncidentLink,
  type AddIncidentLinkInput,
  type UpdateIncidentLinkInput,
  type CreateIncidentInput,
  type UpdateIncidentInput,
  type AddIncidentUpdateInput,
  type EditIncidentUpdateInput,
  type DeleteIncidentUpdateInput,
  type BulkIncidentActionStatus,
  type BulkIncidentActionResult,
  type BulkIncidentIdsInput,
  type BulkResolveIncidentsInput,
} from "./schemas";
export {
  INCIDENT_LIFECYCLE_CHANGED_HOOK_ID,
  IncidentLifecycleActionEnum,
  incidentLifecycleChangedPayloadSchema,
  type IncidentLifecycleAction,
  type IncidentLifecycleChangedPayload,
} from "./hooks";
export { IncidentDetailsSlot, IncidentStatusSlot } from "./slots";
export {
  INCIDENT_SIGNAL_SOURCE_ID,
  deriveIncidentSignals,
} from "./signals";
export * from "./plugin-metadata";
export * from "./notifications";
export { incidentRoutes } from "./routes";
export { INCIDENT_MENTION_TYPE } from "./mentions";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when an incident is created, updated, or resolved.
 * Frontend components listening to this signal can refetch state for affected systems.
 */
export const INCIDENT_UPDATED = createSignal({
  pluginMetadata,
  event: "updated",
  payloadSchema: z.object({
    incidentId: z.string(),
    systemIds: z.array(z.string()),
    action: z.enum(["created", "updated", "resolved", "deleted"]),
  }),
});
