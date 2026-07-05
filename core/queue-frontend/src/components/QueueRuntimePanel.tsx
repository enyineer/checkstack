import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  QueueApi,
  type JobStateDto,
  type JobSummaryDto,
} from "@checkstack/queue-common";
import {
  cn,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InstanceScopeBanner,
  Pagination,
  DataTable,
  type DataTableColumn,
  Tabs,
  TabPanel,
  EmptyState,
  QueryErrorState,
  formatRelativeTime,
} from "@checkstack/ui";
import { CountTile } from "./CountTile";
import { JobStatePill } from "./JobStatePill";
import { hasRetried } from "./jobDisplay.logic";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  PlayCircle,
} from "lucide-react";

const REFRESH_INTERVAL_MS = 5000;
const PAGE_SIZE = 25;

const formatRelative = (date?: Date) =>
  date ? formatRelativeTime(date) : "—";

const formatDuration = (start?: Date, end?: Date) => {
  if (!start) return "—";
  const finish = end ?? new Date();
  const ms = finish.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
};

const truncateMiddle = (s: string, head = 8, tail = 6) => {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const formatCountdown = (target?: Date) => {
  if (!target) return "—";
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  return `in ${Math.round(hr / 24)}d`;
};

interface JobsTableProps {
  state: JobStateDto;
}

const JobsTable = ({ state }: JobsTableProps) => {
  const queueClient = usePluginClient(QueueApi);
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, error, refetch } = queueClient.listJobs.useQuery(
    { state, offset, limit: PAGE_SIZE },
    { refetchInterval: REFRESH_INTERVAL_MS },
  );

  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={() => {
          void refetch();
        }}
        resource="jobs"
      />
    );
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data || data.items.length === 0) {
    return <EmptyState title={`No ${state} jobs.`} />;
  }

  const showFinished = state === "completed" || state === "failed";
  const showError = state === "failed";
  const showState = state === "pending";
  const showNextRun =
    state === "pending" || state === "delayed" || state === "waiting";

  // total may be null for backends that can't compute it cheaply; in that
  // case we synthesise totalPages from hasMore so the next button stays usable.
  const totalPages =
    data.total === null
      ? data.hasMore
        ? page + 1
        : page
      : Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const columns: DataTableColumn<JobSummaryDto>[] = [
    {
      id: "id",
      header: "Job ID",
      headClassName: "w-[140px]",
      cellClassName: "font-mono text-xs whitespace-nowrap",
      cell: (job) => <span title={job.id}>{truncateMiddle(job.id)}</span>,
    },
    {
      id: "queue",
      header: "Queue",
      sortValue: (job) => job.name ?? "",
      cell: (job) => job.name ?? "—",
    },
    ...(showState
      ? [
          {
            id: "state",
            header: "State",
            sortValue: (job) => (job.recurring ? "Recurring" : job.state),
            cell: (job) => (
              <JobStatePill label={job.recurring ? "Recurring" : job.state} />
            ),
          } satisfies DataTableColumn<JobSummaryDto>,
        ]
      : []),
    {
      id: "enqueued",
      header: "Enqueued",
      sortValue: (job) => job.enqueuedAt.getTime(),
      cell: (job) => (
        <span title={job.enqueuedAt.toString()}>
          {formatRelative(job.enqueuedAt)}
        </span>
      ),
    },
    ...(showNextRun
      ? [
          {
            id: "nextRun",
            header: "Next run",
            sortValue: (job) => job.nextRunAt?.getTime() ?? null,
            cell: (job) => (
              <span title={job.nextRunAt?.toString()}>
                {formatCountdown(job.nextRunAt)}
              </span>
            ),
          } satisfies DataTableColumn<JobSummaryDto>,
        ]
      : []),
    ...(state === "active"
      ? [
          {
            id: "runningFor",
            header: "Running for",
            sortValue: (job) =>
              job.startedAt ? Date.now() - job.startedAt.getTime() : null,
            cell: (job) => formatDuration(job.startedAt),
          } satisfies DataTableColumn<JobSummaryDto>,
        ]
      : []),
    ...(showFinished
      ? [
          {
            id: "finished",
            header: "Finished",
            sortValue: (job) => job.finishedAt?.getTime() ?? null,
            cell: (job) => (
              <span title={job.finishedAt?.toString()}>
                {formatRelative(job.finishedAt)}
              </span>
            ),
          } satisfies DataTableColumn<JobSummaryDto>,
          {
            id: "duration",
            header: "Duration",
            sortValue: (job) =>
              job.startedAt && job.finishedAt
                ? job.finishedAt.getTime() - job.startedAt.getTime()
                : null,
            cell: (job) => formatDuration(job.startedAt, job.finishedAt),
          } satisfies DataTableColumn<JobSummaryDto>,
        ]
      : []),
    {
      id: "attempts",
      header: "Attempts",
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
      sortValue: (job) => job.attempts,
      cell: (job) => (
        <span
          className={cn(
            hasRetried(job.attempts) && "font-medium text-status-warn",
          )}
        >
          {job.attempts}
        </span>
      ),
    },
    ...(showError
      ? [
          {
            id: "error",
            header: "Error",
            cellClassName: "max-w-[280px] text-status-down",
            cell: (job) => (
              <span className="flex items-center gap-1.5" title={job.failedReason}>
                <AlertTriangle
                  className="h-3.5 w-3.5 shrink-0 text-status-down"
                  aria-hidden
                />
                <span className="truncate">{job.failedReason ?? "—"}</span>
              </span>
            ),
          } satisfies DataTableColumn<JobSummaryDto>,
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      {/* No own surface: the enclosing QueueRuntimePanel Card provides it. */}
      <DataTable
        data={data.items}
        columns={columns}
        getRowId={(job) => job.id}
        surface={false}
        renderMobileCard={(job) => (
          <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
            {/* Accent stripe only on the down signal; color reserved for it. */}
            {showError && (
              <span
                className="absolute inset-y-0 left-0 w-1 bg-status-down"
                aria-hidden
              />
            )}
            <div className={cn(showError && "pl-2")}>
              <div className="flex items-start justify-between gap-2">
                <span
                  className="font-mono text-xs whitespace-nowrap"
                  title={job.id}
                >
                  {truncateMiddle(job.id)}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {showState && (
                    <JobStatePill
                      label={job.recurring ? "Recurring" : job.state}
                    />
                  )}
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      hasRetried(job.attempts)
                        ? "font-medium text-status-warn"
                        : "text-muted-foreground",
                    )}
                  >
                    {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {job.name ?? "—"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span title={job.enqueuedAt.toString()}>
                  Enqueued {formatRelative(job.enqueuedAt)}
                </span>
                {showNextRun && (
                  <span title={job.nextRunAt?.toString()}>
                    Next {formatCountdown(job.nextRunAt)}
                  </span>
                )}
                {state === "active" && (
                  <span>Running {formatDuration(job.startedAt)}</span>
                )}
                {showFinished && (
                  <span title={job.finishedAt?.toString()}>
                    Finished {formatRelative(job.finishedAt)}
                  </span>
                )}
                {showFinished && (
                  <span>
                    Took {formatDuration(job.startedAt, job.finishedAt)}
                  </span>
                )}
              </div>
              {showError && job.failedReason && (
                <div
                  className="mt-1 flex items-start gap-1.5 text-xs text-status-down"
                  title={job.failedReason}
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-down"
                    aria-hidden
                  />
                  <span className="break-words">{job.failedReason}</span>
                </div>
              )}
            </div>
          </div>
        )}
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data.total ?? undefined}
        showTotal={data.total !== null}
      />
    </div>
  );
};

