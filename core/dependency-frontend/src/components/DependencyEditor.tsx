import React, { useMemo, useState } from "react";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemEditorSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  DEPENDENCY_CHANGED,
  type Dependency,
  type ImpactType,
} from "@checkstack/dependency-common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  Badge,
  Button,
  Label,
  LoadingSpinner,
  Toggle,
} from "@checkstack/ui";
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Trash2,
  Settings2,
  Check,
  X,
} from "lucide-react";

type Props = SlotContext<typeof SystemEditorSlot>;

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
 * Dependency editor section injected into the SystemEditorSlot.
 * Renders inside the system editor dialog for managing upstream/downstream
 * dependencies. Access is already enforced by the editor dialog itself.
 */
export const DependencyEditor: React.FC<Props> = ({ systemId }) => {
  const depClient = usePluginClient(DependencyApi);
  const catalogClient = usePluginClient(CatalogApi);

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
    { systemId, direction: "both" },
    { enabled: !!systemId },
  );

  // Fetch all systems — needed for name resolution in rows and the dropdown
  const { data: systemsData } = catalogClient.getSystems.useQuery({});

  // Build name lookup map
  const systemNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of systemsData?.systems ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  }, [systemsData]);

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

  const updateMutation = depClient.updateDependency.useMutation({
    onSuccess: () => {
      void refetchDeps();
    },
  });

  const handleCreate = () => {
    if (!systemId || !selectedTargetId) return;
    createMutation.mutate({
      sourceSystemId: systemId,
      targetSystemId: selectedTargetId,
      impactType: selectedImpactType,
      transitive: selectedTransitive,
    });
  };

  const handleDelete = (dep: Dependency) => {
    deleteMutation.mutate({ id: dep.id, systemId });
  };

  const handleUpdate = ({
    dep,
    impactType,
    transitive,
  }: {
    dep: Dependency;
    impactType: ImpactType;
    transitive: boolean;
  }) => {
    updateMutation.mutate({
      id: dep.id,
      systemId,
      impactType,
      transitive,
    });
  };

  if (!systemId) return;

  const dependencies = depsData?.dependencies ?? [];
  const upstreamDeps = dependencies.filter(
    (d) => d.sourceSystemId === systemId,
  );
  const downstreamDeps = dependencies.filter(
    (d) => d.targetSystemId === systemId,
  );

  // Filter out systems already linked and self
  const availableSystems =
    systemsData?.systems.filter(
      (s) =>
        s.id !== systemId &&
        !upstreamDeps.some((d) => d.targetSystemId === s.id),
    ) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Dependencies</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAdding(!isAdding)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {depsLoading && (
        <div className="flex justify-center p-3">
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
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <label className="text-sm font-medium">Multi-hop propagation</label>
              <p className="text-xs text-muted-foreground">
                Propagate status warnings through transitive dependency chains.
                When enabled, failures cascade beyond the direct upstream.
              </p>
            </div>
            <Toggle
              checked={selectedTransitive}
              onCheckedChange={setSelectedTransitive}
              aria-label="Enable multi-hop propagation"
            />
          </div>
          {createMutation.error && (
            <p className="text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAdding(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
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
                systemName={systemNameMap.get(dep.targetSystemId) ?? dep.targetSystemId}
                direction="upstream"
                onDelete={() => handleDelete(dep)}
                onUpdate={handleUpdate}
                isUpdating={updateMutation.isPending}
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
                systemName={systemNameMap.get(dep.sourceSystemId) ?? dep.sourceSystemId}
                direction="downstream"
                onDelete={() => handleDelete(dep)}
                onUpdate={handleUpdate}
                isUpdating={updateMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!depsLoading && dependencies.length === 0 && !isAdding && (
        <p className="text-sm text-muted-foreground text-center py-2">
          No dependencies configured.
        </p>
      )}
    </div>
  );
};

// =============================================================================
// Sub-component
// =============================================================================

function DependencyRow({
  dependency,
  systemName,
  direction,
  onDelete,
  onUpdate,
  isUpdating,
}: {
  dependency: Dependency;
  systemName: string;
  direction: "upstream" | "downstream";
  onDelete: () => void;
  onUpdate: (args: {
    dep: Dependency;
    impactType: ImpactType;
    transitive: boolean;
  }) => void;
  isUpdating: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editImpact, setEditImpact] = useState<ImpactType>(
    dependency.impactType,
  );
  const [editTransitive, setEditTransitive] = useState(dependency.transitive);

  const handleSave = () => {
    onUpdate({ dep: dependency, impactType: editImpact, transitive: editTransitive });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditImpact(dependency.impactType);
    setEditTransitive(dependency.transitive);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="p-3 rounded-lg border border-primary/30 bg-muted/30 space-y-3">
        <div className="flex items-center gap-2">
          {direction === "upstream" ? (
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{systemName}</span>
          {dependency.label && (
            <span className="text-xs text-muted-foreground">
              ({dependency.label})
            </span>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Impact</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={editImpact}
            onChange={(e) => setEditImpact(e.target.value as ImpactType)}
          >
            <option value="informational">Informational</option>
            <option value="degraded">Degraded</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="space-y-0.5">
            <label className="text-sm font-medium">Multi-hop propagation</label>
            <p className="text-xs text-muted-foreground">
              Propagate status warnings through transitive dependency chains.
            </p>
          </div>
          <Toggle
            checked={editTransitive}
            onCheckedChange={setEditTransitive}
            aria-label="Enable multi-hop propagation"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isUpdating}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            {isUpdating ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between p-2 rounded border border-border bg-background hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => setIsEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsEditing(true);
        }
      }}
    >
      <div className="flex items-center gap-2">
        {direction === "upstream" ? (
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{systemName}</span>
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    </div>
  );
}
