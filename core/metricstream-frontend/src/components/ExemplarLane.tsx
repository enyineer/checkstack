import { useMemo } from "react";
import { formatNumber, formatRelativeTime, cn } from "@checkstack/ui";
import type { MetricExemplar } from "@checkstack/telemetry-common";

/**
 * Left gutter (px) the exemplar lane pads by so its diamonds line up with the
 * chart's plot area. Mirrors `TimeSeriesChart`'s internal `AXIS_GUTTER` (the
 * width reserved for the y-axis tick labels); kept as a local constant because
 * the chart does not expose its geometry. If that gutter ever changes, update
 * this to match so the markers stay aligned.
 */
const CHART_AXIS_GUTTER_PX = 44;

export interface ExemplarLaneProps {
  exemplars: MetricExemplar[];
  /** The chart's time domain (same `from`/`to` the buckets were read over). */
  from: Date;
  to: Date;
  /** Open the trace behind an exemplar (resolution happens in the parent). */
  onSelect: (traceId: string) => void;
  /** The exemplar whose trace is currently being resolved (shows a busy ring). */
  pendingTraceId?: string | null;
  /** When true, drop the hover transition (low-power / reduced-motion). */
  isLowPower: boolean;
}

/**
 * A thin lane of diamond markers under the metric chart, one per trace-context
 * exemplar, positioned along the SAME time axis (Grafana-style: exemplars sit on
 * the x-axis, not at the metric value). Clicking a diamond asks the parent to
 * resolve + open the trace. Self-hiding: renders nothing when there are no
 * exemplars, so the chart looks unchanged for metrics without trace context.
 */
export function ExemplarLane({
  exemplars,
  from,
  to,
  onSelect,
  pendingTraceId,
  isLowPower,
}: ExemplarLaneProps) {
  const span = to.getTime() - from.getTime();
  const positioned = useMemo(() => {
    if (span <= 0) return [];
    return exemplars.map((ex) => {
      const fraction = Math.min(
        1,
        Math.max(0, (ex.ts.getTime() - from.getTime()) / span),
      );
      return { ex, fraction };
    });
  }, [exemplars, from, span]);

  if (positioned.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="mb-1 text-xs text-muted-foreground">
        Exemplars &middot; click a marker to open its trace
      </div>
      <div
        className="relative h-5"
        style={{ paddingLeft: CHART_AXIS_GUTTER_PX }}
        role="group"
        aria-label="Trace exemplars"
      >
        <div className="relative h-full">
          {positioned.map(({ ex, fraction }) => {
            const isPending = pendingTraceId === ex.traceId;
            return (
              <button
                key={`${ex.traceId}-${ex.ts.getTime()}`}
                type="button"
                onClick={() => onSelect(ex.traceId)}
                title={`${formatNumber(ex.value)} · ${formatRelativeTime(ex.ts)} · View trace ${ex.traceId.slice(0, 8)}…`}
                aria-label={`Open trace ${ex.traceId} sampled ${formatRelativeTime(ex.ts)}`}
                className={cn(
                  "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]",
                  "border border-[hsl(var(--background))] bg-[hsl(var(--aurora-2))]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !isLowPower && "transition-transform hover:scale-125",
                  isPending && "ring-2 ring-ring",
                )}
                style={{ left: `${fraction * 100}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
