import {
  useApi,
  wrapInSuspense,
  permissionApiRef,
} from "@checkmate-monitor/frontend-api";
import { healthCheckApiRef } from "../api";
import {
  PageLayout,
  usePagination,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@checkmate-monitor/ui";
import {
  HealthCheckRunsTable,
  type HealthCheckRunDetailed,
} from "../components/HealthCheckRunsTable";

const HealthCheckHistoryPageContent = () => {
  const api = useApi(healthCheckApiRef);
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canManage, loading: permissionLoading } =
    permissionApi.useResourcePermission("healthcheck", "manage");

  const {
    items: runs,
    loading,
    pagination,
  } = usePagination({
    fetchFn: (params: { limit: number; offset: number }) =>
      api.getDetailedHistory({
        limit: params.limit,
        offset: params.offset,
      }),
    getItems: (response) => response.runs as HealthCheckRunDetailed[],
    getTotal: (response) => response.total,
    defaultLimit: 20,
  });

  return (
    <PageLayout
      title="Health Check History"
      subtitle="Detailed run history with full result data"
      loading={permissionLoading}
      allowed={canManage}
    >
      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthCheckRunsTable
            runs={runs}
            loading={loading}
            showFilterColumns
            pagination={pagination}
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const HealthCheckHistoryPage = wrapInSuspense(
  HealthCheckHistoryPageContent
);
