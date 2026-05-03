import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

interface Snapshot {
  date: Date;
  availabilityPercent: number;
  budgetRemainingPercent: number;
}

interface SloTrendChartProps {
  snapshots: Snapshot[];
  target: number;
}

const CHART_HEIGHT = 160;

/**
 * Recharts area chart showing SLO availability trend from daily snapshots.
 */
export const SloTrendChart: React.FC<SloTrendChartProps> = ({
  snapshots,
  target,
}) => {
  const chartData = useMemo(() => {
    if (snapshots.length === 0) return;

    const sorted = snapshots.toSorted(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Format data for Recharts
    const data = sorted.map((s) => ({
      date: new Date(s.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      availabilityPercent: s.availabilityPercent,
      budgetRemainingPercent: s.budgetRemainingPercent,
      fullDate: s.date,
    }));

    // Y-axis range: ensure target and all data points are visible
    const allValues = sorted.map((s) => s.availabilityPercent);
    const minVal = Math.min(...allValues, target);
    const maxVal = Math.max(...allValues, 100);
    const yMin = Math.max(Math.floor(minVal - 0.5), 0);
    const yMax = Math.min(Math.ceil(maxVal + 0.5), 100);

    return { data, yMin, yMax };
  }, [snapshots, target]);

  if (!chartData || chartData.data.length < 2) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        {chartData && chartData.data.length === 1
          ? "Need at least 2 daily snapshots to render a trend chart"
          : "No daily snapshot data available yet"}
      </div>
    );
  }

  const { data, yMin, yMax } = chartData;

  return (
    <div className="w-full" style={{ height: CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: -20 }}
        >
          <defs>
            <linearGradient id="slo-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="date" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            dy={8}
            minTickGap={30}
          />
          <YAxis 
            domain={[yMin, yMax]} 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            tickCount={3}
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip
            content={({ active, payload }) => {
               
              if (!active || !payload?.length) return null;
              const payloadData = payload[0].payload as (typeof data)[number];
              return (
                <div
                  className="rounded-md border bg-popover p-2 text-sm shadow-md"
                  style={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <p className="font-medium text-foreground mb-1">{payloadData.date}</p>
                  <p className="text-primary font-bold">
                    {payloadData.availabilityPercent.toFixed(3)}% Availability
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine 
            y={target} 
            stroke="hsl(var(--destructive))" 
            strokeDasharray="4 4" 
            opacity={0.6} 
          />
          <Area
            type="monotone"
            dataKey="availabilityPercent"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#slo-gradient)"
            activeDot={{ r: 4, fill: "hsl(var(--primary))" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
