import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatTile,
  Skeleton,
  formatNumber,
  formatRelativeTime,
} from "@checkstack/ui";
import { MetricstreamApi } from "@checkstack/metricstream-common";
import {
  seriesUsageRatio,
  seriesUsageTone,
  seriesUsagePercent,
} from "../../lib/usage-tone";
import { MetricQuickChart } from "../MetricQuickChart";
import { ImportantEventsTimeline } from "../ImportantEventsTimeline";

export interface OverviewTabProps {
  streamId: string;
}

/**
 * Overview tab: headline stat tiles (rate, last received, cardinality usage
 * with a cap-warning tone, dropped counters), the important-events feed and a
 * metric quick-chart. All reads come from existing contract procs;
 * resource-scoped activity signals auto-invalidate them.
 */
export function OverviewTab({ streamId }: OverviewTabProps) {
  const client = usePluginClient(MetricstreamApi);

  const { data: overview, isLoading: overviewLoading } =
    client.getStreamOverview.useQuery({ streamId });
  const { data: events } = client.listImportantEvents.useQuery({ streamId });

  const activity = overview?.activity;
  const seriesCount = overview?.seriesCount ?? 0;
  const seriesCap = overview?.seriesCap ?? 0;
  const usageRatio = seriesUsageRatio({ seriesCount, seriesCap });
  const droppedSeries = activity?.droppedSeriesCount ?? 0;
  const droppedDatapoints = activity?.droppedDatapointsCount ?? 0;
  const droppedInTransit = activity?.droppedInTransitCount ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {overviewLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="card" />
          ))
        ) : (
          <>
            <StatTile
              label="Datapoints / min"
              value={formatNumber(activity?.approxDatapointsPerMinute ?? 0)}
            />
            <StatTile
              label="Last received"
              value={
                activity?.lastReceivedAt
                  ? formatRelativeTime(activity.lastReceivedAt)
                  : "Never"
              }
            />
            <StatTile
              label="Series used"
              value={`${formatNumber(seriesCount)} / ${formatNumber(seriesCap)}`}
              tone={seriesUsageTone(usageRatio)}
              footer={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {seriesUsagePercent(usageRatio)}% of cap
                </span>
              }
            />
            <StatTile
              label="Dropped series"
              value={formatNumber(droppedSeries)}
              tone={droppedSeries > 0 ? "warn" : "default"}
              footer={
                droppedDatapoints > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatNumber(droppedDatapoints)} datapoints dropped
                  </span>
                ) : undefined
              }
            />
            <StatTile
              label="Dropped in transit"
              hoverTitle="Datapoints dropped in transit from a satellite during a disconnect."
              value={formatNumber(droppedInTransit)}
              tone={droppedInTransit > 0 ? "warn" : "default"}
            />
          </>
        )}
      </div>

      <MetricQuickChart streamId={streamId} />

      <Card>
        <CardHeader>
          <CardTitle>Important events</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportantEventsTimeline events={events?.events ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
