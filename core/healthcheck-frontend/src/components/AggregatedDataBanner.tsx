import { InfoBanner } from "@checkstack/ui";

interface AggregatedDataBannerProps {
  /** Bucket interval in seconds */
  bucketIntervalSeconds: number;
  /** The configured check interval in seconds (optional, for comparison) */
  checkIntervalSeconds?: number;
}

/**
 * Format seconds into a human-readable duration string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds}s`;
  }
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `~${mins}min`;
  }
  const hours = Math.round(seconds / 3600);
  return `~${hours}h`;
}

/**
 * Get resolution tier label based on bucket interval.
 */
function getResolutionTier(
  bucketIntervalSeconds: number,
): "high" | "medium" | "low" {
  if (bucketIntervalSeconds >= 86_400) {
    return "low"; // Daily aggregates
  }
  if (bucketIntervalSeconds >= 3600) {
    return "medium"; // Hourly aggregates
  }
  return "high"; // Raw data
}

const TIER_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "High resolution",
  medium: "Medium resolution",
  low: "Low resolution",
};

/**
 * Banner shown when viewing aggregated health check data.
 * Informs users about the aggregation level due to high data volume.
 */
export function AggregatedDataBanner({
  bucketIntervalSeconds,
  checkIntervalSeconds,
}: AggregatedDataBannerProps) {
  // Only show if bucket interval is larger than check interval (data is being aggregated)
  if (checkIntervalSeconds && bucketIntervalSeconds <= checkIntervalSeconds) {
    return;
  }

  const tier = getResolutionTier(bucketIntervalSeconds);

  return (
    <InfoBanner variant="info">
      {TIER_LABELS[tier]} • Data aggregated into{" "}
      {formatDuration(bucketIntervalSeconds)} intervals
    </InfoBanner>
  );
}
