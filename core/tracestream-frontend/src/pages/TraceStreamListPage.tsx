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
  type DataTableColumn,
} from "@checkstack/ui";
import { Waypoints, Plus, TriangleAlert } from "lucide-react";
import {
  TracestreamApi,
  type TraceStream,
  type TraceStreamSummary,
} from "@checkstack/tracestream-common";
import { useNavigate } from "react-router-dom";
import { CreateStreamDialog } from "../components/CreateStreamDialog";

/**
 * Trace streams list. A read surface: the create action is gated on the
 * contract-derived `createStream` verdict, and the empty state coaches a new
 * user through shipping their first spans. Per-row activity comes from ONE
 * batched, RLAC-filtered `listStreamSummaries` query (never a per-row fetch).
 */
export function TraceStreamListPage() {
  const client = usePluginClient(TracestreamApi);
  const accessApi = useApi(accessApiRef);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  // Both queries are resource-agnostic (they span all streams), so they opt
  // into whole-plugin refresh on ANY stream's activity signal via
  // `meta: { signalScope: "plugin" }`. Detail-page queries need no opt-in -
  // their input carries the streamId, so they auto-match only their own stream.
  const { data, isLoading, isError, error, refetch } = client.listStreams.useQuery(
    {},
    { meta: { signalScope: "plugin" } },
  );
  const { data: summaryData, isLoading: summariesLoading } =
    client.listStreamSummaries.useQuery({}, { meta: { signalScope: "plugin" } });
  const { allowed: canCreate } = accessApi.useProcedureAccess(
    TracestreamApi.contract.createStream,
  );

  const streams = data?.streams ?? [];
  const summaryById = new Map<string, TraceStreamSummary>(
    (summaryData?.summaries ?? []).map((s) => [s.id, s]),
  );

  const metricCell = (
    streamId: string,
    render: (summary: TraceStreamSummary) => ReactNode,
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

  const columns: DataTableColumn<TraceStream>[] = [
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
      id: "traces",
      header: "Traces (24h)",
      desktopOnly: true,
      sortValue: (s) => summaryById.get(s.id)?.traces24h ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatNumber(summary.traces24h)}
          </span>
        )),
    },
    {
      id: "errors",
      header: "Error traces (24h)",
      desktopOnly: true,
      sortValue: (s) => summaryById.get(s.id)?.errorTraces24h ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) =>
          summary.errorTraces24h > 0 ? (
            <StatusBadge
              tone="warn"
              icon={TriangleAlert}
              label={`${formatNumber(summary.errorTraces24h)} errors`}
            />
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
        ),
    },
    {
      id: "services",
      header: "Services",
      sortValue: (s) => summaryById.get(s.id)?.serviceCount ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatNumber(summary.serviceCount)}
          </span>
        )),
    },
  ];

  return (
    <PageLayout
      title="Trace Streams"
      subtitle="Ingest OpenTelemetry traces, sample the interesting ones, then search and inspect waterfalls"
      icon={Waypoints}
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
          icon={<Waypoints className="h-8 w-8" />}
          title="See how requests flow through your system"
          description="Stream distributed traces into Checkstack over OTLP. We tail-sample the interesting traces (errors, slow, and a baseline), keep windowed per-operation aggregates, and let you search traces and inspect their waterfalls."
          steps={[
            "Create a stream to get an ingest endpoint.",
            "Mint a source token.",
            "Point your OpenTelemetry exporter at the stream.",
            "Search traces and open a waterfall to inspect spans.",
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
          onRowClick={(s) => navigate(`/tracestream/${s.id}`)}
        />
      )}

      <CreateStreamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  );
}
