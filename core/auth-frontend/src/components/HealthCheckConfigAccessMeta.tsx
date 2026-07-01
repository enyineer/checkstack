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
      // Health-check configuration grants are keyed on `healthcheck.healthcheck`
      // (the type the RPC middleware derives from the configuration access rule's
      // resource). This equals `healthCheckResourceTypes.configuration`, hardcoded
      // here because auth-frontend (platform) must not import healthcheck-common
      // (domain). Keep in sync with that constant.
      resourceType="healthcheck.healthcheck"
      resourceId={configurationId}
    />
  );
};
