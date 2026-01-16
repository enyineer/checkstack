import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { MaintenanceApi } from "../api";
import {
  MAINTENANCE_UPDATED,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";
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
 * Listens for realtime updates via signals.
 */
export const SystemMaintenanceBadge: React.FC<Props> = ({ system }) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const badgeData = useSystemBadgeDataOptional();

  // Try to get data from provider first
  const providerData = badgeData?.getSystemBadgeData(system?.id ?? "");
  const providerHasActive = providerData
    ? hasActiveMaintenance(providerData.maintenances)
    : false;

  // Query for maintenances if not using provider
  const { data: maintenances, refetch } =
    maintenanceClient.getMaintenancesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !badgeData && !!system?.id }
    );

  const localHasActive = maintenances
    ? hasActiveMaintenance(maintenances)
    : false;

  // Listen for realtime maintenance updates (only in fallback mode)
  useSignal(MAINTENANCE_UPDATED, ({ systemIds }) => {
    if (!badgeData && system?.id && systemIds.includes(system.id)) {
      void refetch();
    }
  });

  // Use provider data if available, otherwise use local state
  const hasActive = badgeData ? providerHasActive : localHasActive;

  if (!hasActive) return;
  return <Badge variant="warning">Under Maintenance</Badge>;
};
