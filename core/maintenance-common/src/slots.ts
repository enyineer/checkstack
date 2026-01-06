import { createSlot } from "@checkmate-monitor/frontend-api";
import type { MaintenanceWithSystems } from "./schemas";

/**
 * Slot for extending maintenance detail views.
 * Plugins can add additional content or actions to maintenance details.
 */
export const MaintenanceDetailsSlot = createSlot<{
  maintenance: MaintenanceWithSystems;
}>("plugin.maintenance.details");

/**
 * Slot for adding custom status indicators to maintenances.
 * Can be used to show external integrations, alerts, etc.
 */
export const MaintenanceStatusSlot = createSlot<{
  maintenance: MaintenanceWithSystems;
}>("plugin.maintenance.status");
