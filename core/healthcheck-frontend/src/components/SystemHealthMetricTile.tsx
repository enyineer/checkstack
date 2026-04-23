import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemOverviewMetricsSlot } from "@checkstack/catalog-common";
import { SYSTEM_STATUS_CHANGED, HealthCheckApi } from "@checkstack/healthcheck-common";
import { MetricTile } from "@checkstack/ui";
import { Heart } from "lucide-react";

type Props = SlotContext<typeof SystemOverviewMetricsSlot>;

/**
 * Metric tile showing health check summary in the system detail hero banner.
 * Shows "X/Y Healthy" with appropriate variant coloring.
 */
export const SystemHealthMetricTile: React.FC<Props> = ({ system }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const { data: overviewData, refetch } =
    healthCheckClient.getSystemHealthOverview.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id },
    );

  useSignal(SYSTEM_STATUS_CHANGED, ({ systemId }) => {
    if (systemId === system?.id) {
      void refetch();
    }
  });

  if (!overviewData || overviewData.checks.length === 0) return;

  const total = overviewData.checks.length;
  const healthy = overviewData.checks.filter(
    (c) => c.status === "healthy",
  ).length;
  const unhealthy = overviewData.checks.filter(
    (c) => c.status === "unhealthy",
  ).length;

  const variant =
    unhealthy > 0 ? "destructive" : healthy === total ? "success" : "warning";

  return (
    <MetricTile
      icon={Heart}
      label="Health"
      value={`${healthy}/${total} Healthy`}
      variant={variant}
    />
  );
};
