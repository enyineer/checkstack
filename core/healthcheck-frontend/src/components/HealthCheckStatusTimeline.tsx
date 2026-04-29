import { format } from "date-fns";
import { usePerformance } from "@checkstack/ui";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

interface TimelineDatum {
  bucketStart: number;
  bucketEnd: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  runCount: number;
}

const MAX_TIMELINE_BARS = 60;

function downsampleTimeline(
  buckets: HealthCheckDiagramSlotContext["buckets"],
): TimelineDatum[] {
  if (buckets.length === 0) return [];

  const groupSize = Math.max(1, Math.ceil(buckets.length / MAX_TIMELINE_BARS));
  const result: TimelineDatum[] = [];

  for (let i = 0; i < buckets.length; i += groupSize) {
    const slice = buckets.slice(i, i + groupSize);
    const first = slice[0];
    const last = slice.at(-1) ?? first;
    let healthy = 0;
    let degraded = 0;
    let unhealthy = 0;
    let runCount = 0;
    for (const b of slice) {
      healthy += b.healthyCount;
      degraded += b.degradedCount;
      unhealthy += b.unhealthyCount;
      runCount += b.runCount;
    }
    result.push({
      bucketStart: new Date(first.bucketStart).getTime(),
      bucketEnd: new Date(last.bucketEnd).getTime(),
      healthy,
      degraded,
      unhealthy,
      runCount,
    });
  }

  return result;
}

function pickTickFormat(intervalSeconds: number): string {
  if (intervalSeconds >= 86_400) return "MMM d";
  if (intervalSeconds >= 3600) return "MMM d HH:mm";
  return "HH:mm";
}

function StatusTimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TimelineDatum }[];
}) {
  if (!active || !payload?.length) return <></>;
  const datum = payload[0].payload;
  const span = `${format(new Date(datum.bucketStart), "MMM d, HH:mm")} – ${format(new Date(datum.bucketEnd), "HH:mm")}`;
  return (
    <div
      className="rounded-md p-2 text-xs shadow-md"
      style={{
        backgroundColor: "hsl(var(--popover))",
        border: "1px solid hsl(var(--border))",
        color: "hsl(var(--popover-foreground))",
      }}
    >
      <p className="text-muted-foreground mb-1">{span}</p>
      <div className="space-y-0.5">
        <p>
          <span style={{ color: statusColors.healthy }}>●</span> Healthy:{" "}
          {datum.healthy}
        </p>
        {datum.degraded > 0 && (
          <p>
            <span style={{ color: statusColors.degraded }}>●</span> Degraded:{" "}
            {datum.degraded}
          </p>
        )}
        {datum.unhealthy > 0 && (
          <p>
            <span style={{ color: statusColors.unhealthy }}>●</span> Unhealthy:{" "}
            {datum.unhealthy}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Timeline bar chart showing health check status distribution over time.
 * Each bar shows the stacked distribution of statuses in that aggregated bucket.
 */
export const HealthCheckStatusTimeline: React.FC<
  HealthCheckStatusTimelineProps
> = ({ context, height = 96 }) => {
  const { isLowPower } = usePerformance();
  const { buckets } = context;

  if (buckets.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No status data available
      </div>
    );
  }

  const data = downsampleTimeline(buckets);
  const effectiveIntervalSeconds =
    (buckets[0]?.bucketIntervalSeconds ?? 3600) *
    Math.max(1, Math.ceil(buckets.length / MAX_TIMELINE_BARS));
  const tickFormat = pickTickFormat(effectiveIntervalSeconds);

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
          barCategoryGap={1}
        >
          <XAxis
            dataKey="bucketStart"
            tickFormatter={(value: number) => format(new Date(value), tickFormat)}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            minTickGap={48}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
            content={(props) => (
              <StatusTimelineTooltip
                active={props.active}
                payload={
                  props.payload as unknown as
                    | { payload: TimelineDatum }[]
                    | undefined
                }
              />
            )}
          />
          <Bar
            dataKey="healthy"
            stackId="status"
            fill={statusColors.healthy}
            isAnimationActive={!isLowPower}
          />
          <Bar
            dataKey="degraded"
            stackId="status"
            fill={statusColors.degraded}
            isAnimationActive={!isLowPower}
          />
          <Bar
            dataKey="unhealthy"
            stackId="status"
            fill={statusColors.unhealthy}
            isAnimationActive={!isLowPower}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
