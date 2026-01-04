import { ExtensionSlot } from "@checkmate/frontend-api";
import { LoadingSpinner, InfoBanner } from "@checkmate/ui";
import { useHealthCheckData } from "../hooks/useHealthCheckData";
import { HealthCheckDiagramSlot } from "../slots";

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
  const { context, loading, hasPermission, permissionLoading } =
    useHealthCheckData({
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

  // Note: We pass the slot and context without explicit type parameter.
  // The types are compatible because context is produced by useHealthCheckData
  // which returns HealthCheckDiagramSlotContext | undefined, matching the slot.
  return <ExtensionSlot slot={HealthCheckDiagramSlot} context={context} />;
}
