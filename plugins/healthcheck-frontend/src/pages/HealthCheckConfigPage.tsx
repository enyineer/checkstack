import React, { useEffect, useState } from "react";
import {
  useApi,
  wrapInSuspense,
  permissionApiRef,
} from "@checkmate/frontend-api";
import { healthCheckApiRef } from "../api";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  CreateHealthCheckConfiguration,
  permissions,
} from "@checkmate/healthcheck-common";
import { HealthCheckList } from "../components/HealthCheckList";
import { HealthCheckEditor } from "../components/HealthCheckEditor";
import {
  Button,
  Page,
  PageHeader,
  PageContent,
  PermissionDenied,
} from "@checkmate/ui";
import { Plus } from "lucide-react";

const HealthCheckConfigPageContent = () => {
  const api = useApi(healthCheckApiRef);
  const permissionApi = useApi(permissionApiRef);
  const canRead = permissionApi.usePermission(permissions.healthCheckRead.id);

  const [configurations, setConfigurations] = useState<
    HealthCheckConfiguration[]
  >([]);
  const [strategies, setStrategies] = useState<HealthCheckStrategyDto[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingConfig, setEditingConfig] = useState<
    HealthCheckConfiguration | undefined
  >();

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

  const handleCreate = () => {
    setEditingConfig(undefined);
    setIsEditing(true);
  };

  const handleEdit = (config: HealthCheckConfiguration) => {
    setEditingConfig(config);
    setIsEditing(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this health check?")) {
      await api.deleteConfiguration(id);
      await fetchData();
    }
  };

  const handleSave = async (data: CreateHealthCheckConfiguration) => {
    await (editingConfig
      ? api.updateConfiguration(editingConfig.id, data)
      : api.createConfiguration(data));
    setIsEditing(false);
    await fetchData();
  };

  if (!canRead) {
    return <PermissionDenied />;
  }

  return (
    <Page>
      <PageHeader
        title="Health Checks"
        subtitle="Manage health check configurations"
        actions={
          !isEditing && (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" /> Create Check
            </Button>
          )
        }
      />
      <PageContent>
        {isEditing ? (
          <HealthCheckEditor
            strategies={strategies}
            initialData={editingConfig}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <HealthCheckList
            configurations={configurations}
            strategies={strategies}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </PageContent>
    </Page>
  );
};

export const HealthCheckConfigPage = wrapInSuspense(
  HealthCheckConfigPageContent
);
