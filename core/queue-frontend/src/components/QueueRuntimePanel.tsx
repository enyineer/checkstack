import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { QueueApi, type JobStateDto } from "@checkstack/queue-common";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InstanceScopeBanner,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabPanel,
} from "@checkstack/ui";
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

const formatNumber = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });

const formatRelative = (date?: Date) => {
  if (!date) return "—";
  const ms = Date.now() - date.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
};

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

interface CountTileProps {
  label: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  tone: "default" | "warning" | "danger" | "success";
}

const toneClasses: Record<CountTileProps["tone"], string> = {
  default: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
  success: "text-emerald-600 dark:text-emerald-400",
};

const CountTile = ({ label, value, icon: Icon, tone }: CountTileProps) => (
  <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
    <Icon className={`h-5 w-5 shrink-0 ${toneClasses[tone]}`} />
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {value === undefined ? "—" : formatNumber(value)}
      </div>
    </div>
  </div>
);

interface JobsTableProps {
  state: JobStateDto;
}

const JobsTable = ({ state }: JobsTableProps) => {
  const queueClient = usePluginClient(QueueApi);
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, error } = queueClient.listJobs.useQuery(
    { state, offset, limit: PAGE_SIZE },
    { refetchInterval: REFRESH_INTERVAL_MS },
  );

  if (error) {
    return <p className="text-sm text-destructive">Failed to load jobs.</p>;
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data || data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No {state} jobs.</p>;
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

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[140px]">Job ID</TableHead>
            <TableHead>Queue</TableHead>
            {showState && <TableHead>State</TableHead>}
            <TableHead>Enqueued</TableHead>
            {showNextRun && <TableHead>Next run</TableHead>}
            {state === "active" && <TableHead>Running for</TableHead>}
            {showFinished && <TableHead>Finished</TableHead>}
            {showFinished && <TableHead>Duration</TableHead>}
            <TableHead className="text-right">Attempts</TableHead>
            {showError && <TableHead>Error</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((job) => (
            <TableRow key={job.id}>
              <TableCell
                className="font-mono text-xs whitespace-nowrap"
                title={job.id}
              >
                {truncateMiddle(job.id)}
              </TableCell>
              <TableCell>{job.name ?? "—"}</TableCell>
              {showState && (
                <TableCell className="capitalize">
                  {job.recurring ? "Recurring" : job.state}
                </TableCell>
              )}
              <TableCell title={job.enqueuedAt.toString()}>
                {formatRelative(job.enqueuedAt)}
              </TableCell>
              {showNextRun && (
                <TableCell title={job.nextRunAt?.toString()}>
                  {formatCountdown(job.nextRunAt)}
                </TableCell>
              )}
              {state === "active" && (
                <TableCell>{formatDuration(job.startedAt)}</TableCell>
              )}
              {showFinished && (
                <TableCell title={job.finishedAt?.toString()}>
                  {formatRelative(job.finishedAt)}
                </TableCell>
              )}
              {showFinished && (
                <TableCell>
                  {formatDuration(job.startedAt, job.finishedAt)}
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums">
                {job.attempts}
              </TableCell>
              {showError && (
                <TableCell
                  className="max-w-[280px] truncate text-destructive"
                  title={job.failedReason}
                >
                  {job.failedReason ?? "—"}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
  const { data: stats, isLoading, error } = queueClient.getStats.useQuery(
    undefined,
    { refetchInterval: REFRESH_INTERVAL_MS },
  );
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
            <div className="text-sm text-destructive">
              Failed to load queue stats.
            </div>
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
