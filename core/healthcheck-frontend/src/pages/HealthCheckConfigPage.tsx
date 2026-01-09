import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useApi,
  wrapInSuspense,
  permissionApiRef,
} from "@checkmate-monitor/frontend-api";
import { healthCheckApiRef } from "../api";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  CreateHealthCheckConfiguration,
  healthcheckRoutes,
} from "@checkmate-monitor/healthcheck-common";
import { HealthCheckList } from "../components/HealthCheckList";
import { HealthCheckEditor } from "../components/HealthCheckEditor";
import { Button, ConfirmationModal, PageLayout } from "@checkmate-monitor/ui";
import { Plus, History } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute } from "@checkmate-monitor/common";

const HealthCheckConfigPageContent = () => {
  const api = useApi(healthCheckApiRef);
  const permissionApi = useApi(permissionApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canRead, loading: permissionLoading } =
    permissionApi.useResourcePermission("healthcheck", "read");
  const { allowed: canManage } = permissionApi.useResourcePermission(
    "healthcheck",
    "manage"
  );

  const [configurations, setConfigurations] = useState<
    HealthCheckConfiguration[]
  >([]);
  const [strategies, setStrategies] = useState<HealthCheckStrategyDto[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<
    HealthCheckConfiguration | undefined
  >();

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<string | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = async () => {
    const [configs, strats] = await Promise.all([
      api.getConfigurations(),
      api.getStrategies(),
    ]);
    setConfigurations(configs);
    setStrategies(strats);
  };

  useEffect(() => {
    fetchData();
  }, [api]);

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

  const confirmDelete = async () => {
    if (!idToDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteConfiguration(idToDelete);
      await fetchData();
    } finally {
      setIsDeleting(false);
      setIsDeleteModalOpen(false);
      setIdToDelete(undefined);
    }
  };

  const handleSave = async (data: CreateHealthCheckConfiguration) => {
    await (editingConfig
      ? api.updateConfiguration({ id: editingConfig.id, body: data })
      : api.createConfiguration(data));
    setIsEditorOpen(false);
    await fetchData();
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingConfig(undefined);
  };

  return (
    <PageLayout
      title="Health Checks"
      subtitle="Manage health check configurations"
      loading={permissionLoading}
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
        isLoading={isDeleting}
      />
    </PageLayout>
  );
};

export const HealthCheckConfigPage = wrapInSuspense(
  HealthCheckConfigPageContent
);
