import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignal,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  MaintenanceApi,
  maintenanceRoutes,
} from "@checkstack/maintenance-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

const SOURCE_ID = "maintenance";

/**
 * Reports in-progress maintenance windows as dashboard signals. Bulk-fetches
 * maintenances for all overview systems and emits one signal per active window,
 * deep-linking to that maintenance's detail page. Scheduled (future) windows
 * are intentionally not surfaced - they are not "needs attention now". Headless
 * filler for {@link SystemSignalsSlot}.
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
    const result: SystemSignalsMap = {};
    if (!data) return result;

    for (const systemId of systemIds) {
      const active = (data.maintenances[systemId] ?? []).filter(
        (maintenance) => maintenance.status === "in_progress",
      );
      if (active.length === 0) continue;

      result[systemId] = active.map((maintenance): SystemSignal => ({
        source: SOURCE_ID,
        tone: "info",
        label: "Under maintenance",
        detail: maintenance.title,
        href: resolveRoute(maintenanceRoutes.routes.detail, {
          maintenanceId: maintenance.id,
        }),
        since: new Date(maintenance.startAt).toISOString(),
        iconName: "Wrench",
      }));
    }
    return result;
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
