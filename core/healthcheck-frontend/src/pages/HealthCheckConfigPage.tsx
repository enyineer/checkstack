import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  wrapInSuspense,
  accessApiRef,
  useApi,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  healthcheckRoutes,
  healthCheckAccess,
} from "@checkstack/healthcheck-common";
import { HealthCheckList } from "../components/HealthCheckList";
import { HealthCheckEditor } from "../components/HealthCheckEditor";
import {
  Button,
  ConfirmationModal,
  PageLayout,
  useToast,
} from "@checkstack/ui";
import { Plus, History } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";

const HealthCheckConfigPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.configuration.read
  );
  const { allowed: canManage } = accessApi.useAccess(
    healthCheckAccess.configuration.manage
  );

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<
    HealthCheckConfiguration | undefined
  >();

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<string | undefined>();

  // Fetch configurations with useQuery
  const { data: configurationsData, refetch: refetchConfigurations } =
    healthCheckClient.getConfigurations.useQuery({});

  // Fetch strategies with useQuery
  const { data: strategies = [] } = healthCheckClient.getStrategies.useQuery(
    {}
  );

  const configurations = configurationsData?.configurations ?? [];

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setEditingConfig(undefined);
      setIsEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  // Mutations
  const createMutation = healthCheckClient.createConfiguration.useMutation({
    onSuccess: () => {
      setIsEditorOpen(false);
      void refetchConfigurations();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create");
    },
  });

  const updateMutation = healthCheckClient.updateConfiguration.useMutation({
    onSuccess: () => {
      setIsEditorOpen(false);
      void refetchConfigurations();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update");
    },
  });

  const deleteMutation = healthCheckClient.deleteConfiguration.useMutation({
    onSuccess: () => {
      setIsDeleteModalOpen(false);
      setIdToDelete(undefined);
      void refetchConfigurations();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });

  const handleCreate = () => {
    setEditingConfig(undefined);
    setIsEditorOpen(true);
  };

  const handleEdit = (config: HealthCheckConfiguration) => {
    setEditingConfig(config);
    setIsEditorOpen(true);
  };

  const handleDelete = (id: string) => {
    setIdToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (!idToDelete) return;
    deleteMutation.mutate(idToDelete);
  };

  const handleSave = async (data: CreateHealthCheckConfiguration) => {
    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, body: data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingConfig(undefined);
  };

  return (
    <PageLayout
      title="Health Checks"
      subtitle="Manage health check configurations"
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
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" /> Create Check
          </Button>
        </div>
      }
    >
      <HealthCheckList
        configurations={configurations}
        strategies={strategies}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <HealthCheckEditor
        open={isEditorOpen}
        strategies={strategies}
        initialData={editingConfig}
        onSave={handleSave}
        onCancel={handleEditorClose}
      />

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
  HealthCheckConfigPageContent
);
