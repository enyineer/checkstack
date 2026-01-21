import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import type { HealthCheckDiagramSlotContext } from "../slots";

interface HealthCheckLatencyChartProps {
  context: HealthCheckDiagramSlotContext;
  height?: number;
  showAverage?: boolean;
}

/**
 * Area chart showing health check latency over time.
 * Uses aggregated bucket data with average latency per bucket.
 * Uses HSL CSS variables for theming consistency.
 */
export const HealthCheckLatencyChart: React.FC<
  HealthCheckLatencyChartProps
> = ({ context, height = 200, showAverage = true }) => {
  const buckets = context.buckets.filter((b) => b.avgLatencyMs !== undefined);

  if (buckets.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No latency data available
      </div>
    );
  }

  const chartData = buckets.map((d) => ({
    timestamp: new Date(d.bucketStart).getTime(),
    bucketEndTimestamp: new Date(d.bucketEnd).getTime(),
    latencyMs: d.avgLatencyMs!,
    minLatencyMs: d.minLatencyMs,
    maxLatencyMs: d.maxLatencyMs,
  }));

  const avgLatency =
    chartData.length > 0
      ? chartData.reduce((sum, d) => sum + d.latencyMs, 0) / chartData.length
      : 0;

  // Use daily format for intervals >= 6 hours, otherwise include time
  const timeFormat =
    (buckets[0]?.bucketIntervalSeconds ?? 3600) >= 21_600
      ? "MMM d"
      : "MMM d, HH:mm";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="hsl(var(--primary))"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="hsl(var(--primary))"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ts: number) => format(new Date(ts), timeFormat)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickFormatter={(v: number) => `${v}ms`}
        />
        <Tooltip<number, "latencyMs">
          content={({ active, payload }) => {
            // eslint-disable-next-line unicorn/no-null -- recharts requires null return, not undefined
            if (!active || !payload?.length) return null;
            const data = payload[0].payload as (typeof chartData)[number];
            const startTime = format(new Date(data.timestamp), "MMM d, HH:mm");
            const endTime = format(new Date(data.bucketEndTimestamp), "HH:mm");
            return (
              <div
                className="rounded-md border bg-popover p-2 text-sm shadow-md"
                style={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                }}
              >
                <p className="text-muted-foreground">
                  {startTime} - {endTime}
                </p>
                <p className="font-medium">{data.latencyMs}ms (avg)</p>
              </div>
            );
          }}
        />
        {showAverage && (
          <ReferenceLine
            y={avgLatency}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="3 3"
            label={{
              value: `Avg: ${avgLatency.toFixed(0)}ms`,
              position: "right",
              fill: "hsl(var(--muted-foreground))",
              fontSize: 12,
            }}
          />
        )}
        <Area
          type="monotone"
          dataKey="latencyMs"
          stroke="hsl(var(--primary))"
          fill="url(#latencyGradient)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};
