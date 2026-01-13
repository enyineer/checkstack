import { ExtensionSlot } from "@checkstack/frontend-api";
import { InfoBanner } from "@checkstack/ui";
import {
  HealthCheckDiagramSlot,
  type HealthCheckDiagramSlotContext,
} from "../slots";
import { AggregatedDataBanner } from "./AggregatedDataBanner";

interface HealthCheckDiagramProps {
  /** The context from useHealthCheckData - handles both raw and aggregated modes */
  context: HealthCheckDiagramSlotContext;
  /** Whether the data is aggregated (for showing the info banner) */
  isAggregated?: boolean;
  /** Raw retention days (for the info banner) */
  rawRetentionDays?: number;
}

/**
 * Component that renders the diagram extension slot with the provided context.
 * Expects parent component to fetch data via useHealthCheckData and pass context.
 */
export function HealthCheckDiagram({
  context,
  isAggregated = false,
  rawRetentionDays = 7,
}: HealthCheckDiagramProps) {
  // Determine bucket size from context for aggregated data info banner
  const bucketSize =
    context.type === "aggregated" && context.buckets.length > 0
      ? context.buckets[0].bucketSize
      : "hourly";

  return (
    <>
      {isAggregated && (
        <AggregatedDataBanner
          bucketSize={bucketSize}
          rawRetentionDays={rawRetentionDays}
        />
      )}
      <ExtensionSlot slot={HealthCheckDiagramSlot} context={context} />
    </>
  );
}

/**
 * Wrapper that shows access message when user lacks access.
 */
export function HealthCheckDiagramAccessGate({
  hasAccess,
  children,
}: {
  hasAccess: boolean;
  children: React.ReactNode;
}) {
  if (!hasAccess) {
    return (
      <InfoBanner variant="info">
        Additional strategy-specific visualizations are available with the
        &quot;Read Health Check Details&quot; access rule.
      </InfoBanner>
    );
  }
  return <>{children}</>;
}
