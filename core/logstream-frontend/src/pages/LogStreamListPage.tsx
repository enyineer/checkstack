import { useState, type ReactNode } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import {
  PageLayout,
  EmptyState,
  DataTable,
  Button,
  Skeleton,
  QueryErrorState,
  formatRelativeTime,
  cn,
  type DataTableColumn,
} from "@checkstack/ui";
import { ScrollText, Plus } from "lucide-react";
import {
  LogstreamApi,
  type LogStream,
  type LogStreamSummary,
} from "@checkstack/logstream-common";
import { signalScopeMeta } from "@checkstack/signal-common";
import { useNavigate } from "react-router";
import { CreateStreamDialog } from "../components/CreateStreamDialog";

/**
 * Streams list. A read surface: the create action is gated on the
 * contract-derived `createStream` verdict, and the empty state coaches a new
 * user through shipping their first logs.
 */
export function LogStreamListPage() {
  const client = usePluginClient(LogstreamApi);
  const accessApi = useApi(accessApiRef);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  // These two are resource-agnostic (they span all streams and show per-row
  // activity), so they opt into whole-plugin refresh on ANY stream's activity
  // signal via `meta: signalScopeMeta`. Detail-page queries need no opt-in -
  // their input carries the streamId, so they auto-match only their own stream.
  const { data, isLoading, isError, error, refetch } =
    client.listStreams.useQuery({}, { meta: signalScopeMeta });
  // Per-stream activity metrics in ONE batched, RLAC-filtered query (never a
  // per-row fetch); joined to the stream rows client-side by `id`.
  const { data: summaryData, isLoading: summariesLoading } =
    client.listStreamSummaries.useQuery({}, { meta: signalScopeMeta });
  const { allowed: canCreate } = accessApi.useProcedureAccess(
    LogstreamApi.contract.createStream,
  );

  const streams = data?.streams ?? [];
  const summaryById = new Map<string, LogStreamSummary>(
    (summaryData?.summaries ?? []).map((s) => [s.id, s]),
  );

  // Render a metric cell: skeleton while summaries load, else the value.
  const metricCell = (
    streamId: string,
    render: (summary: LogStreamSummary) => ReactNode,
  ): ReactNode => {
    const summary = summaryById.get(streamId);
    if (summary) return render(summary);
    if (summariesLoading) return <Skeleton variant="text" className="h-4 w-10" />;
    return <span className="text-sm text-muted-foreground">0</span>;
  };

  const createButton = canCreate ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4" />
      New stream
    </Button>
  ) : undefined;

  const columns: DataTableColumn<LogStream>[] = [
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
      id: "errors24h",
      header: "Errors (24h)",
      sortValue: (s) => summaryById.get(s.id)?.last24hErrorCount ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span
            className={cn(
              "text-sm tabular-nums",
              summary.last24hErrorCount > 0
                ? "font-medium text-destructive"
                : "text-muted-foreground",
            )}
          >
            {summary.last24hErrorCount}
          </span>
        )),
    },
    {
      id: "warnings24h",
      header: "Warnings (24h)",
      sortValue: (s) => summaryById.get(s.id)?.last24hWarnCount ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span
            className={cn(
              "text-sm tabular-nums",
              summary.last24hWarnCount > 0
                ? "font-medium text-warning"
                : "text-muted-foreground",
            )}
          >
            {summary.last24hWarnCount}
          </span>
        )),
    },
    {
      id: "patterns",
      header: "Patterns",
      desktopOnly: true,
      sortValue: (s) => summaryById.get(s.id)?.patternCount ?? 0,
      cell: (s) =>
        metricCell(s.id, (summary) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {summary.patternCount}
          </span>
        )),
    },
  ];

  return (
    <PageLayout
      title="Log Streams"
      subtitle="Ship application and infrastructure logs, then assert on log-derived health"
      icon={ScrollText}
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
          icon={<ScrollText className="h-8 w-8" />}
          title="Turn your logs into health"
          description="Stream logs into Checkstack over OTLP, native JSON or syslog. We group them into patterns, keep windowed aggregates, and let you assert on log-derived metrics - like 'more than 5 errors in 5 minutes' or 'no logs for 10 minutes' - right alongside your other health checks."
          steps={[
            "Create a stream to get an ingest endpoint.",
            "Mint a source token and point your shipper at the stream.",
            "Add a Log Stream health check and assert on the metrics.",
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
          onRowClick={(s) => navigate(`/logstream/${s.id}`)}
        />
      )}

      <CreateStreamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  );
}
