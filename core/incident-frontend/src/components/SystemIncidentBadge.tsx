import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { IncidentApi } from "../api";
import {
  INCIDENT_UPDATED,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import { Badge } from "@checkstack/ui";
import { useSystemBadgeDataOptional } from "@checkstack/dashboard-frontend";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

const SEVERITY_WEIGHTS = { critical: 3, major: 2, minor: 1 } as const;

/**
 * Finds the most severe incident from a list.
 */
function getMostSevereIncident(
  incidents: IncidentWithSystems[]
): IncidentWithSystems | undefined {
  if (incidents.length === 0) return undefined;
  const sorted = [...incidents].toSorted((a, b) => {
    return (
      (SEVERITY_WEIGHTS[b.severity as keyof typeof SEVERITY_WEIGHTS] || 0) -
      (SEVERITY_WEIGHTS[a.severity as keyof typeof SEVERITY_WEIGHTS] || 0)
    );
  });
  return sorted[0];
}

/**
 * Displays an incident badge for a system when it has an active incident.
 * Shows nothing if no active incidents.
 *
 * When rendered within SystemBadgeDataProvider, uses bulk-fetched data.
 * Otherwise, falls back to individual fetch.
 *
 * Listens for realtime updates via signals.
 */
export const SystemIncidentBadge: React.FC<Props> = ({ system }) => {
  const incidentClient = usePluginClient(IncidentApi);
  const badgeData = useSystemBadgeDataOptional();

  // Try to get data from provider first
  const providerData = badgeData?.getSystemBadgeData(system?.id ?? "");
  const providerIncident = providerData
    ? getMostSevereIncident(providerData.incidents)
    : undefined;

  // Query for incidents if not using provider
  const { data: incidents, refetch } =
    incidentClient.getIncidentsForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !badgeData && !!system?.id }
    );

  const localIncident = incidents
    ? getMostSevereIncident(incidents)
    : undefined;

  // Listen for realtime incident updates (only in fallback mode)
  useSignal(INCIDENT_UPDATED, ({ systemIds }) => {
    if (!badgeData && system?.id && systemIds.includes(system.id)) {
      void refetch();
    }
  });

  // Use provider data if available, otherwise use local state
  const activeIncident = badgeData ? providerIncident : localIncident;

  if (!activeIncident) return;

  const variant =
    activeIncident.severity === "critical"
      ? "destructive"
      : activeIncident.severity === "major"
      ? "warning"
      : "info";

  return <Badge variant={variant}>Incident</Badge>;
};
