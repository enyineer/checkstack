import { useState } from "react";
import {
  useApi,
  wrapInSuspense,
  accessApiRef,
} from "@checkstack/frontend-api";
import { healthCheckApiRef } from "../api";
import {
  healthcheckRoutes,
  healthCheckAccess,
} from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";
import {
  PageLayout,
  usePagination,
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

  const api = useApi(healthCheckApiRef);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useAccess(healthCheckAccess.configuration.manage);

  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);

  const {
    items: runs,
    loading,
    pagination,
  } = usePagination({
    fetchFn: (params) =>
      api.getDetailedHistory({
        systemId,
        configurationId,
        startDate: params.startDate,
        endDate: params.endDate,
        limit: params.limit,
        offset: params.offset,
      }),
    getItems: (response) => response.runs as HealthCheckRunDetailed[],
    getTotal: (response) => response.total,
    defaultLimit: 20,
    extraParams: { startDate: dateRange.startDate, endDate: dateRange.endDate },
  });

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
            loading={loading}
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
