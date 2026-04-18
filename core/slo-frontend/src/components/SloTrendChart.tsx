import React, { useMemo } from "react";

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
const CHART_PADDING = { top: 8, right: 12, bottom: 24, left: 48 };

/**
 * Pure SVG line chart showing SLO availability trend from daily snapshots.
 * Draws a target line, area fill, and data line with responsive sizing.
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

    // Y-axis range: ensure target and all data points are visible
    const allValues = sorted.map((s) => s.availabilityPercent);
    const minVal = Math.min(...allValues, target);
    const maxVal = Math.max(...allValues, 100);
    const yMin = Math.max(Math.floor(minVal - 0.5), 0);
    const yMax = Math.min(Math.ceil(maxVal + 0.5), 100);
    const yRange = yMax - yMin || 1;

    return { sorted, yMin, yMax, yRange };
  }, [snapshots, target]);

  if (!chartData || chartData.sorted.length < 2) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        {chartData && chartData.sorted.length === 1
          ? "Need at least 2 daily snapshots to render a trend chart"
          : "No daily snapshot data available yet"}
      </div>
    );
  }

  const { sorted, yMin, yMax, yRange } = chartData;
  const drawWidth = 100 - CHART_PADDING.left - CHART_PADDING.right;

  // Compute scaled positions (in viewBox %)
  const scaleX = (index: number) =>
    CHART_PADDING.left + (index / (sorted.length - 1)) * drawWidth;

  const drawHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const scaleY = (value: number) =>
    CHART_PADDING.top + ((yMax - value) / yRange) * drawHeight;

  // Build SVG path for the line
  const linePath = sorted
    .map(
      (s, i) =>
        `${i === 0 ? "M" : "L"} ${scaleX(i).toFixed(2)} ${scaleY(s.availabilityPercent).toFixed(2)}`,
    )
    .join(" ");

  // Build SVG path for the area fill
  const areaPath = `${linePath} L ${scaleX(sorted.length - 1).toFixed(2)} ${scaleY(yMin).toFixed(2)} L ${scaleX(0).toFixed(2)} ${scaleY(yMin).toFixed(2)} Z`;

  // Target line Y position
  const targetY = scaleY(target);

  // Y-axis tick values
  const yTicks = [yMin, target, yMax].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  // X-axis labels (first, middle, last)
  const xLabels = [0, Math.floor(sorted.length / 2), sorted.length - 1]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((i) => ({
      x: scaleX(i),
      label: new Date(sorted[i].date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));

  return (
    <svg
      viewBox={`0 0 100 ${CHART_HEIGHT}`}
      className="w-full"
      preserveAspectRatio="none"
      style={{ height: CHART_HEIGHT }}
    >
      {/* Area fill */}
      <path d={areaPath} fill="url(#slo-gradient)" opacity={0.3} />

      {/* Gradient definition */}
      <defs>
        <linearGradient id="slo-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Target line */}
      <line
        x1={CHART_PADDING.left}
        y1={targetY}
        x2={100 - CHART_PADDING.right}
        y2={targetY}
        stroke="hsl(var(--destructive))"
        strokeWidth={0.3}
        strokeDasharray="1 1"
        opacity={0.6}
      />

      {/* Data line */}
      <path
        d={linePath}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={0.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {sorted.map((s, i) => (
        <circle
          key={i}
          cx={scaleX(i)}
          cy={scaleY(s.availabilityPercent)}
          r={0.8}
          fill="hsl(var(--primary))"
        >
          <title>
            {new Date(s.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
            : {s.availabilityPercent.toFixed(3)}%
          </title>
        </circle>
      ))}

      {/* Y-axis labels */}
      {yTicks.map((tick) => (
        <text
          key={tick}
          x={CHART_PADDING.left - 2}
          y={scaleY(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-muted-foreground"
          fontSize={3.5}
        >
          {tick}%
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((item) => (
        <text
          key={item.x}
          x={item.x}
          y={CHART_HEIGHT - 4}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={3}
        >
          {item.label}
        </text>
      ))}
    </svg>
  );
};
