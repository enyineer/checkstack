import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { Badge } from "@checkstack/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Badge displaying if a system's SLO is breaching, degraded, or at risk.
 * Rendered in SystemStateBadgesSlot on the catalog/dashboard.
 *
 * Realtime updates arrive via SignalAutoInvalidator on `[["slo"]]`.
 */
export const SystemSloBadge: React.FC<Props> = ({ system }) => {
  const sloClient = usePluginClient(SloApi);

  const { data } = sloClient.getObjectivesForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  if (!data || data.length === 0) return;

  // Determine worst status across all SLOs for this system
  const hasBreaching = data.some((item) => item.status.isBreaching);
  const hasDegraded = data.some((item) => item.status.hasOpenDowntime);
  const hasAtRisk = data.some(
    (item) => item.status.errorBudgetRemainingPercent <= 20,
  );

  if (hasBreaching) {
    return <Badge variant="destructive">SLO Breaching</Badge>;
  }

  if (hasDegraded) {
    return <Badge variant="warning">SLO Degraded</Badge>;
  }

  if (hasAtRisk) {
    return <Badge variant="warning">SLO At Risk</Badge>;
  }

  return;
};
