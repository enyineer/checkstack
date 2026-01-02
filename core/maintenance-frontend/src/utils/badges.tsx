import React from "react";
import { Badge } from "@checkmate/ui";
import type { MaintenanceStatus } from "@checkmate/maintenance-common";

/**
 * Returns a styled badge for the given maintenance status.
 * Use this utility to ensure consistent status badge styling across the plugin.
 */
export function getMaintenanceStatusBadge(
  status: MaintenanceStatus
): React.ReactNode {
  switch (status) {
    case "in_progress": {
      return <Badge variant="warning">In Progress</Badge>;
    }
    case "scheduled": {
      return <Badge variant="info">Scheduled</Badge>;
    }
    case "completed": {
      return <Badge variant="success">Completed</Badge>;
    }
    case "cancelled": {
      return <Badge variant="secondary">Cancelled</Badge>;
    }
    default: {
      return <Badge>{status}</Badge>;
    }
  }
}
