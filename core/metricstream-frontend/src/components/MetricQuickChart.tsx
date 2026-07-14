import { useMemo, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  ChartCard,
  TimeSeriesChart,
  DateRangeFilter,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  EmptyState,
  Skeleton,
  formatNumber,
  type DateRange,
  type TimeSeries,
} from "@checkstack/ui";
import { LineChart } from "lucide-react";
import { MetricstreamApi } from "@checkstack/metricstream-common";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { toMetricSeries, hasMetricSamples } from "../lib/metric-series";

export interface MetricQuickChartProps {
  streamId: string;
}

const PICKER_LIMIT = 200;

function last6h(): DateRange {
  const endDate = new Date();
  return {
    startDate: new Date(endDate.getTime() - 6 * 60 * 60 * 1000),
    endDate,
  };
}

/**
 * Overview quick-chart: pick a metric (searchable, server-filtered) and see its
 * windowed shape. The focal line is the per-bucket AVERAGE; a dashed envelope
 * traces the per-bucket MAX so spread reads at a glance (the chart supports one
 * secondary line, not a per-point min/max band). Series are null-filled across
 * the full bucket axis so gaps stay honest and spacing is correct.
 */
export function MetricQuickChart({ streamId }: MetricQuickChartProps) {
  const client = usePluginClient(MetricstreamApi);
  const [range, setRange] = useState<DateRange>(last6h);
  const [search, setSearch] = useState("");
  const [metricName, setMetricName] = useState<string | undefined>();
  const debouncedSearch = useDebouncedValue(search, 250);

  const { data: names, isLoading: namesLoading } =
    client.listMetricNames.useQuery({
      streamId,
      query: debouncedSearch.trim() || undefined,
      limit: PICKER_LIMIT,
    });

  const { data: buckets, isLoading: bucketsLoading } =
    client.getMetricBuckets.useQuery(
      {
        streamId,
        metricName: metricName ?? "",
        from: range.startDate,
        to: range.endDate,
      },
      { enabled: !!metricName },
    );

  const avgSeries: TimeSeries = useMemo(
    () => ({
      id: "avg",
      label: "Average",
      points: buckets
        ? toMetricSeries({
            points: buckets.points,
            grain: buckets.grain,
            from: range.startDate,
            to: range.endDate,
            field: "avg",
          })
        : [],
    }),
    [buckets, range],
  );

  const maxSeries: TimeSeries = useMemo(
    () => ({
      id: "max",
      label: "Max",
      points: buckets
        ? toMetricSeries({
            points: buckets.points,
            grain: buckets.grain,
            from: range.startDate,
            to: range.endDate,
            field: "max",
          })
        : [],
    }),
    [buckets, range],
  );

  const hasData = hasMetricSamples(avgSeries.points);

  return (
    <ChartCard
      title="Metric explorer"
      actions={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Metric-picking controls wrap together as one unit... */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search metrics..."
              className="h-9 w-44"
            />
            <Select value={metricName} onValueChange={setMetricName}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue placeholder="Select a metric" />
              </SelectTrigger>
              <SelectContent>
                {(names?.names ?? []).map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* ...and the time-range filter wraps to its own line when tight, so
              both custom datetime pickers stay reachable. */}
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      }
    >
      {metricName ? (
        bucketsLoading ? (
          <Skeleton variant="chart" />
        ) : hasData ? (
          <TimeSeriesChart
            primary={avgSeries}
            secondary={maxSeries}
            ariaLabel={`${metricName} average and max over time`}
            formatY={(v) => formatNumber(v)}
            // Same 192px footprint as the `chart` Skeleton / EmptyState, so
            // swapping between the three states never shifts the layout.
            height={192}
          />
        ) : (
          <EmptyState
            title="No samples in this range"
            description="This metric has no data in the selected time range. Widen the range or check that the source is sending."
            footprint="chart"
          />
        )
      ) : (
        <EmptyState
          icon={<LineChart className="h-6 w-6" />}
          title={namesLoading ? "Loading metrics..." : "Pick a metric to chart"}
          description="Search and select one of this stream's metrics to see its windowed average and peak."
          footprint="chart"
        />
      )}
    </ChartCard>
  );
}
