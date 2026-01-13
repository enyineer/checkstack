import {
  useApi,
  wrapInSuspense,
  accessApiRef,
} from "@checkstack/frontend-api";
import { healthCheckApiRef } from "../api";
import {
  PageLayout,
  usePagination,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@checkstack/ui";
import {
  HealthCheckRunsTable,
  type HealthCheckRunDetailed,
} from "../components/HealthCheckRunsTable";
import { healthCheckAccess } from "@checkstack/healthcheck-common";

const HealthCheckHistoryPageContent = () => {
  const api = useApi(healthCheckApiRef);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useAccess(healthCheckAccess.configuration.manage);

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
      loading={accessLoading}
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
