import { useState } from "react";
import {
  wrapInSuspense,
  accessApiRef,
  useApi,
  usePluginClient,
  ExtensionSlot,
} from "@checkstack/frontend-api";
import {
  healthcheckRoutes,
  healthCheckAccess,
  healthCheckResourceTypes,
  HealthCheckApi,
  HealthCheckConfigDetailsSlot,
} from "@checkstack/healthcheck-common";
import { SatelliteApi } from "@checkstack/satellite-common";
import { resolveRoute } from "@checkstack/common";
import {
  PageLayout,
  usePagination,
  usePaginationSync,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  BackLink,
  DateRangeFilter,
  getDefaultDateRange,
  HealthBadge,
  type DateRange,
} from "@checkstack/ui";
import { useParams, useNavigate } from "react-router-dom";
import { History, X, Server, Satellite } from "lucide-react";
import { format } from "date-fns";
import {
  HealthCheckRunsTable,
  type HealthCheckRunDetailed,
} from "../components/HealthCheckRunsTable";
import { ExpandedResultView } from "../components/ExpandedResultView";
import { SingleRunChartGrid } from "../auto-charts";
import {
  StatusFilterPills,
  STATUS_FILTER_TO_STATUSES,
  type StatusFilter,
} from "../components/StatusFilterPills";

const HealthCheckHistoryDetailPageContent = () => {
  const { systemId, configurationId, runId } = useParams<{
    systemId: string;
    configurationId: string;
    runId?: string;
  }>();

  const navigate = useNavigate();
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const satelliteClient = usePluginClient(SatelliteApi);
  const accessApi = useApi(accessApiRef);
  // Capability-aware: a team-scoped manager of a health check (a team grant, no
  // global rule) can open its detailed run history too, matching the route guard.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useCanAccessType({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
    });

  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Pagination state
  const pagination = usePagination({ defaultLimit: 25 });

  // Fetch satellites for the source filter dropdown
  const { data: satellitesData } = satelliteClient.listSatellites.useQuery({});
  const satellites = satellitesData?.satellites ?? [];

  // Fetch specific run if runId is provided
  const { data: specificRun } = healthCheckClient.getRunById.useQuery(
    {
      runId: runId!,
    },
    {
      enabled: !!runId,
    },
  );

  // Fetch configurations to get strategyId
  const { data: configurations } = healthCheckClient.getConfigurations.useQuery(
    {},
    {
      enabled: !!configurationId,
    },
  );
  const configuration = configurations?.configurations.find(
    (c) => c.id === configurationId,
  );

  // Fetch data with useQuery - newest first for table display
  const { data, isLoading } = healthCheckClient.getDetailedHistory.useQuery({
    systemId,
    configurationId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    sourceFilter,
    statusFilter: STATUS_FILTER_TO_STATUSES[statusFilter],
    limit: pagination.limit,
    offset: pagination.offset,
    sortOrder: "desc",
  });

  // Sync total from response
  usePaginationSync(pagination, data?.total);

  const runs = (data?.runs ?? []) as HealthCheckRunDetailed[];

  // Handler to dismiss the highlighted run
  const dismissHighlightedRun = () => {
    navigate(
      resolveRoute(healthcheckRoutes.routes.historyDetail, {
        systemId,
        configurationId,
      }),
      { replace: true },
    );
  };

  return (
    <PageLayout
      title="Health Check Run History"
      subtitle={`System: ${systemId} • Configuration: ${configurationId?.slice(
        0,
        8,
      )}...`}
      icon={History}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <BackLink onClick={() => navigate(resolveRoute(healthcheckRoutes.routes.history))}>
          Back to All History
        </BackLink>
      }
    >
      {/* "Who can change this" — filled by auth-frontend; renders nothing when
          the configuration is not team-scoped. */}
      {configurationId && (
        <div className="mb-4">
          <ExtensionSlot
            slot={HealthCheckConfigDetailsSlot}
            context={{ configurationId }}
          />
        </div>
      )}

      {/* Highlighted specific run when navigated with runId */}
      {runId && specificRun && (
        <Card className="mb-4 border-primary/50 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <span>Selected Run</span>
                <HealthBadge status={specificRun.status} />
              </CardTitle>
              <button
                onClick={dismissHighlightedRun}
                className="p-1 hover:bg-muted rounded"
                title="Dismiss"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {format(new Date(specificRun.timestamp), "PPpp")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExpandedResultView result={specificRun.result} />
            {configuration?.strategyId && (
              <SingleRunChartGrid
                strategyId={configuration.strategyId}
                result={specificRun.result}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
            <StatusFilterPills
              value={statusFilter}
              onChange={(next) => {
                setStatusFilter(next);
                pagination.setPage(1);
              }}
            />
            {/* Source filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Source:</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSourceFilter(undefined)}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
                    sourceFilter === undefined
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setSourceFilter("local")}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
                    sourceFilter === "local"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Server className="h-3 w-3" />
                  Local
                </button>
                {satellites.map((sat) => (
                  <button
                    key={sat.id}
                    onClick={() => setSourceFilter(sat.id)}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
                      sourceFilter === sat.id
                        ? "bg-orange-500 text-white"
                        : "bg-orange-500/10 text-orange-600 hover:bg-orange-500/20"
                    }`}
                  >
                    <Satellite className="h-3 w-3" />
                    {sat.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <HealthCheckRunsTable
            runs={runs}
            loading={isLoading}
            emptyMessage={
              statusFilter !== "all" || sourceFilter !== undefined
                ? "No runs match the current filters."
                : "No health check runs found for this configuration."
            }
            pagination={pagination}
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const HealthCheckHistoryDetailPage = wrapInSuspense(
  HealthCheckHistoryDetailPageContent,
);
