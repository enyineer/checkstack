import { format } from "date-fns";
import type { HealthCheckDiagramSlotContext } from "../slots";
import { SparklineTooltip } from "./SparklineTooltip";

interface HealthCheckStatusTimelineProps {
  context: HealthCheckDiagramSlotContext;
  height?: number;
}

const statusColors = {
  healthy: "hsl(var(--success))",
  degraded: "hsl(var(--warning))",
  unhealthy: "hsl(var(--destructive))",
};

/**
 * Timeline bar chart showing health check status distribution over time.
 * Each bar shows the distribution of statuses in that aggregated bucket.
 */
export const HealthCheckStatusTimeline: React.FC<
  HealthCheckStatusTimelineProps
> = ({ context, height = 60 }) => {
  const buckets = context.buckets;

  if (buckets.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No status data available
      </div>
    );
  }

  // Use daily format for intervals >= 6 hours, otherwise include time
  const timeFormat =
    (buckets[0]?.bucketIntervalSeconds ?? 3600) >= 21_600
      ? "MMM d"
      : "MMM d HH:mm";

  // Calculate time range for labels
  const firstTime = new Date(buckets[0].bucketStart).getTime();
  const lastTime = new Date(buckets.at(-1)!.bucketStart).getTime();

  return (
    <div style={{ height }} className="flex flex-col justify-between">
      {/* Status strip - equal width stacked segments for each bucket */}
      <div className="flex h-4 gap-px rounded-md bg-muted/30">
        {buckets.map((bucket, index) => {
          const total = bucket.runCount || 1;
          const healthyPct = (bucket.healthyCount / total) * 100;
          const degradedPct = (bucket.degradedCount / total) * 100;
          const unhealthyPct = (bucket.unhealthyCount / total) * 100;

          // Use actual bucket end time from response (critical for last bucket which extends to query end)
          const bucketStart = new Date(bucket.bucketStart);
          const bucketEnd = new Date(bucket.bucketEnd);
          const timeSpan = `${format(bucketStart, "MMM d, HH:mm")} - ${format(bucketEnd, "HH:mm")}`;

          return (
            <SparklineTooltip
              key={index}
              content={`${timeSpan}\nHealthy: ${bucket.healthyCount}\nDegraded: ${bucket.degradedCount}\nUnhealthy: ${bucket.unhealthyCount}`}
            >
              <div className="flex-1 h-full flex flex-col cursor-pointer group">
                {bucket.healthyCount > 0 && (
                  <div
                    className="w-full transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${healthyPct}%`,
                      backgroundColor: statusColors.healthy,
                    }}
                  />
                )}
                {bucket.degradedCount > 0 && (
                  <div
                    className="w-full transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${degradedPct}%`,
                      backgroundColor: statusColors.degraded,
                    }}
                  />
                )}
                {bucket.unhealthyCount > 0 && (
                  <div
                    className="w-full transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${unhealthyPct}%`,
                      backgroundColor: statusColors.unhealthy,
                    }}
                  />
                )}
              </div>
            </SparklineTooltip>
          );
        })}
      </div>

      {/* Time axis labels */}
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{format(new Date(firstTime), timeFormat)}</span>
        <span>{format(new Date(lastTime), timeFormat)}</span>
      </div>
    </div>
  );
};
