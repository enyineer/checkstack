import { useState, type ReactNode } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import {
  PageLayout,
  EmptyState,
  DataTable,
  Button,
  Skeleton,
  StatusBadge,
  QueryErrorState,
  formatNumber,
  formatRelativeTime,
  cn,
  type DataTableColumn,
} from "@checkstack/ui";
import { Gauge, Plus, TriangleAlert } from "lucide-react";
import {
  MetricstreamApi,
  type MetricStream,
  type MetricStreamSummary,
} from "@checkstack/metricstream-common";
import { signalScopeMeta } from "@checkstack/signal-common";
import { useNavigate } from "react-router-dom";
import { CreateStreamDialog } from "../components/CreateStreamDialog";
import { seriesUsageRatio, seriesUsageTone } from "../lib/usage-tone";

/**
 * Metric streams list. A read surface: the create action is gated on the
 * contract-derived `createStream` verdict, and the empty state coaches a new
 * user through shipping their first metrics.
 */
export function MetricStreamListPage() {
  const client = usePluginClient(MetricstreamApi);
  const accessApi = useApi(accessApiRef);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  // These two are resource-agnostic (they span all streams and show per-row
  // activity), so they opt into whole-plugin refresh on ANY stream's activity
  // signal via `meta: signalScopeMeta`. Detail-page queries need no opt-in -
  // their input carries the streamId, so they auto-match only their own stream.
  const { data, isLoading, isError, error, refetch } = client.listStreams.useQuery(
    {},
    { meta: signalScopeMeta },
  );
  // Per-stream activity metrics in ONE batched, RLAC-filtered query (never a
  // per-row fetch); joined to the stream rows client-side by `id`.
  const { data: summaryData, isLoading: summariesLoading } =
    client.listStreamSummaries.useQuery({}, { meta: signalScopeMeta });
  const { allowed: canCreate } = accessApi.useProcedureAccess(
    MetricstreamApi.contract.createStream,
  );

  const streams = data?.streams ?? [];
  const summaryById = new Map<string, MetricStreamSummary>(
    (summaryData?.summaries ?? []).map((s) => [s.id, s]),
  );

  // Render a metric cell: skeleton while summaries load, else the value.
  const metricCell = (
    streamId: string,
    render: (summary: MetricStreamSummary) => ReactNode,
  ): ReactNode => {
    const summary = summaryById.get(streamId);
    if (summary) return render(summary);
    if (summariesLoading)
      return <Skeleton variant="text" className="h-4 w-10" />;
    return <span className="text-sm text-muted-foreground">0</span>;
  };

  const createButton = canCreate ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4" />
      New stream
    </Button>
  ) : undefined;

  const columns: DataTableColumn<MetricStream>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (s) => s.name.toLowerCase(),
      searchValue: (s) => s.name,
      cell: (s) => (
        <div className="min-w-0">
          <span className="block font-medium text-foreground">{s.name}</span>
          {s.description && (
            <span className="block text-xs text-muted-foreground line-clamp-1">
              {s.description}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "lastReceived",
      header: "Last received",
      desktopOnly: true,
      sortValue: (s) => {
        const at = summaryById.get(s.id)?.lastReceivedAt;
        return at ? new Date(at).getTime() : 0;
      },
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {summary.lastReceivedAt
              ? formatRelativeTime(summary.lastReceivedAt)
              : "Never"}
          </span>
        )),
    },
    {
      id: "rate",
      header: "Datapoints / min",
      desktopOnly: true,
      sortValue: (s) => summaryById.get(s.id)?.approxDatapointsPerMinute ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatNumber(summary.approxDatapointsPerMinute)}
          </span>
        )),
    },
    {
      id: "series",
      header: "Series used",
      sortValue: (s) => {
        const summary = summaryById.get(s.id);
        return summary
          ? seriesUsageRatio({
              seriesCount: summary.seriesCount,
              seriesCap: summary.seriesCap,
            })
          : 0;
      },
      cell: (s) =>
        metricCell(s.id, (summary) => {
          const ratio = seriesUsageRatio({
            seriesCount: summary.seriesCount,
            seriesCap: summary.seriesCap,
          });
          const tone = seriesUsageTone(ratio);
          return (
            <span
              className={cn(
                "text-sm tabular-nums",
                tone === "down"
                  ? "font-medium text-destructive"
                  : tone === "warn"
                    ? "font-medium text-warning"
                    : "text-muted-foreground",
              )}
            >
              {formatNumber(summary.seriesCount)} /{" "}
              {formatNumber(summary.seriesCap)}
            </span>
          );
        }),
    },
    {
      id: "dropped",
      header: "Dropped",
      desktopOnly: true,
      sortValue: (s) => summaryById.get(s.id)?.droppedSeriesCount ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) =>
          summary.droppedSeriesCount > 0 ? (
            <StatusBadge
              tone="warn"
              icon={TriangleAlert}
              label={`${formatNumber(summary.droppedSeriesCount)} dropped`}
            />
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
        ),
    },
  ];

  return (
    <PageLayout
      title="Metric Streams"
      subtitle="Ingest OTLP, Prometheus and native metrics, then assert on them from health checks"
      icon={Gauge}
      actions={streams.length > 0 ? createButton : undefined}
    >
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error}
          resource="streams"
          onRetry={() => void refetch()}
        />
      ) : streams.length === 0 ? (
        <EmptyState
          icon={<Gauge className="h-8 w-8" />}
          title="Turn your metrics into health"
          description="Stream metrics into Checkstack over OTLP, native JSON or Prometheus scraping. We keep windowed aggregates per series and let you assert on them - like 'error rate over 1% for 5 minutes' or 'queue depth above 1000' - right alongside your other health checks."
          steps={[
            "Create a stream to get an ingest endpoint.",
            "Mint a source token or add a scrape target and point your source at the stream.",
            "Add a Metric Stream health check and assert on the metrics.",
          ]}
          actions={createButton}
        />
      ) : (
        <DataTable
          data={streams}
          columns={columns}
          getRowId={(s) => s.id}
          searchable
          searchPlaceholder="Search streams..."
          defaultSort={{ columnId: "name", direction: "asc" }}
          onRowClick={(s) => navigate(`/metricstream/${s.id}`)}
        />
      )}

      <CreateStreamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  );
}
