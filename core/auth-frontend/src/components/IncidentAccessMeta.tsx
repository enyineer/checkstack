import React from "react";
import type { IncidentWithSystems } from "@checkstack/incident-common";
import { ResourceManagedBy } from "./ResourceManagedBy";

/**
 * Fills incident's `IncidentDetailsSlot`: a read-only "who can change this"
 * indicator for an incident. Renders nothing when the incident is not
 * team-scoped or the viewer lacks teams.read.
 */
export const IncidentAccessMeta: React.FC<{ incident: IncidentWithSystems }> = ({
  incident,
}) => {
  return (
    <ResourceManagedBy resourceType="incident.incident" resourceId={incident.id} />
  );
};