const SUB_TABS = [
  { id: "pending", label: "Pending", icon: <Hourglass className="h-4 w-4" /> },
  { id: "active", label: "Active", icon: <PlayCircle className="h-4 w-4" /> },
  {
    id: "failed",
    label: "Recent failed",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  {
    id: "completed",
    label: "Recent completed",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
] as const;

/**
 * Queue Runtime panel. Aggregated counts, then a paginated tabbed listing
 * of Active / Recent failed / Recent completed jobs. Job payloads are
 * deliberately not surfaced — they may carry secrets.
 */
export const QueueRuntimePanel = () => {
  const queueClient = usePluginClient(QueueApi);
  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = queueClient.getStats.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const [activeSubTab, setActiveSubTab] = useState<JobStateDto>("pending");

  return (
    <div className="space-y-4">
      <InstanceScopeBanner
        scope={stats?.scope ?? "instance"}
        subject="Queue"
        recommendation="Switch to a Redis-backed queue (e.g. BullMQ) for cluster-wide visibility."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Queue Runtime
          </CardTitle>
          <CardDescription>
            Live aggregated job counts. Refreshes every{" "}
            {REFRESH_INTERVAL_MS / 1000}s.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <QueryErrorState
              error={error}
              onRetry={() => {
                void refetch();
              }}
              resource="queue stats"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CountTile
                label="Pending"
                value={isLoading ? undefined : stats?.pending}
                icon={Clock}
                tone="warning"
              />
              <CountTile
                label="Processing"
                value={isLoading ? undefined : stats?.processing}
                icon={Loader2}
                tone="default"
              />
              <CountTile
                label="Completed"
                value={isLoading ? undefined : stats?.completed}
                icon={CheckCircle2}
                tone="success"
              />
              <CountTile
                label="Failed"
                value={isLoading ? undefined : stats?.failed}
                icon={AlertTriangle}
                tone="danger"
              />
            </div>
          )}

          <div className="space-y-3">
            <Tabs
              items={SUB_TABS.map((t) => ({
                id: t.id,
                label: t.label,
                icon: t.icon,
              }))}
              activeTab={activeSubTab}
              onTabChange={(id) => setActiveSubTab(id as JobStateDto)}
            />
            <TabPanel id="pending" activeTab={activeSubTab}>
              <JobsTable state="pending" />
            </TabPanel>
            <TabPanel id="active" activeTab={activeSubTab}>
              <JobsTable state="active" />
            </TabPanel>
            <TabPanel id="failed" activeTab={activeSubTab}>
              <JobsTable state="failed" />
            </TabPanel>
            <TabPanel id="completed" activeTab={activeSubTab}>
              <JobsTable state="completed" />
            </TabPanel>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
