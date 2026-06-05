import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignal,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import { IncidentApi, incidentRoutes } from "@checkstack/incident-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

const SOURCE_ID = "incident";

const severityToTone = {
  critical: "error",
  major: "warn",
  minor: "info",
} as const;

const severityToLabel = {
  critical: "Critical incident",
  major: "Major incident",
  minor: "Incident",
} as const;

/**
 * Reports active incidents as dashboard signals. Bulk-fetches incidents for all
 * overview systems and emits one signal per unresolved incident, deep-linking
 * to that incident's detail page. Headless filler for {@link SystemSignalsSlot}.
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
    const result: SystemSignalsMap = {};
    if (!data) return result;

    for (const systemId of systemIds) {
      const incidents = (data.incidents[systemId] ?? []).filter(
        (incident) => incident.status !== "resolved",
      );
      if (incidents.length === 0) continue;

      result[systemId] = incidents.map((incident) => {
        const signal: SystemSignal = {
          source: SOURCE_ID,
          tone: severityToTone[incident.severity],
          label: severityToLabel[incident.severity],
          detail: incident.title,
          href: resolveRoute(incidentRoutes.routes.detail, {
            incidentId: incident.id,
          }),
          since: new Date(incident.createdAt).toISOString(),
          iconName: "TriangleAlert",
        };
        return signal;
      });
    }
    return result;
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
