import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  MaintenanceApi,
  deriveMaintenanceSignals,
  MAINTENANCE_SIGNAL_SOURCE,
} from "@checkstack/maintenance-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports in-progress maintenance windows as dashboard signals. Bulk-fetches
 * maintenances for all overview systems and emits one signal per active window,
 * deep-linking to that maintenance's detail page. Scheduled (future) windows
 * are intentionally not surfaced - they are not "needs attention now". Headless
 * filler for {@link SystemSignalsSlot}.
 *
 * The row->signal mapping lives in the shared {@link deriveMaintenanceSignals}
 * deriver so the dashboard and the backend `system.issues` aggregator emit
 * identical signals.
 */
export const MaintenanceSignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
}) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  const { data } = maintenanceClient.getBulkMaintenancesForSystems.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    if (!data) return {};
    return deriveMaintenanceSignals({
      maintenancesBySystem: data.maintenances,
      systemIds,
    });
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(MAINTENANCE_SIGNAL_SOURCE, signals);
  }, [signals, onSignals]);

  return null;
};
