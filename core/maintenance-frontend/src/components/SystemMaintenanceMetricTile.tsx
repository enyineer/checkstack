import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemOverviewMetricsSlot } from "@checkstack/catalog-common";
import {
  MAINTENANCE_UPDATED,
  MaintenanceApi,
} from "@checkstack/maintenance-common";
import { MetricTile } from "@checkstack/ui";
import { Wrench } from "lucide-react";

type Props = SlotContext<typeof SystemOverviewMetricsSlot>;

/**
 * Metric tile showing maintenance status in the system detail hero banner.
 */
export const SystemMaintenanceMetricTile: React.FC<Props> = ({ system }) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  const { data: maintenances = [], refetch } =
    maintenanceClient.getMaintenancesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id },
    );

  useSignal(MAINTENANCE_UPDATED, ({ systemIds }) => {
    if (system?.id && systemIds.includes(system.id)) {
      void refetch();
    }
  });

  const active = maintenances.filter(
    (m) => m.status === "in_progress",
  ).length;
  const scheduled = maintenances.filter(
    (m) => m.status === "scheduled",
  ).length;

  if (active === 0 && scheduled === 0) return;

  const label = active > 0 ? "Maintenance" : "Scheduled";
  const value = active > 0 ? `${active} in progress` : `${scheduled} planned`;

  return (
    <MetricTile
      icon={Wrench}
      label={label}
      value={value}
      variant={active > 0 ? "warning" : "default"}
    />
  );
};
