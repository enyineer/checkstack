import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { SystemEditorSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  dependencyRoutes,
  type Dependency,
  type ImpactType,
} from "@checkstack/dependency-common";
import { DependencyEdgeForm } from "./DependencyEdgeForm";
import { CatalogApi } from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import {
  Badge,
  Button,
  Label,
  LoadingSpinner,
} from "@checkstack/ui";
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Trash2,
  Settings2,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  MapIcon,
  GitBranch,
} from "lucide-react";
import {
  useProvenanceLock,
  useProvenanceLocks,
} from "@checkstack/gitops-frontend";

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

  // GitOps owns the *source* system's `dependencies` extension. Edits to
  // upstream rows (this system → ...) are blocked when this system is
  // managed; downstream rows belong to other source systems and are gated
  // per-row via the bulk hook.
  const { isLocked: sourceLocked } = useProvenanceLock({
    kind: "System",
    entityId: systemId,
  });
  const { getLock: getSystemLock } = useProvenanceLocks();

  const [isAdding, setIsAdding] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedImpactType, setSelectedImpactType] =
    useState<ImpactType>("degraded");
  const [selectedTransitive, setSelectedTransitive] = useState(false);
  const [selectedHealthCheckRules, setSelectedHealthCheckRules] = useState<
    { healthCheckId: string; overrideImpactType: ImpactType }[]
  >([]);

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
      healthCheckRules:
        selectedHealthCheckRules.length > 0
          ? selectedHealthCheckRules
          : undefined,
    });
  };

  const handleDelete = (dep: Dependency) => {
    deleteMutation.mutate({ id: dep.id, systemId });
  };

  const handleUpdate = ({
    dep,
    impactType,
    transitive,
    healthCheckRules,
  }: {
    dep: Dependency;
    impactType: ImpactType;
    transitive: boolean;
    healthCheckRules?: { healthCheckId: string; overrideImpactType: ImpactType }[];
  }) => {
    updateMutation.mutate({
      id: dep.id,
      systemId,
      impactType,
      transitive,
      healthCheckRules,
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
        <Label className="flex items-center gap-2">
          Dependencies
          {sourceLocked && (
            <span
              className="inline-flex items-center gap-1 text-xs font-normal text-primary"
              title="Managed by GitOps — edit the source YAML"
            >
              <GitBranch className="h-3 w-3" />
              GitOps
            </span>
          )}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAdding(!isAdding)}
          disabled={sourceLocked}
          title={
            sourceLocked
              ? "Managed by GitOps — declare dependencies in the System's YAML"
              : undefined
          }
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
      {isAdding && !sourceLocked && (
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
          <DependencyEdgeForm
            impactType={selectedImpactType}
            onImpactTypeChange={setSelectedImpactType}
            transitive={selectedTransitive}
            onTransitiveChange={setSelectedTransitive}
            targetSystemId={selectedTargetId}
            healthCheckRules={selectedHealthCheckRules}
            onHealthCheckRulesChange={setSelectedHealthCheckRules}
          />
          {createMutation.error && (
            <CycleErrorDisplay
              error={createMutation.error}
              systemNameMap={systemNameMap}
            />
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
                isLocked={sourceLocked}
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
            {downstreamDeps.map((dep) => {
              // The "source" of a downstream edge is *another* system —
              // its lock is what governs editability.
              const otherSourceLocked = getSystemLock({
                kind: "System",
                entityId: dep.sourceSystemId,
              }).isLocked;
              return (
                <DependencyRow
                  key={dep.id}
                  dependency={dep}
                  systemName={systemNameMap.get(dep.sourceSystemId) ?? dep.sourceSystemId}
                  direction="downstream"
                  onDelete={() => handleDelete(dep)}
                  onUpdate={handleUpdate}
                  isUpdating={updateMutation.isPending}
                  isLocked={otherSourceLocked}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!depsLoading && dependencies.length === 0 && !isAdding && (
        <p className="text-sm text-muted-foreground text-center py-2">
          No dependencies configured.
        </p>
      )}

      {/* Dependency Map link */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
        <MapIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Managing dependencies is easier on a larger screen using the{" "}
          <Link
            to={resolveRoute(dependencyRoutes.routes.map)}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            Dependency Map
          </Link>
          .
        </p>
      </div>
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
  isLocked = false,
}: {
  dependency: Dependency;
  systemName: string;
  direction: "upstream" | "downstream";
  onDelete: () => void;
  onUpdate: (args: {
    dep: Dependency;
    impactType: ImpactType;
    transitive: boolean;
    healthCheckRules?: { healthCheckId: string; overrideImpactType: ImpactType }[];
  }) => void;
  isUpdating: boolean;
  /** When true, the source system of this edge is GitOps-managed. */
  isLocked?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editImpact, setEditImpact] = useState<ImpactType>(
    dependency.impactType,
  );
  const [editTransitive, setEditTransitive] = useState(dependency.transitive);
  const [editHealthCheckRules, setEditHealthCheckRules] = useState<
    { healthCheckId: string; overrideImpactType: ImpactType }[]
  >(
    dependency.healthCheckRules?.map((r) => ({
      healthCheckId: r.healthCheckId,
      overrideImpactType: r.overrideImpactType,
    })) ?? [],
  );

  const handleSave = () => {
    onUpdate({
      dep: dependency,
      impactType: editImpact,
      transitive: editTransitive,
      healthCheckRules:
        editHealthCheckRules.length > 0 ? editHealthCheckRules : [],
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditImpact(dependency.impactType);
    setEditTransitive(dependency.transitive);
    setIsEditing(false);
  };

  if (isEditing && !isLocked) {
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
        <DependencyEdgeForm
          impactType={editImpact}
          onImpactTypeChange={setEditImpact}
          transitive={editTransitive}
          onTransitiveChange={setEditTransitive}
          targetSystemId={dependency.targetSystemId}
          healthCheckRules={editHealthCheckRules}
          onHealthCheckRulesChange={setEditHealthCheckRules}
        />
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

  const interactive = !isLocked;
  return (
    <div
      className={`flex items-center justify-between p-2 rounded border border-border bg-background transition-colors ${
        interactive ? "hover:bg-muted/30 cursor-pointer" : ""
      }`}
      onClick={interactive ? () => setIsEditing(true) : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsEditing(true);
              }
            }
          : undefined
      }
      title={isLocked ? "Managed by GitOps" : undefined}
    >
      <div className="flex items-center gap-2">
        {direction === "upstream" ? (
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
        )}
        {isLocked && (
          <GitBranch className="h-3 w-3 text-primary" aria-label="Managed by GitOps" />
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
          disabled={isLocked}
          title={isLocked ? "Managed by GitOps" : undefined}
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

// =============================================================================
// Cycle Error Display
// =============================================================================

const CYCLE_CHAIN_REGEX = /circular chain: (.+)$/;
const UUID_REGEX = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi;

function CycleErrorDisplay({
  error,
  systemNameMap,
}: {
  error: Error;
  systemNameMap: Map<string, string>;
}) {
  const message = error.message;

  // Try to parse cycle chain from error message
  const chainMatch = CYCLE_CHAIN_REGEX.exec(message);
  if (!chainMatch) {
    // Not a cycle error — render as plain text
    return (
      <p className="text-sm text-destructive">{message}</p>
    );
  }

  // Extract system IDs from the chain
  const chainIds = chainMatch[1].match(UUID_REGEX) ?? [];
  if (chainIds.length === 0) {
    return (
      <p className="text-sm text-destructive">{message}</p>
    );
  }

  const chainNames = chainIds.map(
    (id) => systemNameMap.get(id) ?? id.slice(0, 8),
  );

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
        <p className="text-sm font-medium text-destructive">
          Circular dependency detected
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        This dependency would create a cycle. Systems cannot transitively
        depend on themselves.
      </p>
      <div className="flex items-center gap-1.5 flex-wrap py-1">
        {chainNames.map((name, i) => {
          const isFirst = i === 0;
          const isLast = i === chainNames.length - 1;
          // First and last are the same node (the cycle)
          const isCycleNode = isFirst || isLast;

          return (
            <React.Fragment key={`${name}-${String(i)}`}>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${
                  isCycleNode
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border bg-muted text-foreground"
                }`}
              >
                {isCycleNode && (
                  <RotateCcw className="h-3 w-3 mr-1 shrink-0" />
                )}
                {name}
              </span>
              {!isLast && (
                <span className="text-muted-foreground text-xs">→</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
