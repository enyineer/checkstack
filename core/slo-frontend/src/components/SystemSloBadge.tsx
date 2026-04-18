import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { SLO_STATUS_CHANGED } from "@checkstack/slo-common";
import { Badge } from "@checkstack/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Badge displaying if a system's SLO is breaching, degraded, or at risk.
 * Rendered in SystemStateBadgesSlot on the catalog/dashboard.
 */
export const SystemSloBadge: React.FC<Props> = ({ system }) => {
  const sloClient = usePluginClient(SloApi);

  const { data, refetch } = sloClient.getObjectivesForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  useSignal(SLO_STATUS_CHANGED, ({ systemId }) => {
    if (system?.id && systemId === system.id) {
      void refetch();
    }
  });

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
