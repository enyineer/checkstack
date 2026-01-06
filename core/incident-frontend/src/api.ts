import { createApiRef } from "@checkmate-monitor/frontend-api";
import { IncidentApi } from "@checkmate-monitor/incident-common";
import type { InferClient } from "@checkmate-monitor/common";

// IncidentApiClient type inferred from the client definition
export type IncidentApiClient = InferClient<typeof IncidentApi>;

export const incidentApiRef = createApiRef<IncidentApiClient>(
  "plugin.incident.api"
);
