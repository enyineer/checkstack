import React, { useState } from "react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  type SlotContext,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  DEPENDENCY_CHANGED,
  dependencyAccess,
  type Dependency,
  type ImpactType,
} from "@checkstack/dependency-common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  LoadingSpinner,
} from "@checkstack/ui";
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Trash2,
  GitBranch,
  Settings2,
} from "lucide-react";

type Props = SlotContext<typeof SystemDetailsSlot>;

function getImpactBadge(impactType: ImpactType): React.ReactNode {
  switch (impactType) {
    case "critical": {
      return <Badge variant="destructive">Critical</Badge>;
    }
    case "degraded": {
      return <Badge variant="warning">Degraded</Badge>;
    }
    case "informational": {
      return <Badge variant="secondary">Info</Badge>;
    }
  }
}

/**
 * Inline dependency editor injected into the SystemDetailsSlot.
 * Shows upstream and downstream dependencies with management controls.
 */
export const DependencyEditor: React.FC<Props> = ({ system }) => {
  const depClient = usePluginClient(DependencyApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useAccess(
    dependencyAccess.dependency.manage,
  );

  const [isAdding, setIsAdding] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedImpactType, setSelectedImpactType] =
    useState<ImpactType>("degraded");
  const [selectedTransitive, setSelectedTransitive] = useState(false);

  // Fetch dependencies for this system
  const {
    data: depsData,
    isLoading: depsLoading,
    refetch: refetchDeps,
  } = depClient.getDependencies.useQuery(
    { systemId: system?.id ?? "", direction: "both" },
    { enabled: !!system?.id },
  );

  // Fetch all systems for the dropdown
  const { data: systemsData } = catalogClient.getSystems.useQuery(undefined, {
    enabled: isAdding,
  });

  // Listen for realtime changes
  useSignal(DEPENDENCY_CHANGED, () => {
    void refetchDeps();
  });

  const createMutation = depClient.createDependency.useMutation({
    onSuccess: () => {
      setIsAdding(false);
      setSelectedTargetId("");
      void refetchDeps();
    },
  });

  const deleteMutation = depClient.deleteDependency.useMutation({
    onSuccess: () => {
      void refetchDeps();
    },
  });

  const handleCreate = () => {
    if (!system?.id || !selectedTargetId) return;
    createMutation.mutate({
      sourceSystemId: system.id,
      targetSystemId: selectedTargetId,
      impactType: selectedImpactType,
      transitive: selectedTransitive,
    });
  };

  const handleDelete = (dep: Dependency) => {
    deleteMutation.mutate({ id: dep.id });
  };

  if (!system?.id) return;

  const dependencies = depsData?.dependencies ?? [];
  const upstreamDeps = dependencies.filter(
    (d) => d.sourceSystemId === system.id,
  );
  const downstreamDeps = dependencies.filter(
    (d) => d.targetSystemId === system.id,
  );

  // Filter out systems already linked and self
  const availableSystems =
    systemsData?.systems.filter(
      (s) =>
        s.id !== system.id &&
        !upstreamDeps.some((d) => d.targetSystemId === s.id),
    ) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg font-semibold">Dependencies</CardTitle>
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAdding(!isAdding)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {depsLoading && (
          <div className="flex justify-center p-4">
            <LoadingSpinner />
          </div>
        )}

        {/* Add dependency form */}
        {isAdding && (
          <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Depends on (upstream)</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
              >
                <option value="">Select a system...</option>
                {availableSystems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium">Impact</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedImpactType}
                  onChange={(e) =>
                    setSelectedImpactType(e.target.value as ImpactType)
                  }
                >
                  <option value="informational">Informational</option>
                  <option value="degraded">Degraded</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Propagation</label>
                <div className="flex items-center gap-2 h-[38px]">
                  <input
                    type="checkbox"
                    id="transitive"
                    checked={selectedTransitive}
                    onChange={(e) => setSelectedTransitive(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="transitive" className="text-sm">
                    Multi-hop
                  </label>
                </div>
              </div>
            </div>
            {createMutation.error && (
              <p className="text-sm text-destructive">
                {createMutation.error.message}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!selectedTargetId || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        )}

        {/* Upstream dependencies */}
        {upstreamDeps.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <ArrowUpRight className="h-4 w-4" />
              Depends On ({upstreamDeps.length})
            </h4>
            <div className="space-y-1">
              {upstreamDeps.map((dep) => (
                <DependencyRow
                  key={dep.id}
                  dependency={dep}
                  systemLabel={dep.targetSystemId}
                  direction="upstream"
                  canManage={canManage}
                  onDelete={() => handleDelete(dep)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Downstream dependencies */}
        {downstreamDeps.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <ArrowDownRight className="h-4 w-4" />
              Depended By ({downstreamDeps.length})
            </h4>
            <div className="space-y-1">
              {downstreamDeps.map((dep) => (
                <DependencyRow
                  key={dep.id}
                  dependency={dep}
                  systemLabel={dep.sourceSystemId}
                  direction="downstream"
                  canManage={canManage}
                  onDelete={() => handleDelete(dep)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!depsLoading && dependencies.length === 0 && !isAdding && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No dependencies configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

// =============================================================================
// Sub-component
// =============================================================================

function DependencyRow({
  dependency,
  systemLabel,
  direction,
  canManage,
  onDelete,
}: {
  dependency: Dependency;
  systemLabel: string;
  direction: "upstream" | "downstream";
  canManage: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded border border-border bg-background hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-2">
        {direction === "upstream" ? (
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{systemLabel}</span>
        {dependency.label && (
          <span className="text-xs text-muted-foreground">
            ({dependency.label})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {dependency.transitive && (
          <Badge variant="outline" className="text-xs">
            <Settings2 className="h-3 w-3 mr-1" />
            Multi-hop
          </Badge>
        )}
        {getImpactBadge(dependency.impactType)}
        {dependency.healthCheckRules &&
          dependency.healthCheckRules.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {dependency.healthCheckRules.length} rules
            </Badge>
          )}
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}
