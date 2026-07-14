import { memo, useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  ChartCard,
  TimeSeriesChart,
  EmptyState,
  Skeleton,
  type TimeSeries,
} from "@checkstack/ui";
import { LogstreamApi } from "@checkstack/logstream-common";
import { toPatternSeries } from "../lib/pattern-series";

export interface PatternOccurrencesChartProps {
  streamId: string;
  patternId: string;
  /** Window start; drives the buckets query and the grain auto-pick. */
  from: Date;
  /** Window end. */
  to: Date;
}

/**
 * Compact "occurrences over time" timeline for a single pattern, shown in the
 * explorer whenever it is filtered to a pattern. One lightweight query
 * (`getPatternBuckets`, grain auto-picked minute/hour from the window width by
 * the backend), rendered as a `TimeSeriesChart` inside `ChartCard` chrome.
 *
 * `staleTime` keeps a remount within the window from refetching; live updates
 * still arrive via the plugin's activity-signal invalidation (which refetches
 * active queries regardless of `staleTime`). `placeholderData` keeps the last
 * built chart on screen while any refetch (or a rolled live window) loads, so
 * the skeleton only ever shows before the FIRST build - updates never cause a
 * skeleton flash / layout shift.
 *
 * Memoized: the explorer re-renders on every keystroke and row expansion, and
 * this chart's props (ids + the memoized, minute-quantized range) are stable
 * across those - so the whole chart subtree bails out instead of re-rendering.
 */
export const PatternOccurrencesChart = memo(function PatternOccurrencesChart({
  streamId,
  patternId,
  from,
  to,
}: PatternOccurrencesChartProps) {
  const client = usePluginClient(LogstreamApi);

  // The contract has no per-pattern filter, so fetch the window's pattern
  // buckets and keep just this pattern's points in `toPatternSeries`.
  const { data, isLoading } = client.getPatternBuckets.useQuery(
    { streamId, from, to },
    { staleTime: 15_000, placeholderData: (prev) => prev },
  );

  const series: TimeSeries = useMemo(
    () => ({
      id: `pattern-${patternId}`,
      label: "Occurrences",
      points: data
        ? toPatternSeries({
            points: data.points,
            patternId,
            grain: data.grain,
            from,
            to,
          })
        : [],
    }),
    [data, patternId, from, to],
  );
  const hasOccurrences = useMemo(
    () => series.points.some((p) => (p.y ?? 0) > 0),
    [series],
  );

  // All three states share the `chart` footprint height (skeleton variant,
  // EmptyState footprint, and the chart's own 192px = min-h-48), so swapping
  // between them never shifts the layout below.
  return (
    <ChartCard title="Pattern occurrences">
      {isLoading ? (
        <Skeleton variant="chart" />
      ) : hasOccurrences ? (
        <TimeSeriesChart
          primary={series}
          ariaLabel="Pattern occurrences over time"
          formatY={(v) => String(Math.round(v))}
          height={192}
        />
      ) : (
        <EmptyState
          title="No occurrences in this range"
          description="This pattern has no matched lines in the selected time range. Widen the range to see its history."
          footprint="chart"
        />
      )}
    </ChartCard>
  );
});
