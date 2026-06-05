import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignal,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import { AnomalyApi } from "@checkstack/anomaly-common";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

const SOURCE_ID = "anomaly";

/**
 * Reports confirmed anomalies and suspicious states as dashboard signals.
 * Reuses the two globally-deduped anomaly queries (the same ones the badge
 * uses) and emits one signal per anomaly for systems in the overview, deep-
 * linking to the affected check's history. Headless filler for
 * {@link SystemSignalsSlot}.
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
    const result: SystemSignalsMap = {};
    const inOverview = new Set(systemIds);

    const add = (
      systemId: string,
      configurationId: string,
      fieldPath: string,
      startedAt: string,
      tone: SystemSignal["tone"],
      label: string,
    ) => {
      if (!inOverview.has(systemId)) return;
      const signal: SystemSignal = {
        source: SOURCE_ID,
        tone,
        label,
        detail: fieldPath,
        href: resolveRoute(healthcheckRoutes.routes.historyDetail, {
          systemId,
          configurationId,
        }),
        since: new Date(startedAt).toISOString(),
        iconName: "ChartSpline",
      };
      (result[systemId] ??= []).push(signal);
    };

    for (const a of confirmed) {
      add(a.systemId, a.configurationId, a.fieldPath, a.startedAt, "warn", "Anomaly detected");
    }
    for (const a of suspicious) {
      add(a.systemId, a.configurationId, a.fieldPath, a.startedAt, "info", "Suspicious behaviour");
    }
    return result;
  }, [confirmed, suspicious, systemIds]);

  useEffect(() => {
    onSignals(SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
