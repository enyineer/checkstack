import React from "react";
import type { MaintenanceWithSystems } from "@checkstack/maintenance-common";
import { ResourceManagedBy } from "./ResourceManagedBy";

/**
 * Fills maintenance's `MaintenanceDetailsSlot`: a read-only "who can change
 * this" indicator for a maintenance. Renders nothing when the maintenance is
 * not team-scoped or the viewer lacks teams.read.
 */
export const MaintenanceAccessMeta: React.FC<{
  maintenance: MaintenanceWithSystems;
}> = ({ maintenance }) => {
  return (
    <ResourceManagedBy
      resourceType="maintenance.maintenance"
      resourceId={maintenance.id}
    />
  );
};
