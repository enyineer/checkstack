import React, { useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { AnomalyApi } from "@checkstack/anomaly-common";
import { StatusBadge } from "@checkstack/ui";
import { ChartSpline } from "lucide-react";
import { useAnomalyBadgeDataOptional } from "./AnomalyBadgeDataProvider";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Renders an anomaly status badge for a system.
 *
 * On the catalog browse / manage tree an `AnomalyBadgeDataProvider` (installed
 * via `CatalogBrowseDataBoundarySlot`) fetches the active + suspicious anomaly
 * sets ONCE and exposes an O(1) per-system lookup; when present this badge reads
 * from it and disables its own queries, so a table of rows instantiates NO
 * per-row query observers. Without the provider (e.g. the system detail page)
 * the fallback queries run, deduped across all badge instances by React Query,
 * so even 50+ badges issue only 2 requests total. Recovered anomalies are
 * excluded to keep the payload bounded.
 */
export const SystemAnomalyBadge: React.FC<Props> = ({ system }) => {
  const anomalyClient = usePluginClient(AnomalyApi);
  const badgeCtx = useAnomalyBadgeDataOptional();

  // Fallback queries only when no bulk provider is present. Disabled (no live
  // observer created) on surfaces that install the provider.
  const { data: confirmedAnomalies = [] } = anomalyClient.getAnomalies.useQuery(
    { state: "anomaly", limit: 500 },
    { staleTime: 30_000, enabled: !badgeCtx },
  );
  const { data: suspiciousAnomalies = [] } =
    anomalyClient.getAnomalies.useQuery(
      { state: "suspicious", limit: 500 },
      { staleTime: 30_000, enabled: !badgeCtx },
    );

  // Worst state for this system: from the provider's O(1) lookup when present,
  // else scan the (deduped) fallback results.
  const systemState = useMemo(() => {
    if (badgeCtx) return badgeCtx.getSystemState(system?.id ?? "");
    if (confirmedAnomalies.some((a) => a.systemId === system?.id)) {
      return "anomaly" as const;
    }
    if (suspiciousAnomalies.some((a) => a.systemId === system?.id)) {
      return "suspicious" as const;
    }
    return;
  }, [badgeCtx, confirmedAnomalies, suspiciousAnomalies, system?.id]);

  if (!systemState) return <></>;

  if (systemState === "anomaly") {
    return <StatusBadge tone="warn" icon={ChartSpline} label="Anomaly detected" />;
  }

  return <StatusBadge tone="info" icon={ChartSpline} label="Suspicious behaviour" />;
};
