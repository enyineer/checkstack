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
import { useEnvironmentLabels } from "../hooks/useEnvironmentLabels";
import {
  healthCheckAccess,
  healthCheckResourceTypes,
  healthcheckRoutes,
  HealthCheckApi,
} from "@checkstack/healthcheck-common";
import { catalogResourceTypes } from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import { useNavigate } from "react-router";
import { History } from "lucide-react";

const HealthCheckHistoryPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const navigate = useNavigate();
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
  // Names for the run rows' environment chips, resolved from EVERY environment
  // in the instance so an unassigned-but-existing environment still shows its
  // name. Without this the table was told nothing and labelled every live
  // environment "Removed environment".
  const { environmentLabels, isLoading: environmentLabelsLoading } =
    useEnvironmentLabels();

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
            // Hold the rows until the names resolve: a run whose environment is
            // merely still loading must never flash "Removed environment".
            loading={isLoading || environmentLabelsLoading}
            environmentLabels={environmentLabels}
            showFilterColumns
            pagination={pagination}
            onRowSelect={(run) =>
              navigate(
                resolveRoute(healthcheckRoutes.routes.historyRun, {
                  systemId: run.systemId,
                  configurationId: run.configurationId,
                  runId: run.id,
                }),
              )
            }
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const HealthCheckHistoryPage = wrapInSuspense(
  HealthCheckHistoryPageContent,
);
