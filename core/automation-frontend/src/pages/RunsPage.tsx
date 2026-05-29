import React from "react";
import { Link, useParams } from "react-router-dom";
import { History, ChevronLeft } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationAccess,
  automationRoutes,
} from "@checkstack/automation-common";
import type { RunStatus } from "@checkstack/automation-common";
import {
  PageLayout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  LoadingSpinner,
  QueryErrorState,
  EmptyState,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { formatDistanceToNow } from "date-fns";

const RUN_STATUS_VARIANT: Record<
  RunStatus,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  pending: "outline",
  running: "secondary",
  waiting: "warning",
  success: "success",
  failed: "destructive",
  cancelled: "outline",
  skipped: "outline",
};

/**
 * Run history for a single automation. Status filter pinned to the top;
 * rows link to the run detail page. We also surface a `← Back to
 * automation` link in the header — the most common navigation from this
 * page is back to the parent edit page, not back to the list.
 */
const RunsPageContent: React.FC = () => {
  const { automationId } = useParams<{ automationId: string }>();
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );
  const [statusFilter, setStatusFilter] = React.useState<RunStatus | "all">(
    "all",
  );

  const automationQuery = client.getAutomation.useQuery(
    { id: automationId ?? "" },
    { enabled: Boolean(automationId) },
  );

  const runsQuery = client.listRuns.useQuery(
    {
      automationId: automationId ?? "",
      limit: 50,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
    },
    { enabled: Boolean(automationId) },
  );

  const runs = runsQuery.data?.items ?? [];

  return (
    <PageLayout
      title={
        automationQuery.data
          ? `${automationQuery.data.name} — runs`
          : "Run history"
      }
      subtitle="Past executions of this automation"
      icon={History}
      loading={accessLoading}
      allowed={allowed}
      actions={
        automationId && (
          <Link
            to={resolveRoute(automationRoutes.routes.edit, { automationId })}
          >
            <Button variant="outline" size="sm">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back to automation
            </Button>
          </Link>
        )
      }
    >
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Runs</CardTitle>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  "all",
                  "running",
                  "success",
                  "failed",
                  "cancelled",
                  "waiting",
                ] as const
              ).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={statusFilter === option ? "primary" : "outline"}
                  onClick={() => setStatusFilter(option)}
                  className="capitalize"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {runsQuery.isLoading ? (
            <div className="p-6">
              <LoadingSpinner />
            </div>
          ) : runsQuery.isError ? (
            <QueryErrorState
              error={runsQuery.error}
              onRetry={() => runsQuery.refetch()}
            />
          ) : runs.length === 0 ? (
            <EmptyState
              icon={<History className="h-8 w-8 text-muted-foreground" />}
              title="No runs match this filter"
              description="Manually trigger the automation from the edit page to generate a run."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-24 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Badge
                        variant={RUN_STATUS_VARIANT[run.status] ?? "outline"}
                        className="capitalize"
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">
                        {run.triggerEventId || "manual"}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(run.startedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {automationId && (
                        <Link
                          to={resolveRoute(
                            automationRoutes.routes.runDetail,
                            {
                              automationId,
                              runId: run.id,
                            },
                          )}
                        >
                          <Button variant="ghost" size="sm">
                            Open
                          </Button>
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

function formatDuration(
  startedAt: Date | string,
  finishedAt: Date | string | null | undefined,
): string {
  if (!finishedAt) return "—";
  const ms =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export const RunsPage = wrapInSuspense(RunsPageContent);
