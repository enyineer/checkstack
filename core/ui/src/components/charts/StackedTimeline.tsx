import React, { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "../../utils";
import { usePerformance } from "../PerformanceProvider";
import {
  downsampleStacked,
  pickTickFormat,
  stackFractions,
  type StackTone,
  type StackedBar,
  type StackedBucket,
} from "./chart-math";
import { ChartTooltip, type ChartTooltipRow } from "./ChartTooltip";
import { useBandHover } from "./use-band-hover";

const toneFill: Record<StackTone, string> = {
  ok: "hsl(var(--status-ok))",
  warn: "hsl(var(--status-warn))",
  down: "hsl(var(--status-down))",
  unknown: "hsl(var(--status-unknown))",
};

const DEFAULT_TONE_LABELS: Record<StackTone, string> = {
  ok: "Healthy",
  warn: "Degraded",
  down: "Unhealthy",
  unknown: "Unknown",
};

export interface StackedTimelineTooltipContent {
  title?: string;
  rows: ChartTooltipRow[];
  footer?: string;
}

export interface StackedTimelineProps {
  /** Buckets oldest-first. Adjacent buckets are grouped down to `maxBars`. */
  buckets: ReadonlyArray<StackedBucket>;
  /** Chart height in px (excluding the tick-label row). Defaults to 96. */
  height?: number;
  /** Maximum bars rendered after downsampling. Defaults to 60. */
  maxBars?: number;
  /** Human labels per tone for tooltips/titles. Defaults to health wording. */
  toneLabels?: Partial<Record<StackTone, string>>;
  /** Override the hover tooltip content for a bar. */
  buildTooltip?: (bar: StackedBar) => StackedTimelineTooltipContent;
  /** Accessible label describing what the timeline shows. */
  ariaLabel: string;
  className?: string;
}

const BAR_W = 6;
const BAR_GAP = 1;
const BAR_RADIUS = 1;

/**
 * Stacked status-count columns over time: one bar per (grouped) bucket, layered
 * bottom-up with the colorblind-safe status triad, scaled to the busiest
 * bucket. Hovering a bar shows the shared `ChartTooltip`; each layer also
 * carries a `<title>` so counts are reachable without hover-tracking. Bars are
 * literal counts — no smoothing, no normalization unless the data itself is.
 */
export const StackedTimeline: React.FC<StackedTimelineProps> = ({
  buckets,
  height = 96,
  maxBars = 60,
  toneLabels,
  buildTooltip,
  ariaLabel,
  className,
}) => {
  const { isLowPower } = usePerformance();

  const bars = useMemo(
    () => downsampleStacked({ buckets, maxBars }),
    [buckets, maxBars],
  );
  const maxTotal = useMemo(() => {
    let max = 0;
    for (const bar of bars) max = Math.max(max, bar.total);
    return max;
  }, [bars]);

  const labels: Record<StackTone, string> = {
    ...DEFAULT_TONE_LABELS,
    ...toneLabels,
  };

  const { hoverIndex, containerRef, containerProps, tooltipStyle, tooltipClassName } =
    useBandHover({ count: bars.length });

  const tickFormat = useMemo(() => {
    const first = bars[0];
    if (first === undefined) return "HH:mm";
    return pickTickFormat({
      intervalSeconds: Math.max(1, (first.end - first.start) / 1000),
    });
  }, [bars]);

  const defaultTooltip = (bar: StackedBar): StackedTimelineTooltipContent => ({
    title: `${format(new Date(bar.start), "MMM d, HH:mm")} – ${format(new Date(bar.end), "HH:mm")}`,
    rows: (Object.keys(toneFill) as StackTone[])
      .filter((tone) => (bar.counts[tone] ?? 0) > 0)
      .map((tone) => ({
        id: tone,
        label: labels[tone],
        value: String(bar.counts[tone]),
        tone,
      })),
    footer: `${bar.total} runs`,
  });

  if (bars.length === 0 || maxTotal === 0) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: no data`}
        className={cn(
          "flex items-center justify-center rounded-[var(--d-card-r)] bg-[hsl(var(--surface-inset))] text-sm text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const viewW = bars.length * BAR_W + (bars.length - 1) * BAR_GAP;
  const hoveredBar = hoverIndex === null ? undefined : bars[hoverIndex];
  const tooltipContent =
    hoveredBar === undefined
      ? undefined
      : (buildTooltip ?? defaultTooltip)(hoveredBar);

  return (
    <div
      ref={containerRef}
      {...containerProps}
      className={cn("relative", className)}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${Math.max(viewW, BAR_W)} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className={cn(
          "block",
          !isLowPower && "animate-in fade-in duration-300",
        )}
      >
        {/* hovered-band highlight behind the bar */}
        {hoverIndex !== null && (
          <rect
            x={hoverIndex * (BAR_W + BAR_GAP) - BAR_GAP / 2}
            y={0}
            width={BAR_W + BAR_GAP}
            height={height}
            fill="hsl(var(--muted))"
            fillOpacity={0.35}
          />
        )}
        {bars.map((bar, i) => {
          const barHeight = (bar.total / maxTotal) * height;
          const segments = stackFractions({ counts: bar.counts });
          const x = i * (BAR_W + BAR_GAP);
          return (
            <g key={bar.start}>
              {segments.map((seg) => {
                // y0/y1 stack bottom-up; SVG y grows downward.
                const segTop = height - seg.y1 * barHeight;
                const segHeight = (seg.y1 - seg.y0) * barHeight;
                const count = bar.counts[seg.tone] ?? 0;
                return (
                  <rect
                    key={seg.tone}
                    x={x}
                    y={segTop}
                    width={BAR_W}
                    height={segHeight}
                    rx={BAR_RADIUS}
                    fill={toneFill[seg.tone]}
                  >
                    <title>{`${labels[seg.tone]}: ${count}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* tick labels as HTML so they never stretch with the bars */}
      <div className="mt-1 flex justify-between text-[10px] leading-none text-muted-foreground">
        <span>{format(new Date(bars[0].start), tickFormat)}</span>
        {bars.length > 2 && (
          <span>
            {format(
              new Date(bars[Math.floor(bars.length / 2)].start),
              tickFormat,
            )}
          </span>
        )}
        <span>{format(new Date(bars.at(-1)?.end ?? bars[0].end), tickFormat)}</span>
      </div>

      {tooltipContent && (
        <div
          className={cn(
            "pointer-events-none absolute top-1 z-10 -translate-x-1/2",
            tooltipClassName,
          )}
          style={tooltipStyle}
        >
          <ChartTooltip
            title={tooltipContent.title}
            rows={tooltipContent.rows}
            footer={tooltipContent.footer}
          />
        </div>
      )}
    </div>
  );
};
