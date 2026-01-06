import { InfoBanner } from "@checkmate-monitor/ui";

interface AggregatedDataBannerProps {
  bucketSize: "hourly" | "daily";
  rawRetentionDays: number;
}

/**
 * Banner shown when viewing aggregated health check data.
 * Informs users about the aggregation level and how to see detailed data.
 */
export function AggregatedDataBanner({
  bucketSize,
  rawRetentionDays,
}: AggregatedDataBannerProps) {
  const bucketLabel = bucketSize === "hourly" ? "hourly" : "daily";

  return (
    <InfoBanner variant="info">
      Showing {bucketLabel} aggregates. For per-run data, select a range ≤{" "}
      {rawRetentionDays} days.
    </InfoBanner>
  );
}
