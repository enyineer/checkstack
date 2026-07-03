import { useMemo } from "react";
import { TimeSeriesChart, type SeriesPoint } from "@checkstack/ui";
import type { HealthCheckDiagramSlotContext } from "../slots";

import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";
import {
  deriveExpectedBand,
  deriveTrend,
  formatBaselineChips,
} from "../auto-charts/baseline.logic";

interface HealthCheckLatencyChartProps {
  context: HealthCheckDiagramSlotContext;
  height?: number;
  showAverage?: boolean;
  baselines?: AnomalyBaselineDto[];
}

/**
 * Honest latency chart for aggregated bucket data.
 *
 * Reskinned onto the design-system {@link TimeSeriesChart} primitive
 * (`reviews/design/pro-console` + `calm-premium`): a p50 (avg) aurora area +
 * line layered under a dashed p95 envelope, low-contrast grid, and — when an
 * anomaly baseline exists — a shaded "expected" healthy band plus a dashed
 * reference line at the band's upper bound. Straight raw-bucket segments only
 * (no `monotone` spline), so a spike reads as a spike. Token-driven; no
 * hardcoded colors. Band/trend derivation is shared with the auto-chart tiles
 * via `auto-charts/baseline.logic`.
 */
export const HealthCheckLatencyChart: React.FC<
  HealthCheckLatencyChartProps
> = ({ context, height = 200, showAverage = true, baselines }) => {
  const buckets = useMemo(
    () => context.buckets.filter((b) => b.avgLatencyMs !== undefined),
    [context.buckets],
  );

  const baseline = baselines?.find((b) => b.fieldPath === "latencyMs");

  const { avgPoints, p95Points, avgLatency } = useMemo(() => {
    const avg: SeriesPoint[] = buckets.map((d) => ({
      x: new Date(d.bucketStart).getTime(),
      y: d.avgLatencyMs ?? null,
    }));
    const hasP95 = buckets.some((d) => d.p95LatencyMs !== undefined);
    let p95: SeriesPoint[] | undefined;
    if (hasP95) {
      p95 = buckets.map((d) => ({
        x: new Date(d.bucketStart).getTime(),
        y: d.p95LatencyMs ?? null,
      }));
    }
    const observed = avg.filter((p): p is { x: number; y: number } => p.y !== null);
    let sum = 0;
    for (const p of observed) sum += p.y;
    const mean = observed.length > 0 ? sum / observed.length : 0;
    return { avgPoints: avg, p95Points: p95, avgLatency: mean };
  }, [buckets]);

  // The "expected" band is sigma/sqrt(n) so it reflects the averaged series the
  // chart plots; trend is the slope projected over the baseline window,
  // surfaced as a chip rather than a chart line because it's a rate and shares
  // no natural axis with absolute latency values.
  const band = useMemo(
    () => deriveExpectedBand({ baseline, buckets: context.buckets }),
    [baseline, context.buckets],
  );
  const trend = deriveTrend({ baseline });
  const chips = formatBaselineChips({ band, trend, unit: "ms" });

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

  return (
    <div className="space-y-2">
      {showAverage &&
        (chips.expected ? (
          <div className="flex items-center justify-between text-xs px-1 gap-3">
            <span className="text-[hsl(var(--status-warn))] font-medium">
              {chips.expected}
            </span>
            <div className="flex items-center gap-3">
              {chips.trend && (
                <span
                  className={
                    chips.trend.drifting
                      ? "text-[hsl(var(--status-warn))] font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {chips.trend.text}
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
        ))}
      <TimeSeriesChart
        height={height}
        primary={{ id: "p50", label: "Avg latency", points: avgPoints }}
        secondary={
          p95Points
            ? { id: "p95", label: "p95 latency", points: p95Points }
            : undefined
        }
        healthyBand={band ? { from: band.from, to: band.to } : undefined}
        referenceLine={
          band
            ? { value: band.to, label: "Expected max", tone: "warn" }
            : undefined
        }
        formatY={(v) => `${Math.round(v)}ms`}
        ariaLabel={`Health check latency, average ${avgLatency.toFixed(0)} milliseconds${
          p95Points ? " with p95 envelope" : ""
        }`}
      />
    </div>
  );
};
