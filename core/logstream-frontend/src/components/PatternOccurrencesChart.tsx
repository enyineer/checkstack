import { useMemo } from "react";
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
 * active queries regardless of `staleTime`).
 */
export function PatternOccurrencesChart({
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
    { staleTime: 15_000 },
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

  return (
    <ChartCard title="Pattern occurrences">
      {isLoading ? (
        <Skeleton variant="chart" />
      ) : hasOccurrences ? (
        <TimeSeriesChart
          primary={series}
          ariaLabel="Pattern occurrences over time"
          formatY={(v) => String(Math.round(v))}
          height={140}
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
}
