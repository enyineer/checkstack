import React, { useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { AnomalyApi, type AnomalyState } from "@checkstack/anomaly-common";
import { Badge } from "@checkstack/ui";
import { AlertTriangle, HelpCircle } from "lucide-react";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Renders an anomaly status badge for a system.
 *
 * Fetches ONLY active anomalies (state = "anomaly") and suspicious states
 * in two separate queries. React Query deduplicates these globally across
 * all badge instances on the dashboard, so even with 50+ badges we only
 * issue 2 requests total. Recovered anomalies are excluded to prevent
 * unbounded growth in the response payload.
 */
export const SystemAnomalyBadge: React.FC<Props> = ({ system }) => {
  const anomalyClient = usePluginClient(AnomalyApi);

  // Fetch confirmed anomalies — deduped across all badge instances via React Query
  const { data: confirmedAnomalies = [] } = anomalyClient.getAnomalies.useQuery(
    { state: "anomaly", limit: 500 },
    { staleTime: 30_000 },
  );

  // Fetch suspicious states — deduped across all badge instances via React Query
  const { data: suspiciousAnomalies = [] } =
    anomalyClient.getAnomalies.useQuery(
      { state: "suspicious", limit: 500 },
      { staleTime: 30_000 },
    );

  // Find the worst state for this specific system
  const systemState = useMemo(() => {
    // Check confirmed anomalies first (worst state)
    if (confirmedAnomalies.some((a) => a.systemId === system?.id)) {
      return "anomaly" as AnomalyState;
    }
    // Check suspicious states
    if (suspiciousAnomalies.some((a) => a.systemId === system?.id)) {
      return "suspicious" as AnomalyState;
    }
    return;
  }, [confirmedAnomalies, suspiciousAnomalies, system?.id]);

  if (!systemState) return <></>;

  if (systemState === "anomaly") {
    return (
      <Badge
        variant="warning"
        className="flex items-center gap-1 shrink-0 cursor-default"
      >
        <AlertTriangle className="h-3 w-3" />
        Anomaly
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="flex items-center gap-1 shrink-0 cursor-default border-warning/50 text-warning"
    >
      <HelpCircle className="h-3 w-3" />
      Suspicious
    </Badge>
  );
};
