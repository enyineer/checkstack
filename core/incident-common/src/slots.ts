import { createSlot } from "@checkmate-monitor/frontend-api";
import type { IncidentWithSystems } from "./schemas";

/**
 * Slot for extending incident detail views.
 * Plugins can add additional content or actions to incident details.
 */
export const IncidentDetailsSlot = createSlot<{
  incident: IncidentWithSystems;
}>("plugin.incident.details");

/**
 * Slot for adding custom status indicators to incidents.
 * Can be used to show external integrations, alerts, etc.
 */
export const IncidentStatusSlot = createSlot<{
  incident: IncidentWithSystems;
}>("plugin.incident.status");
