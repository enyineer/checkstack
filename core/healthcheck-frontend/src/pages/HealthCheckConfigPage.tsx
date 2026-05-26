import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  wrapInSuspense,
  accessApiRef,
  useApi,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  type HealthCheckConfiguration,
  healthcheckRoutes,
  healthCheckAccess,
  pluginMetadata as healthcheckPluginMetadata,
} from "@checkstack/healthcheck-common";
import { Tip } from "@checkstack/tips-frontend";
import {
  HealthCheckList,
  HealthCheckListSkeleton,
} from "../components/HealthCheckList";
import {
  Button,
  ConfirmationModal,
  ListEmptyState,
  PageLayout,
  QueryErrorState,
  useToast,
} from "@checkstack/ui";
import { Plus, History, Activity } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute, extractErrorMessage} from "@checkstack/common";
import { useState } from "react";

const HealthCheckConfigPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.read,
  );
  const { allowed: canManage } = accessApi.useAccess(
    healthCheckAccess.configuration.manage,
  );

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<string | undefined>();

  // Fetch configurations with useQuery
  const configurationsQuery = healthCheckClient.getConfigurations.useQuery({});
  const {
    data: configurationsData,
    refetch: refetchConfigurations,
  } = configurationsQuery;

  // Fetch strategies with useQuery
  const { data: strategies = [] } = healthCheckClient.getStrategies.useQuery(
    {},
  );

  const configurations = configurationsData?.configurations ?? [];

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      // Clear the URL param and navigate to the create flow
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
      navigate(resolveRoute(healthcheckRoutes.routes.create));
    }
  }, [searchParams, canManage, setSearchParams, navigate]);

  // Mutations
  const deleteMutation = healthCheckClient.deleteConfiguration.useMutation({
    onSuccess: () => {
      setIsDeleteModalOpen(false);
      setIdToDelete(undefined);
      void refetchConfigurations();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete"));
    },
  });

  const pauseMutation = healthCheckClient.pauseConfiguration.useMutation({
    onSuccess: () => {
      void refetchConfigurations();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to pause"));
    },
  });

  const resumeMutation = healthCheckClient.resumeConfiguration.useMutation({
    onSuccess: () => {
      void refetchConfigurations();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to resume"));
    },
  });

  const handleCreate = () => {
    navigate(resolveRoute(healthcheckRoutes.routes.create));
  };

  const handleEdit = (config: HealthCheckConfiguration) => {
    navigate(
      resolveRoute(healthcheckRoutes.routes.edit, { configId: config.id }),
    );
  };

  const handleDelete = (id: string) => {
    setIdToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (!idToDelete) return;
    deleteMutation.mutate(idToDelete);
  };

  return (
    <PageLayout
      title="Health Checks"
      subtitle="Manage health check configurations"
      icon={Activity}
      loading={accessLoading}
      allowed={canRead}
      actions={
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" asChild>
              <Link to={resolveRoute(healthcheckRoutes.routes.history)}>
                <History className="mr-2 h-4 w-4" /> View History
              </Link>
            </Button>
          )}
          <Tip
            plugin={healthcheckPluginMetadata}
            id="create"
            title="Health checks bring systems to life"
            description="Each check decides what 'healthy' means for one of your systems — an HTTP endpoint returning 200, a TCP port being open, a Postgres query succeeding, anything you can express. Failed checks flip the system's health status, notify subscribers, and burn SLO error budget. They do NOT auto-open incidents — those are reported by hand when there's a real outage."
            side="bottom"
            align="end"
          >
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" /> Create Check
            </Button>
          </Tip>
        </div>
      }
    >
      {configurationsQuery.isLoading ? (
        <HealthCheckListSkeleton />
      ) : configurationsQuery.isError ? (
        <QueryErrorState
          error={configurationsQuery.error}
          onRetry={() => void configurationsQuery.refetch()}
          resource="health checks"
        />
      ) : configurations.length === 0 ? (
        <ListEmptyState
          resource="health checks"
          description="No health checks have been configured yet. Create one to start monitoring a system."
        />
      ) : (
        <HealthCheckList
          configurations={configurations}
          strategies={strategies}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onPause={(id) => pauseMutation.mutate(id)}
          onResume={(id) => resumeMutation.mutate(id)}
          canManage={canManage}
        />
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Health Check"
        message="Are you sure you want to delete this health check configuration? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
};

export const HealthCheckConfigPage = wrapInSuspense(
  HealthCheckConfigPageContent,
);
