export { incidentAccess, incidentAccessRules } from "./access";
export {
  incidentContract,
  IncidentApi,
  type IncidentContract,
} from "./rpc-contract";
export {
  IncidentStatusEnum,
  IncidentSeverityEnum,
  IncidentSchema,
  IncidentWithSystemsSchema,
  IncidentUpdateSchema,
  IncidentDetailSchema,
  CreateIncidentInputSchema,
  UpdateIncidentInputSchema,
  AddIncidentUpdateInputSchema,
  type IncidentStatus,
  type IncidentSeverity,
  type Incident,
  type IncidentWithSystems,
  type IncidentUpdate,
  type IncidentDetail,
  type CreateIncidentInput,
  type UpdateIncidentInput,
  type AddIncidentUpdateInput,
} from "./schemas";
export { IncidentDetailsSlot, IncidentStatusSlot } from "./slots";
export * from "./plugin-metadata";
export { incidentRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";

/**
 * Broadcast when an incident is created, updated, or resolved.
 * Frontend components listening to this signal can refetch state for affected systems.
 */
export const INCIDENT_UPDATED = createSignal(
  "incident.updated",
  z.object({
    incidentId: z.string(),
    systemIds: z.array(z.string()),
    action: z.enum(["created", "updated", "resolved", "deleted"]),
  })
);
