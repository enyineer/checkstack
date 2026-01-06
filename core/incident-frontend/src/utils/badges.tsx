import React from "react";
import { Badge } from "@checkmate-monitor/ui";
import type {
  IncidentStatus,
  IncidentSeverity,
} from "@checkmate-monitor/incident-common";

/**
 * Returns a styled badge for the given incident status.
 * Use this utility to ensure consistent status badge styling across the plugin.
 */
export function getIncidentStatusBadge(
  status: IncidentStatus
): React.ReactNode {
  switch (status) {
    case "investigating": {
      return <Badge variant="destructive">Investigating</Badge>;
    }
    case "identified": {
      return <Badge variant="warning">Identified</Badge>;
    }
    case "fixing": {
      return <Badge variant="warning">Fixing</Badge>;
    }
    case "monitoring": {
      return <Badge variant="info">Monitoring</Badge>;
    }
    case "resolved": {
      return <Badge variant="success">Resolved</Badge>;
    }
    default: {
      return <Badge>{status}</Badge>;
    }
  }
}

/**
 * Returns a styled badge for the given incident severity.
 * Use this utility to ensure consistent severity badge styling across the plugin.
 */
export function getIncidentSeverityBadge(
  severity: IncidentSeverity
): React.ReactNode {
  switch (severity) {
    case "critical": {
      return <Badge variant="destructive">Critical</Badge>;
    }
    case "major": {
      return <Badge variant="warning">Major</Badge>;
    }
    case "minor": {
      return <Badge variant="secondary">Minor</Badge>;
    }
    default: {
      return <Badge>{severity}</Badge>;
    }
  }
}
