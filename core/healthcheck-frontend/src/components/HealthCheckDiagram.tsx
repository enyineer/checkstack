import { ExtensionSlot } from "@checkmate-monitor/frontend-api";
import { LoadingSpinner, InfoBanner } from "@checkmate-monitor/ui";
import { useHealthCheckData } from "../hooks/useHealthCheckData";
import { HealthCheckDiagramSlot } from "../slots";
import { AggregatedDataBanner } from "./AggregatedDataBanner";

interface HealthCheckDiagramProps {
  systemId: string;
  configurationId: string;
  strategyId: string;
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  limit?: number;
  offset?: number;
}

/**
 * Wrapper component that handles loading health check data and rendering
 * the diagram extension slot with the appropriate context (raw or aggregated).
 *
 * Automatically determines whether to use raw or aggregated data based on
 * the date range and the configured rawRetentionDays.
 */
export function HealthCheckDiagram({
  systemId,
  configurationId,
  strategyId,
  dateRange,
  limit,
  offset,
}: HealthCheckDiagramProps) {
  const {
    context,
    loading,
    hasPermission,
    permissionLoading,
    isAggregated,
    retentionConfig,
  } = useHealthCheckData({
    systemId,
    configurationId,
    strategyId,
    dateRange,
    limit,
    offset,
  });

  if (permissionLoading) {
    return <LoadingSpinner />;
  }

  if (!hasPermission) {
    return (
      <InfoBanner variant="info">
        Additional strategy-specific visualizations are available with the
        &quot;Read Health Check Details&quot; permission.
      </InfoBanner>
    );
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!context) {
    return;
  }

  // Determine bucket size from context for aggregated data
  const bucketSize =
    context.type === "aggregated" && context.buckets.length > 0
      ? context.buckets[0].bucketSize
      : "hourly";

  return (
    <>
      {isAggregated && (
        <AggregatedDataBanner
          bucketSize={bucketSize}
          rawRetentionDays={retentionConfig.rawRetentionDays}
        />
      )}
      <ExtensionSlot slot={HealthCheckDiagramSlot} context={context} />
    </>
  );
}
