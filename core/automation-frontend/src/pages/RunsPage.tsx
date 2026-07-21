import React from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { History, ChevronLeft, ArrowUpRight } from "lucide-react";
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
  RunStatusSchema,
} from "@checkstack/automation-common";
import type { AutomationRun } from "@checkstack/automation-common";
import {
  PageLayout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  DataTable,
  useDataTableFilters,
  parsedFacetValue,
  type DataTableColumn,
  type DataTableFacetOption,
  RowActions,
  RowAction,
  LoadingSpinner,
  QueryErrorState,
  EmptyState,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { formatDistanceToNow } from "date-fns";
import { RunStatusPill } from "./run-status-pill";
import { formatDuration } from "./run-duration";

/**
 * Run outcome, as pills: the whole point of this page is scanning for the runs
 * that went wrong, so every outcome stays one click away rather than behind a
 * dropdown. Options mirror `RunStatusSchema`, which is what the query filters on.
 */
const RUN_STATUS_FACET_ID = "status";
const RUN_STATUS_OPTIONS: readonly DataTableFacetOption[] = [
  { value: "running", label: "Running" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "waiting", label: "Waiting" },
];

/**
 * Run history for a single automation. Status filter pinned to the top;
 * rows link to the run detail page. We also surface a `← Back to
 * automation` link in the header — the most common navigation from this
 * page is back to the parent edit page, not back to the list.
 */
const RunsPageContent: React.FC = () => {
  const { automationId } = useParams<{ automationId: string }>();
  const navigate = useNavigate();
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );
  // The Status column owns the control; the selection ALSO narrows the runs
  // query, which is what reduces the fetch. URL-backed, so a link to "the failed
  // runs of this automation" reopens filtered.
  const filters = useDataTableFilters({ facetIds: [RUN_STATUS_FACET_ID] });
  const statusFilter = parsedFacetValue({
    filters: filters.state,
    facetId: RUN_STATUS_FACET_ID,
    schema: RunStatusSchema,
  });

  const automationQuery = client.getAutomation.useQuery(
    { id: automationId ?? "" },
    // Drop the cache entry as soon as this page unmounts: the editor seeds its
    // form from this same `getAutomation` cache key once, and a lingering entry
    // here would let it seed pre-edit (stale) data. See AutomationEditPage.
    { enabled: Boolean(automationId), gcTime: 0 },
  );

  const runsQuery = client.listRuns.useQuery(
    {
      automationId: automationId ?? "",
      limit: 50,
      ...(statusFilter === undefined ? {} : { status: statusFilter }),
    },
    { enabled: Boolean(automationId) },
  );

  const runs = runsQuery.data?.items ?? [];

  const columns: DataTableColumn<AutomationRun>[] = [
    {
      id: "status",
      header: "Status",
      sortValue: (run) => run.status,
      filterValue: (run) => run.status,
      filterOptions: RUN_STATUS_OPTIONS,
      // Pills: the whole point of this page is scanning for the runs that went
      // wrong, so every outcome stays one click away.
      filterKind: "pills",
      filterAnyLabel: "All",
      cell: (run) => <RunStatusPill status={run.status} />,
    },
    {
      id: "trigger",
      header: "Trigger",
      sortValue: (run) => run.triggerEventId || "manual",
      cell: (run) => (
        <code className="font-mono text-xs">
          {run.triggerEventId || "manual"}
        </code>
      ),
    },
    {
      id: "started",
      header: "Started",
      sortValue: (run) => new Date(run.startedAt).getTime(),
      cell: (run) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      sortValue: (run) =>
        run.finishedAt
          ? new Date(run.finishedAt).getTime() -
            new Date(run.startedAt).getTime()
          : undefined,
      cell: (run) => (
        <span className="text-xs text-muted-foreground">
          {formatDuration(run.startedAt, run.finishedAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      headClassName: "w-24 text-right",
      cellClassName: "text-right",
      cell: (run) =>
        automationId ? (
          <RowActions>
            <RowAction
              icon={ArrowUpRight}
              label="Open run details"
              onClick={() =>
                navigate(
                  resolveRoute(automationRoutes.routes.runDetail, {
                    automationId,
                    runId: run.id,
                  }),
                )
              }
            />
          </RowActions>
        ) : null,
    },
  ];

  return (
    <PageLayout
      title={
        automationQuery.data
          ? `${automationQuery.data.name} - runs`
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
          <CardTitle className="text-base">Runs</CardTitle>
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
          ) : (
            <DataTable
              data={runs}
              columns={columns}
              getRowId={(run) => run.id}
              // The Status column declares its own filter, so the pills sit in
              // the table's bar. Runs are identified by time and outcome, not
              // by a name worth typing, so there is no search box.
              filters={filters.state}
              onFiltersChange={filters.setState}
              onClearFilters={filters.clear}
              searchable={false}
              // The list arrives already narrowed by the server, so an empty
              // `data` means either outcome. Suppressing `emptyState` while a
              // filter is active is what lets the table tell them apart - and
              // rendering both INSIDE the table keeps the pills on screen, so a
              // filter that matches nothing can still be cleared.
              emptyState={
                filters.active ? undefined : (
                  <EmptyState
                    icon={<History className="h-8 w-8 text-muted-foreground" />}
                    title="No runs yet"
                    description="Manually trigger the automation from the edit page to generate a run."
                  />
                )
              }
              noResultsState={
                <EmptyState
                  icon={<History className="h-8 w-8 text-muted-foreground" />}
                  title="No runs match this filter"
                  description="No run of this automation has that outcome."
                  actions={
                    <Button variant="outline" onClick={filters.clear}>
                      Clear filter
                    </Button>
                  }
                />
              }
              // Nested inside the page's opaque Card, so the default bg-card
              // surface would create a panel-in-panel; the enclosing Card
              // already provides the opaque background.
              surface={false}
              renderMobileCard={(run) => (
                <div className="rounded-md border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <RunStatusPill status={run.status} />
                    {automationId && (
                      <RowActions>
                        <RowAction
                          icon={ArrowUpRight}
                          label="Open run details"
                          onClick={() =>
                            navigate(
                              resolveRoute(automationRoutes.routes.runDetail, {
                                automationId,
                                runId: run.id,
                              }),
                            )
                          }
                        />
                      </RowActions>
                    )}
                  </div>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span>Trigger:</span>
                      <code className="font-mono">
                        {run.triggerEventId || "manual"}
                      </code>
                    </div>
                    <div>
                      Started{" "}
                      {formatDistanceToNow(new Date(run.startedAt), {
                        addSuffix: true,
                      })}
                    </div>
                    <div>
                      Duration: {formatDuration(run.startedAt, run.finishedAt)}
                    </div>
                  </div>
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const RunsPage = wrapInSuspense(RunsPageContent);
