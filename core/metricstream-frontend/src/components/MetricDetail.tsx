import { usePluginClient } from "@checkstack/frontend-api";
import { Badge, Skeleton, formatNumber } from "@checkstack/ui";
import {
  MetricstreamApi,
  type MetricSeriesInfo,
} from "@checkstack/metricstream-common";

export interface MetricDetailProps {
  streamId: string;
  metricName: string;
}

/** Render a compact `key=value` label chip row for a sample series. */
function seriesLabels(series: MetricSeriesInfo): string {
  const entries = Object.entries(series.labels);
  if (entries.length === 0) return "(no labels)";
  return entries.map(([k, v]) => `${k}="${v}"`).join(", ");
}

/**
 * Expanded metric detail: the metric's DISTINCT label keys and a bounded sample
 * of concrete series, for cardinality context. Fetched lazily - this only
 * mounts when its accordion row is open.
 */
export function MetricDetail({ streamId, metricName }: MetricDetailProps) {
  const client = usePluginClient(MetricstreamApi);
  const { data: keys, isLoading: keysLoading } = client.listLabelKeys.useQuery({
    streamId,
    metricName,
  });
  const { data: series, isLoading: seriesLoading } =
    client.listMetricSeries.useQuery({ streamId, metricName, limit: 20 });

  return (
    <div className="space-y-4 pl-2">
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Label keys
        </p>
        {keysLoading ? (
          <Skeleton variant="text" className="h-5 w-40" />
        ) : (keys?.keys ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No labels on this metric.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {keys?.keys.map((key) => (
              <Badge key={key} variant="secondary">
                {key}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sample series
        </p>
        {seriesLoading ? (
          <div className="space-y-1.5" aria-busy="true">
            <Skeleton variant="text" className="h-4 w-3/4" />
            <Skeleton variant="text" className="h-4 w-2/3" />
          </div>
        ) : (series?.series ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No series recorded yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {series?.series.map((s) => (
              <li
                key={s.id}
                className="truncate font-mono text-xs text-muted-foreground"
                title={seriesLabels(s)}
              >
                {seriesLabels(s)}
              </li>
            ))}
          </ul>
        )}
        {series && series.series.length >= 20 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Showing the first {formatNumber(20)} series.
          </p>
        )}
      </div>
    </div>
  );
}
