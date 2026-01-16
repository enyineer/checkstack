// Re-export types for convenience
export type {
  IncidentWithSystems,
  IncidentDetail,
  IncidentUpdate,
  IncidentStatus,
} from "@checkstack/incident-common";
// Client definition is in @checkstack/incident-common - use with usePluginClient
export { IncidentApi } from "@checkstack/incident-common";
