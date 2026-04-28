import React, { useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { AnomalyApi, type AnomalyState } from "@checkstack/anomaly-common";
import { Badge } from "@checkstack/ui";
import { AlertTriangle, HelpCircle } from "lucide-react";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Renders an anomaly status badge for a system.
 * Uses a global query (without systemId) so that React Query can deduplicate
 * requests when rendering 50+ badges simultaneously on the dashboard.
 */
export const SystemAnomalyBadge: React.FC<Props> = ({ system }) => {
  const anomalyClient = usePluginClient(AnomalyApi);

  // We fetch ALL anomalies and suspicious states. React Query deduplicates this across all badges.
  const { data: anomalies = [] } = anomalyClient.getAnomalies.useQuery(
    { limit: 1000 }, // Get all active anomalies
    { staleTime: 30_000 }
  );

  // Find the worst state for this specific system
  const systemState = useMemo(() => {
    let worstState: AnomalyState | undefined;
    for (const a of anomalies) {
      if (a.systemId !== system?.id) continue;
      if (a.state === "anomaly") {
        return "anomaly"; // Worst possible, exit early
      }
      if (a.state === "suspicious") {
        worstState = "suspicious";
      }
    }
    return worstState;
  }, [anomalies, system?.id]);

  if (!systemState) return <></>;

  if (systemState === "anomaly") {
    return (
      <Badge variant="warning" className="flex items-center gap-1 shrink-0 cursor-default">
        <AlertTriangle className="h-3 w-3" />
        Anomaly
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="flex items-center gap-1 shrink-0 cursor-default border-warning/50 text-warning">
      <HelpCircle className="h-3 w-3" />
      Suspicious
    </Badge>
  );
};
