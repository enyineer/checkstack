import React, { useEffect, useState } from "react";
import {
  Label,
  Checkbox,
  useToast,
  toastError,
} from "@checkstack/ui";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { CatalogApi, catalogAccess } from "@checkstack/catalog-common";
import { toggleSelectedId } from "./environment-fields.logic";

interface Props {
  systemId: string;
}

/**
 * Per-system environment multi-select picker. Lists every instance-wide
 * environment with a checkbox; toggling drives the desired-set
 * `setSystemEnvironments` mutation (add/prune diffed server-side).
 */
export const SystemEnvironmentsEditor: React.FC<Props> = ({ systemId }) => {
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage } = accessApi.useAccess(
    catalogAccess.environment.manage,
  );

  const { data: environments = [], isLoading: environmentsLoading } =
    catalogClient.listEnvironments.useQuery({});

  const {
    data: assigned = [],
    isLoading: assignedLoading,
    refetch: refetchAssigned,
  } = catalogClient.getSystemEnvironments.useQuery({ systemId });

  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected(assigned.map((environment) => environment.id));
  }, [assigned]);

  const setMutation = catalogClient.setSystemEnvironments.useMutation({
    onSuccess: () => {
      void refetchAssigned();
    },
    onError: (error) => {
      toastError(toast, "Failed to update environments", error);
      // Re-sync from the server on failure.
      setSelected(assigned.map((environment) => environment.id));
    },
  });

  const handleToggle = (environmentId: string) => {
    const next = toggleSelectedId({ selected, id: environmentId });
    setSelected(next);
    setMutation.mutate({ systemId, environmentIds: next });
  };

  const loading = environmentsLoading || assignedLoading;

  return (
    <div className="space-y-2">
      <Label>Environments</Label>
      <p className="text-xs text-muted-foreground">
        Instance-wide environments this system belongs to.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground py-2">Loading...</p>
      ) : environments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No environments defined yet.
        </p>
      ) : (
        <div className="space-y-2">
          {environments.map((environment) => (
            <div key={environment.id} className="flex items-center gap-2">
              <Checkbox
                checked={selected.includes(environment.id)}
                disabled={!canManage || setMutation.isPending}
                onCheckedChange={() => handleToggle(environment.id)}
              />
              <span className="text-sm">{environment.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
