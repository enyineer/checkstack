import { useMemo, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartCard,
  StatTile,
  StackedTimeline,
  StatusBadge,
  DateRangeFilter,
  EmptyState,
  Skeleton,
  formatNumber,
  formatRelativeTime,
  type DateRange,
} from "@checkstack/ui";
import { LogstreamApi, type ImportantEvent } from "@checkstack/logstream-common";
import { ScrollText } from "lucide-react";
import {
  severityBandIcon,
  severityBandLabel,
  severityBandToTone,
} from "../../lib/severity-tone";
import {
  SEVERITY_STACK_LABELS,
  toStackedBuckets,
} from "../../lib/severity-buckets";
import { PatternTemplate } from "../PatternTemplate";
import { ImportantEventsTimeline } from "../ImportantEventsTimeline";

function last24h(): DateRange {
  const endDate = new Date();
  return { startDate: new Date(endDate.getTime() - 24 * 60 * 60 * 1000), endDate };
}

export interface OverviewTabProps {
  streamId: string;
  onExploreEvent: (event: ImportantEvent) => void;
  onExplorePattern: (patternId: string) => void;
}

/**
 * Overview tab: headline stat tiles, a severity stacked timeline over a chosen
 * range, the important-events feed and the busiest patterns. All reads come
 * from existing contract procs; same-plugin signals auto-invalidate them.
 */
export function OverviewTab({
  streamId,
  onExploreEvent,
  onExplorePattern,
}: OverviewTabProps) {
  const client = usePluginClient(LogstreamApi);
  const [range, setRange] = useState<DateRange>(last24h);

  const { data: overview, isLoading: overviewLoading } =
    client.getStreamOverview.useQuery({ streamId });

  const { data: buckets, isLoading: bucketsLoading } =
    client.getSeverityBuckets.useQuery({
      streamId,
      from: range.startDate,
      to: range.endDate,
    });

  const { data: events } = client.listImportantEvents.useQuery({ streamId });

  const stacked = useMemo(
    () =>
      buckets
        ? toStackedBuckets({ points: buckets.points, grain: buckets.grain })
        : [],
    [buckets],
  );

  const totals = overview?.last24hSeverityTotals;
  const errors24h = (totals?.error ?? 0) + (totals?.fatal ?? 0);
  const droppedInTransit = overview?.activity?.droppedInTransitCount ?? 0;

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
              label="Rate / min"
              value={formatNumber(overview?.activity?.approxRatePerMinute ?? 0)}
            />
            <StatTile
              label="Last received"
              value={
                overview?.activity?.lastReceivedAt
                  ? formatRelativeTime(overview.activity.lastReceivedAt)
                  : "Never"
              }
            />
            <StatTile
              label="Errors (24h)"
              value={formatNumber(errors24h)}
              tone={errors24h > 0 ? "down" : "default"}
            />
            <StatTile
              label="Warnings (24h)"
              value={formatNumber(totals?.warn ?? 0)}
              tone={(totals?.warn ?? 0) > 0 ? "warn" : "default"}
            />
            <StatTile
              label="Dropped in transit"
              hoverTitle="Log lines dropped in transit from a satellite during a disconnect."
              value={formatNumber(droppedInTransit)}
              tone={droppedInTransit > 0 ? "warn" : "default"}
            />
          </>
        )}
      </div>

      <ChartCard
        title="Severity over time"
        actions={
          <DateRangeFilter value={range} onChange={setRange} />
        }
      >
        {bucketsLoading ? (
          <Skeleton variant="chart" />
        ) : stacked.length === 0 ? (
          <EmptyState
            title="No log volume in this range"
            description="Ship logs to this stream, or widen the time range."
            footprint="chart"
          />
        ) : (
          <StackedTimeline
            buckets={stacked}
            ariaLabel="Log severity counts over time"
            toneLabels={SEVERITY_STACK_LABELS}
            height={140}
          />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Important events</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportantEventsTimeline
              events={events?.events ?? []}
              onEventClick={onExploreEvent}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top patterns</CardTitle>
          </CardHeader>
          <CardContent>
            {overview && overview.topPatterns.length > 0 ? (
              <ul className="space-y-2">
                {overview.topPatterns.map((pattern) => (
                  <li key={pattern.id}>
                    <button
                      type="button"
                      onClick={() => onExplorePattern(pattern.id)}
                      className="flex w-full items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PatternTemplate
                        template={pattern.template}
                        className="min-w-0 flex-1"
                      />
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatNumber(pattern.totalCount)}
                        </span>
                        <StatusBadge
                          tone={severityBandToTone(pattern.band)}
                          icon={severityBandIcon(pattern.band)}
                          label={severityBandLabel(pattern.band)}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<ScrollText className="h-6 w-6" />}
                title="No patterns yet"
                description="Patterns appear once logs start flowing."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
