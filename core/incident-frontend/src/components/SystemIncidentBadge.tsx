import React, { useEffect, useState, useCallback } from "react";
import { useApi, type SlotContext } from "@checkmate-monitor/frontend-api";
import { useSignal } from "@checkmate-monitor/signal-frontend";
import { SystemStateBadgesSlot } from "@checkmate-monitor/catalog-common";
import { incidentApiRef } from "../api";
import {
  INCIDENT_UPDATED,
  type IncidentWithSystems,
} from "@checkmate-monitor/incident-common";
import { Badge } from "@checkmate-monitor/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

const SEVERITY_WEIGHTS = { critical: 3, major: 2, minor: 1 } as const;

/**
 * Displays an incident badge for a system when it has an active incident.
 * Shows nothing if no active incidents.
 * Listens for realtime updates via signals.
 */
export const SystemIncidentBadge: React.FC<Props> = ({ system }) => {
  const api = useApi(incidentApiRef);
  const [activeIncident, setActiveIncident] = useState<
    IncidentWithSystems | undefined
  >();

  const refetch = useCallback(() => {
    if (!system?.id) return;

    api
      .getIncidentsForSystem({ systemId: system.id })
      .then((incidents: IncidentWithSystems[]) => {
        // Get the most severe active incident
        const sorted = [...incidents].toSorted((a, b) => {
          return (
            (SEVERITY_WEIGHTS[b.severity as keyof typeof SEVERITY_WEIGHTS] ||
              0) -
            (SEVERITY_WEIGHTS[a.severity as keyof typeof SEVERITY_WEIGHTS] || 0)
          );
        });
        setActiveIncident(sorted[0]);
      })
      .catch(console.error);
  }, [system?.id, api]);

  // Initial fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Listen for realtime incident updates
  useSignal(INCIDENT_UPDATED, ({ systemIds }) => {
    if (system?.id && systemIds.includes(system.id)) {
      refetch();
    }
  });

  if (!activeIncident) return;

  const variant =
    activeIncident.severity === "critical"
      ? "destructive"
      : activeIncident.severity === "major"
      ? "warning"
      : "info";

  return <Badge variant={variant}>Incident</Badge>;
};
