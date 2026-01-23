import { useState } from "react";
import {
  wrapInSuspense,
  accessApiRef,
  useApi,
  usePluginClient,
} from "@checkstack/frontend-api";
import {
  healthcheckRoutes,
  healthCheckAccess,
  HealthCheckApi,
} from "@checkstack/healthcheck-common";
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
import { History, X } from "lucide-react";
import { format } from "date-fns";
import {
  HealthCheckRunsTable,
  type HealthCheckRunDetailed,
} from "../components/HealthCheckRunsTable";
import { ExpandedResultView } from "../components/ExpandedResultView";
import { SingleRunChartGrid } from "../auto-charts";

const HealthCheckHistoryDetailPageContent = () => {
  const { systemId, configurationId, runId } = useParams<{
    systemId: string;
    configurationId: string;
    runId?: string;
  }>();

  const navigate = useNavigate();
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.manage,
  );

  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);

  // Pagination state
  const pagination = usePagination({ defaultLimit: 20 });

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
        <BackLink to={resolveRoute(healthcheckRoutes.routes.history)}>
          Back to All History
        </BackLink>
      }
    >
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
          <DateRangeFilter
            value={dateRange}
            onChange={setDateRange}
            className="mb-4"
          />
          <HealthCheckRunsTable
            runs={runs}
            loading={isLoading}
            emptyMessage="No health check runs found for this configuration."
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
