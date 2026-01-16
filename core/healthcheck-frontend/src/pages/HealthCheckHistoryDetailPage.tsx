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
  type DateRange,
} from "@checkstack/ui";
import { useParams } from "react-router-dom";
import {
  HealthCheckRunsTable,
  type HealthCheckRunDetailed,
} from "../components/HealthCheckRunsTable";

const HealthCheckHistoryDetailPageContent = () => {
  const { systemId, configurationId } = useParams<{
    systemId: string;
    configurationId: string;
  }>();

  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.manage
  );

  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);

  // Pagination state
  const pagination = usePagination({ defaultLimit: 20 });

  // Fetch data with useQuery
  const { data, isLoading } = healthCheckClient.getDetailedHistory.useQuery({
    systemId,
    configurationId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit: pagination.limit,
    offset: pagination.offset,
  });

  // Sync total from response
  usePaginationSync(pagination, data?.total);

  const runs = (data?.runs ?? []) as HealthCheckRunDetailed[];

  return (
    <PageLayout
      title="Health Check Run History"
      subtitle={`System: ${systemId} • Configuration: ${configurationId?.slice(
        0,
        8
      )}...`}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <BackLink to={resolveRoute(healthcheckRoutes.routes.history)}>
          Back to All History
        </BackLink>
      }
    >
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
  HealthCheckHistoryDetailPageContent
);
