import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  SloApi,
  deriveSloSignals,
  SLO_SIGNAL_SOURCE_ID,
} from "@checkstack/slo-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports breaching, degraded, and at-risk SLOs as dashboard signals.
 * Bulk-fetches objectives for all overview systems and emits one signal per
 * objective that needs attention, deep-linking to that objective's detail page.
 * Headless filler for {@link SystemSignalsSlot}.
 *
 * The row -> signal mapping lives in the shared {@link deriveSloSignals} deriver
 * (slo-common) so the backend `system.issues` contributor emits identical signals.
 */
export const SloSignalsFiller: React.FC<Props> = ({ systemIds, onSignals }) => {
  const sloClient = usePluginClient(SloApi);

  const { data } = sloClient.getBulkObjectivesForSystems.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    if (!data) return {};
    const rowsBySystemId: Record<string, (typeof data.systems)[string]> = {};
    for (const systemId of systemIds) {
      rowsBySystemId[systemId] = data.systems[systemId] ?? [];
    }
    return deriveSloSignals({ rowsBySystemId });
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(SLO_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
