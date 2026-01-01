import { createApiRef } from "@checkmate/frontend-api";
import type { MaintenanceClient } from "@checkmate/maintenance-common";

export type MaintenanceApi = MaintenanceClient;

export const maintenanceApiRef = createApiRef<MaintenanceApi>(
  "plugin.maintenance.api"
);
