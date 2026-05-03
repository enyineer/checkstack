import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { format } from "date-fns";
import type { HealthCheckDiagramSlotContext } from "../slots";

import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";

interface HealthCheckLatencyChartProps {
  context: HealthCheckDiagramSlotContext;
  height?: number;
  showAverage?: boolean;
  baselines?: AnomalyBaselineDto[];
}

/**
 * Area chart showing health check latency over time.
 * Uses aggregated bucket data with average latency per bucket.
 * Uses HSL CSS variables for theming consistency.
 */
export const HealthCheckLatencyChart: React.FC<
  HealthCheckLatencyChartProps
> = ({ context, height = 200, showAverage = true, baselines }) => {
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

  const baseline = baselines?.find((b) => b.fieldPath === "latencyMs");
  const totalRuns = context.buckets.reduce((sum, b) => sum + (b.runCount || 1), 0);
  const avgRunCount = Math.max(1, totalRuns / Math.max(1, context.buckets.length));

  // Trend is the slope projected over the baseline window — a rate, surfaced in
  // the header chip rather than as a chart line so it doesn't share a y-axis
  // with absolute latency values.
  const projectedChange = baseline ? baseline.trendSlope * baseline.sampleCount : 0;
  const showTrend = !!baseline && Math.abs(projectedChange) > 0.01;
  const driftSigmas = baseline && baseline.stdDev > 0
    ? Math.abs(projectedChange) / baseline.stdDev
    : 0;
  const isDrifting = driftSigmas >= 2;

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
    <div className="space-y-2">
      {showAverage && (
        baseline ? (
          <div className="flex items-center justify-between text-xs px-1 gap-3">
            <span className="text-warning font-medium">
              Expected: {baseline.mean.toFixed(0)}ms (±{((baseline.stdDev / Math.sqrt(avgRunCount)) * 3).toFixed(0)})
            </span>
            <div className="flex items-center gap-3">
              {showTrend && (
                <span className={isDrifting ? "text-warning font-medium" : "text-muted-foreground"}>
                  Trend: {projectedChange >= 0 ? "↑ +" : "↓ "}{projectedChange.toFixed(0)}ms
                </span>
              )}
              <span className="text-muted-foreground">
                Avg: {avgLatency.toFixed(0)}ms
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end text-xs px-1">
            <span className="text-muted-foreground">
              Avg: {avgLatency.toFixed(0)}ms
            </span>
          </div>
        )
      )}
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
        <Tooltip
          content={({ active, payload }) => {
             
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
        {baseline && (
          <ReferenceArea
            y1={Math.max(0, baseline.mean - (baseline.stdDev / Math.sqrt(avgRunCount)) * 3)}
            y2={baseline.mean + (baseline.stdDev / Math.sqrt(avgRunCount)) * 3}
            fill="hsl(var(--warning))"
            fillOpacity={0.08}
            stroke="hsl(var(--warning))"
            strokeOpacity={0.4}
            strokeWidth={1}
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
    </div>
  );
};
