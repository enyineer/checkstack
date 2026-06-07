import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  IncidentApi,
  INCIDENT_SIGNAL_SOURCE_ID,
  deriveIncidentSignals,
} from "@checkstack/incident-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports active incidents as dashboard signals. Bulk-fetches incidents for all
 * overview systems and emits one signal per unresolved incident, deep-linking
 * to that incident's detail page. Headless filler for {@link SystemSignalsSlot}.
 *
 * The row->signal transform lives in the shared `deriveIncidentSignals` deriver
 * (incident-common) so the frontend and the backend `system.issues` contributor
 * produce identical signals.
 */
export const IncidentSignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
}) => {
  const incidentClient = usePluginClient(IncidentApi);

  const { data } = incidentClient.getBulkIncidentsForSystems.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    if (!data) return {};
    return deriveIncidentSignals({
      incidentsBySystem: data.incidents,
      systemIds,
    });
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(INCIDENT_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
