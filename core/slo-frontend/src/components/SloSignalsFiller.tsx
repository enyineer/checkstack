import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignal,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import { SloApi, sloRoutes, sloAccess } from "@checkstack/slo-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

const SOURCE_ID = "slo";
const AT_RISK_BUDGET_PERCENT = 20;

/**
 * Reports breaching, degraded, and at-risk SLOs as dashboard signals.
 * Bulk-fetches objectives for all overview systems and emits one signal per
 * objective that needs attention, deep-linking to that objective's detail page.
 * Headless filler for {@link SystemSignalsSlot}.
 */
export const SloSignalsFiller: React.FC<Props> = ({ systemIds, onSignals }) => {
  const sloClient = usePluginClient(SloApi);

  const { data } = sloClient.getBulkObjectivesForSystems.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    const result: SystemSignalsMap = {};
    if (!data) return result;

    for (const systemId of systemIds) {
      const objectives = data.systems[systemId] ?? [];
      const systemSignals: SystemSignal[] = [];

      for (const { objective, status } of objectives) {
        let tone: SystemSignal["tone"];
        let label: string;
        if (status.isBreaching) {
          tone = "error";
          label = "SLO breaching";
        } else if (status.hasOpenDowntime) {
          tone = "warn";
          label = "SLO degraded";
        } else if (
          status.errorBudgetRemainingPercent <= AT_RISK_BUDGET_PERCENT
        ) {
          tone = "warn";
          label = "SLO at risk";
        } else {
          continue;
        }

        systemSignals.push({
          source: SOURCE_ID,
          tone,
          label,
          detail: `${objective.target}% target over ${objective.windowDays}d`,
          href: resolveRoute(sloRoutes.routes.detail, {
            sloId: objective.id,
          }),
          // Detail page is read-gated; render as text for users without it.
          accessRule: sloAccess.slo.read,
          iconName: "Target",
        });
      }

      if (systemSignals.length > 0) result[systemId] = systemSignals;
    }
    return result;
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
