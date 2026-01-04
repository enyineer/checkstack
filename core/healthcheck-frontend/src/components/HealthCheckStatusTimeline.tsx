import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { format } from "date-fns";

export interface StatusDataPoint {
  timestamp: Date;
  status: "healthy" | "degraded" | "unhealthy";
}

export interface AggregatedStatusDataPoint {
  bucketStart: Date;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  runCount: number;
  bucketSize: "hourly" | "daily";
}

type RawStatusTimelineProps = {
  type: "raw";
  data: StatusDataPoint[];
  height?: number;
};

type AggregatedStatusTimelineProps = {
  type: "aggregated";
  data: AggregatedStatusDataPoint[];
  height?: number;
};

type HealthCheckStatusTimelineProps =
  | RawStatusTimelineProps
  | AggregatedStatusTimelineProps;

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
> = (props) => {
  const { height = 60 } = props;

  if (props.data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No status data available
      </div>
    );
  }

  const isAggregated = props.type === "aggregated";

  // For raw data: transform to chart format
  // For aggregated data: use stacked bar format
  if (isAggregated) {
    const aggData = props.data as AggregatedStatusDataPoint[];
    const chartData = aggData.map((d) => ({
      timestamp: d.bucketStart.getTime(),
      healthy: d.healthyCount,
      degraded: d.degradedCount,
      unhealthy: d.unhealthyCount,
      total: d.runCount,
    }));

    const timeFormat =
      aggData[0]?.bucketSize === "daily" ? "MMM d" : "MMM d HH:mm";

    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} barGap={1}>
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["auto", "auto"]}
            tickFormatter={(ts: number) => format(new Date(ts), timeFormat)}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "var(--radius)",
            }}
            labelFormatter={(ts: number) =>
              format(new Date(ts), "MMM d, HH:mm")
            }
            formatter={(
              value: number | undefined,
              name: string | undefined
            ) => [
              value ?? 0,
              (name ?? "").charAt(0).toUpperCase() + (name ?? "").slice(1),
            ]}
          />
          <Bar dataKey="healthy" stackId="status" fill={statusColors.healthy} />
          <Bar
            dataKey="degraded"
            stackId="status"
            fill={statusColors.degraded}
          />
          <Bar
            dataKey="unhealthy"
            stackId="status"
            fill={statusColors.unhealthy}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Raw data path
  const rawData = props.data as StatusDataPoint[];
  const chartData = rawData.toReversed().map((d) => ({
    timestamp: d.timestamp.getTime(),
    value: 1, // Fixed height for visibility
    status: d.status,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} barGap={1}>
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={["auto", "auto"]}
          tickFormatter={(ts: number) => format(new Date(ts), "HH:mm")}
          stroke="hsl(var(--muted-foreground))"
          fontSize={10}
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
          formatter={(
            _value: number | undefined,
            _name: string | undefined,
            props: { payload?: { status: string } }
          ) => [props.payload?.status ?? "unknown", "Status"]}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={index}
              fill={statusColors[entry.status as keyof typeof statusColors]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
