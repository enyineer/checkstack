import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { IncidentApi } from "../api";
import { type IncidentWithSystems } from "@checkstack/incident-common";
import { StatusBadge } from "@checkstack/ui";
import { AlertTriangle } from "lucide-react";
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
  const { data: incidents } = incidentClient.getIncidentsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !badgeData && !!system?.id }
  );

  const localIncident = incidents
    ? getMostSevereIncident(incidents)
    : undefined;

  // Use provider data if available, otherwise use local state
  const activeIncident = badgeData ? providerIncident : localIncident;

  if (!activeIncident) return;

  if (activeIncident.severity === "critical") {
    return (
      <StatusBadge tone="error" icon={AlertTriangle} label="Critical incident" />
    );
  }

  if (activeIncident.severity === "major") {
    return (
      <StatusBadge tone="warn" icon={AlertTriangle} label="Major incident" />
    );
  }

  return <StatusBadge tone="info" icon={AlertTriangle} label="Incident" />;
};
