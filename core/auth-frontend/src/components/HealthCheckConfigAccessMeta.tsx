import React from "react";
import { ResourceManagedBy } from "./ResourceManagedBy";

/**
 * Fills healthcheck's `HealthCheckConfigDetailsSlot`: a read-only "who can
 * change this" indicator for a health-check configuration. Renders nothing when
 * the configuration is not team-scoped or the viewer lacks teams.read.
 */
export const HealthCheckConfigAccessMeta: React.FC<{
  configurationId: string;
}> = ({ configurationId }) => {
  return (
    <ResourceManagedBy
      resourceType="healthcheck.configuration"
      resourceId={configurationId}
    />
  );
};
