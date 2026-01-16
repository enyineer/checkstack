// Re-export types for convenience
export type {
  MaintenanceWithSystems,
  MaintenanceDetail,
  MaintenanceUpdate,
  MaintenanceStatus,
} from "@checkstack/maintenance-common";
// Client definition is in @checkstack/maintenance-common - use with usePluginClient
export { MaintenanceApi } from "@checkstack/maintenance-common";
