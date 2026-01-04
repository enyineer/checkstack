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

export interface LatencyDataPoint {
  timestamp: Date;
  latencyMs: number;
  status: "healthy" | "degraded" | "unhealthy";
}

export interface AggregatedLatencyDataPoint {
  bucketStart: Date;
  avgLatencyMs: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  bucketSize: "hourly" | "daily";
}

type RawLatencyChartProps = {
  type: "raw";
  data: LatencyDataPoint[];
  height?: number;
  showAverage?: boolean;
};

type AggregatedLatencyChartProps = {
  type: "aggregated";
  data: AggregatedLatencyDataPoint[];
  height?: number;
  showAverage?: boolean;
};

type HealthCheckLatencyChartProps =
  | RawLatencyChartProps
  | AggregatedLatencyChartProps;

/**
 * Area chart showing health check latency over time.
 * Supports both raw per-run data and aggregated bucket data.
 * Uses HSL CSS variables for theming consistency.
 */
export const HealthCheckLatencyChart: React.FC<HealthCheckLatencyChartProps> = (
  props
) => {
  const { height = 200, showAverage = true } = props;

  if (props.data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No latency data available
      </div>
    );
  }

  // Transform data based on type
  const isAggregated = props.type === "aggregated";

  const chartData = isAggregated
    ? (props.data as AggregatedLatencyDataPoint[]).map((d) => ({
        timestamp: d.bucketStart.getTime(),
        latencyMs: d.avgLatencyMs,
        minLatencyMs: d.minLatencyMs,
        maxLatencyMs: d.maxLatencyMs,
      }))
    : (props.data as LatencyDataPoint[]).toReversed().map((d) => ({
        timestamp: d.timestamp.getTime(),
        latencyMs: d.latencyMs,
      }));

  // Calculate average latency
  const avgLatency =
    chartData.length > 0
      ? chartData.reduce((sum, d) => sum + d.latencyMs, 0) / chartData.length
      : 0;

  // Format based on bucket size for aggregated data
  const timeFormat = isAggregated
    ? (props.data as AggregatedLatencyDataPoint[])[0]?.bucketSize === "daily"
      ? "MMM d"
      : "MMM d HH:mm"
    : "HH:mm";

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
          domain={["auto", "auto"]}
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
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "var(--radius)",
          }}
          labelFormatter={(ts: number) =>
            format(new Date(ts), "MMM d, HH:mm:ss")
          }
          formatter={(value: number | undefined) => [
            `${value ?? 0}ms`,
            "Latency",
          ]}
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
