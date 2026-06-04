import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { StatusBadge } from "@checkstack/ui";
import { Target } from "lucide-react";

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
    return <StatusBadge tone="error" icon={Target} label="SLO breaching" />;
  }

  if (hasDegraded) {
    return <StatusBadge tone="warn" icon={Target} label="SLO degraded" />;
  }

  if (hasAtRisk) {
    return <StatusBadge tone="warn" icon={Target} label="SLO at risk" />;
  }

  return;
};
