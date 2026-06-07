import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  AnomalyApi,
  deriveAnomalySignals,
  ANOMALY_SIGNAL_SOURCE_ID,
  type AnomalySignalRow,
} from "@checkstack/anomaly-common";
import {
  healthcheckRoutes,
  healthCheckAccess,
} from "@checkstack/healthcheck-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports confirmed anomalies and suspicious states as dashboard signals.
 * Reuses the two globally-deduped anomaly queries (the same ones the badge
 * uses) and the shared {@link deriveAnomalySignals} mapper - the SAME mapper the
 * backend `system.issues` contributor runs - so frontend and backend signals
 * stay identical. Headless filler for {@link SystemSignalsSlot}.
 */
export const AnomalySignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
}) => {
  const anomalyClient = usePluginClient(AnomalyApi);

  const { data: confirmed = [] } = anomalyClient.getAnomalies.useQuery(
    { state: "anomaly", limit: 500 },
    { staleTime: 30_000 },
  );
  const { data: suspicious = [] } = anomalyClient.getAnomalies.useQuery(
    { state: "suspicious", limit: 500 },
    { staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    const inOverview = new Set(systemIds);
    const rows: AnomalySignalRow[] = [...confirmed, ...suspicious]
      .filter((a) => inOverview.has(a.systemId))
      .map((a) => ({
        systemId: a.systemId,
        configurationId: a.configurationId,
        fieldPath: a.fieldPath,
        startedAt: a.startedAt,
        state: a.state,
      }));

    return deriveAnomalySignals({
      rows,
      buildHref: (row) =>
        resolveRoute(healthcheckRoutes.routes.historyDetail, {
          systemId: row.systemId,
          configurationId: row.configurationId,
        }),
      // The history detail page is gated; render as text for users without it.
      accessRule: healthCheckAccess.details,
    });
  }, [confirmed, suspicious, systemIds]);

  useEffect(() => {
    onSignals(ANOMALY_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
