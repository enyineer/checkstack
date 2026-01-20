import { format } from "date-fns";
import type { HealthCheckDiagramSlotContext } from "../slots";

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
 * Timeline bar chart showing health check status changes over time.
 * For raw data: each bar represents a check run with color indicating status.
 * For aggregated data: each bar shows the distribution of statuses in that bucket.
 */
export const HealthCheckStatusTimeline: React.FC<
  HealthCheckStatusTimelineProps
> = ({ context, height = 60 }) => {
  if (context.type === "aggregated") {
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
        <div className="flex h-4 gap-px rounded-md overflow-hidden bg-muted/30">
          {buckets.map((bucket, index) => {
            const total = bucket.runCount || 1;
            const healthyPct = (bucket.healthyCount / total) * 100;
            const degradedPct = (bucket.degradedCount / total) * 100;
            const unhealthyPct = (bucket.unhealthyCount / total) * 100;

            // Calculate bucket end time for tooltip
            const bucketStart = new Date(bucket.bucketStart);
            const bucketEnd = new Date(
              bucketStart.getTime() + bucket.bucketIntervalSeconds * 1000,
            );
            const timeSpan = `${format(bucketStart, "MMM d, HH:mm")} - ${format(bucketEnd, "HH:mm")}`;

            return (
              <div
                key={index}
                className="flex-1 h-full flex flex-col overflow-hidden cursor-pointer group"
                title={`${timeSpan}\nHealthy: ${bucket.healthyCount}\nDegraded: ${bucket.degradedCount}\nUnhealthy: ${bucket.unhealthyCount}`}
              >
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
  }

  // Raw data path - use a continuous strip visualization
  const runs = context.runs;

  if (runs.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No status data available
      </div>
    );
  }

  // Sort runs chronologically (oldest first) for left-to-right display
  const sortedRuns = runs.toReversed();

  // Calculate time range for labels
  const firstTime = new Date(sortedRuns[0].timestamp).getTime();
  const lastTime = new Date(sortedRuns.at(-1)!.timestamp).getTime();
  const totalRange = lastTime - firstTime;

  return (
    <div style={{ height }} className="flex flex-col justify-between">
      {/* Status strip - equal width segments for clarity */}
      <div className="flex h-4 gap-px rounded-md overflow-hidden bg-muted/30">
        {sortedRuns.map((run, index) => (
          <div
            key={run.id ?? index}
            className="flex-1 h-full transition-opacity hover:opacity-80 cursor-pointer"
            style={{
              backgroundColor:
                statusColors[run.status as keyof typeof statusColors],
            }}
            title={`${format(new Date(run.timestamp), "MMM d, HH:mm:ss")} - ${run.status}`}
          />
        ))}
      </div>

      {/* Time axis labels */}
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{format(new Date(firstTime), "HH:mm")}</span>
        {totalRange > 3_600_000 && (
          <span>{format(new Date(firstTime + totalRange / 2), "HH:mm")}</span>
        )}
        <span>{format(new Date(lastTime), "HH:mm")}</span>
      </div>
    </div>
  );
};
