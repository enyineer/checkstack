import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemOverviewMetricsSlot } from "@checkstack/catalog-common";
import { SLO_STATUS_CHANGED } from "@checkstack/slo-common";
import { SloApi } from "../api";
import { MetricTile } from "@checkstack/ui";
import { Target } from "lucide-react";

type Props = SlotContext<typeof SystemOverviewMetricsSlot>;

/**
 * Metric tile showing SLO budget summary in the system detail hero banner.
 * Shows the worst (lowest) SLO availability percentage.
 */
export const SystemSloMetricTile: React.FC<Props> = ({ system }) => {
  const sloClient = usePluginClient(SloApi);

  const { data: objectives, refetch } =
    sloClient.getObjectivesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id },
    );

  useSignal(SLO_STATUS_CHANGED, ({ systemId }) => {
    if (systemId === system?.id) {
      void refetch();
    }
  });

  if (!objectives || objectives.length === 0) return;

  // Find worst availability using a loop (unicorn/no-array-reduce)
  let worstAvail = 100;
  let worstObj = objectives[0];
  for (const item of objectives) {
    const avail = item.status.currentAvailability ?? 100;
    if (avail < worstAvail) {
      worstAvail = avail;
      worstObj = item;
    }
  }

  const worstBudgetRemaining = worstObj.status.errorBudgetRemainingPercent;

  const variant =
    worstBudgetRemaining <= 0
      ? "destructive"
      : worstBudgetRemaining < 30
        ? "warning"
        : "success";

  return (
    <MetricTile
      icon={Target}
      label="SLO Budget"
      value={`${worstAvail.toFixed(2)}%`}
      subtitle={`${worstObj.objective.windowDays}d window`}
      variant={variant}
    />
  );
};
