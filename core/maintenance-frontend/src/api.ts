import { createApiRef } from "@checkmate-monitor/frontend-api";
import { MaintenanceApi } from "@checkmate-monitor/maintenance-common";
import type { InferClient } from "@checkmate-monitor/common";

// MaintenanceApiClient type inferred from the client definition
export type MaintenanceApiClient = InferClient<typeof MaintenanceApi>;

export const maintenanceApiRef = createApiRef<MaintenanceApiClient>(
  "plugin.maintenance.api"
);
