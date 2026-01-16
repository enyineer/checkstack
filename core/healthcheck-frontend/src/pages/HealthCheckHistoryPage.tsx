import {
  wrapInSuspense,
  accessApiRef,
  useApi,
  usePluginClient,
} from "@checkstack/frontend-api";
import {
  PageLayout,
  usePagination,
  usePaginationSync,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@checkstack/ui";
import {
  HealthCheckRunsTable,
  type HealthCheckRunDetailed,
} from "../components/HealthCheckRunsTable";
import {
  healthCheckAccess,
  HealthCheckApi,
} from "@checkstack/healthcheck-common";

const HealthCheckHistoryPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.manage
  );

  // Pagination state
  const pagination = usePagination({ defaultLimit: 20 });

  // Fetch data with useQuery
  const { data, isLoading } = healthCheckClient.getDetailedHistory.useQuery({
    limit: pagination.limit,
    offset: pagination.offset,
  });

  // Sync total from response
  usePaginationSync(pagination, data?.total);

  const runs = (data?.runs ?? []) as HealthCheckRunDetailed[];

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
            loading={isLoading}
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
