import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { SloApi } from "../api";
import { StatusBadge } from "@checkstack/ui";
import { Target } from "lucide-react";
import { useSloBadgeDataOptional } from "./SloBadgeDataProvider";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Badge displaying if a system's SLO is breaching, degraded, or at risk.
 * Rendered in SystemStateBadgesSlot on the catalog/dashboard.
 *
 * On the catalog browse view a `SloBadgeDataProvider` (installed via
 * `CatalogBrowseDataBoundarySlot`) bulk-fetches every visible system's
 * objectives; when present, this badge reads them from context and disables its
 * own per-system query, so the browse view issues no per-row RPC. On surfaces
 * without that provider (e.g. the system detail page) the fallback per-system
 * query runs exactly as before.
 *
 * Realtime updates arrive via SignalAutoInvalidator on `[["slo"]]`.
 */
export const SystemSloBadge: React.FC<Props> = ({ system }) => {
  const sloClient = usePluginClient(SloApi);
  const badgeCtx = useSloBadgeDataOptional();

  const { data: ownData } = sloClient.getObjectivesForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id && !badgeCtx },
  );

  const data = badgeCtx ? badgeCtx.getObjectives(system?.id ?? "") : ownData;

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
