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
  healthCheckResourceTypes,
  HealthCheckApi,
} from "@checkstack/healthcheck-common";
import { catalogResourceTypes } from "@checkstack/catalog-common";
import { History } from "lucide-react";

const HealthCheckHistoryPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  // Capability-aware: a team-scoped manager of a health check OR of a system
  // (a system's owning team sees its runs) can review run history too,
  // matching the route guard and the backend's handler-side scope.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useCanAccessType({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
      parentType: catalogResourceTypes.system,
    });

  // Pagination state
  const pagination = usePagination({ defaultLimit: 25 });

  // Fetch data with useQuery - newest first for table display
  const { data, isLoading } = healthCheckClient.getDetailedHistory.useQuery({
    limit: pagination.limit,
    offset: pagination.offset,
    sortOrder: "desc",
  });

  // Sync total from response
  usePaginationSync(pagination, data?.total);

  const runs = (data?.runs ?? []) as HealthCheckRunDetailed[];

  return (
    <PageLayout
      title="Health Check History"
      subtitle="Detailed run history with full result data"
      icon={History}
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
  HealthCheckHistoryPageContent,
);
