import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemOverviewMetricsSlot } from "@checkstack/catalog-common";
import { INCIDENT_UPDATED, IncidentApi } from "@checkstack/incident-common";
import { MetricTile } from "@checkstack/ui";
import { AlertTriangle } from "lucide-react";

type Props = SlotContext<typeof SystemOverviewMetricsSlot>;

/**
 * Metric tile showing active incident count in the system detail hero banner.
 */
export const SystemIncidentMetricTile: React.FC<Props> = ({ system }) => {
  const incidentClient = usePluginClient(IncidentApi);

  const { data: incidents = [], refetch } =
    incidentClient.getIncidentsForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id },
    );

  useSignal(INCIDENT_UPDATED, ({ systemIds }) => {
    if (system?.id && systemIds.includes(system.id)) {
      void refetch();
    }
  });

  const count = incidents.length;

  return (
    <MetricTile
      icon={AlertTriangle}
      label="Incidents"
      value={count === 0 ? "None" : `${count} active`}
      variant={count > 0 ? "destructive" : "default"}
    />
  );
};
