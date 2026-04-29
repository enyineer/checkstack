import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { MaintenanceApi } from "../api";
import { type MaintenanceWithSystems } from "@checkstack/maintenance-common";
import { Badge } from "@checkstack/ui";
import { useSystemBadgeDataOptional } from "@checkstack/dashboard-frontend";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Checks if any maintenance is currently in progress.
 */
function hasActiveMaintenance(maintenances: MaintenanceWithSystems[]): boolean {
  return maintenances.some((m) => m.status === "in_progress");
}

/**
 * Displays a maintenance badge for a system when it has an active maintenance.
 * Shows nothing if no active maintenance.
 *
 * When rendered within SystemBadgeDataProvider, uses bulk-fetched data.
 * Otherwise, falls back to individual fetch.
 *
 * Realtime updates arrive via the SignalAutoInvalidator (auto-invalidates
 * `[["maintenance"]]` queries when MAINTENANCE_UPDATED fires).
 */
export const SystemMaintenanceBadge: React.FC<Props> = ({ system }) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const badgeData = useSystemBadgeDataOptional();

  const providerData = badgeData?.getSystemBadgeData(system?.id ?? "");
  const providerHasActive = providerData
    ? hasActiveMaintenance(providerData.maintenances)
    : false;

  const { data: maintenances } =
    maintenanceClient.getMaintenancesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !badgeData && !!system?.id }
    );

  const localHasActive = maintenances
    ? hasActiveMaintenance(maintenances)
    : false;

  const hasActive = badgeData ? providerHasActive : localHasActive;

  if (!hasActive) return;
  return <Badge variant="warning">Under Maintenance</Badge>;
};
