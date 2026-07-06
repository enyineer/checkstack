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
import type { ScopeCell } from "./HealthCheckRulesEditor";
import { CatalogApi } from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import {
  cn,
  Badge,
  Button,
  Label,
  LoadingSpinner,
} from "@checkstack/ui";
import { impactTypeTone, toneStyles } from "./statusPill.logic";
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

/**
 * Impact severity as a multi-encoded status pill (dot + label), driven by the
 * colorblind-safe status triad. `informational` is a neutral, non-degrading
 * signal, so it keeps the neutral secondary badge.
 */
function getImpactBadge(impactType: ImpactType): React.ReactNode {
  switch (impactType) {
    case "critical": {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-down/10 px-2.5 py-1 text-xs font-medium text-status-down">
          <span className="size-1.5 rounded-full bg-status-down" />
          Critical
        </span>
      );
    }
    case "degraded": {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-warn/10 px-2.5 py-1 text-xs font-medium text-status-warn">
          <span className="size-1.5 rounded-full bg-status-warn" />
          Degraded
        </span>
      );
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
    ScopeCell[]
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
    healthCheckRules?: ScopeCell[];
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
              title="Managed by GitOps - edit the source YAML"
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
              ? "Managed by GitOps - declare dependencies in the System's YAML"
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
        <div className="p-3 rounded-lg border border-border bg-surface-inset space-y-3">
          <div className="space-y-2">
            <Label htmlFor="dependency-target" required>
              Depends on (upstream)
            </Label>
            <select
              id="dependency-target"
              autoFocus
              className="w-full rounded-md border border-input bg-surface-inset px-3 py-2 text-sm"
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
          <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4" />
            <span>Depends On</span>{" "}
            <span className="rounded-full bg-surface-inset px-2 text-xs tabular-nums text-muted-foreground">
              ({upstreamDeps.length})
            </span>
          </h4>
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
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
          <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
            <ArrowDownRight className="h-4 w-4" />
            <span>Depended By</span>{" "}
            <span className="rounded-full bg-surface-inset px-2 text-xs tabular-nums text-muted-foreground">
              ({downstreamDeps.length})
            </span>
          </h4>
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
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
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-inset p-2.5">
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
    healthCheckRules?: ScopeCell[];
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
    ScopeCell[]
  >(
    dependency.healthCheckRules?.map((r) => ({
      healthCheckId: r.healthCheckId,
      environmentId: r.environmentId,
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
      <div className="p-3 rounded-lg border border-primary/30 bg-surface-inset space-y-3">
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
  const accentTone = toneStyles[impactTypeTone({ impactType: dependency.impactType })];
  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-2 py-2 pl-3 pr-2 transition-colors",
        interactive && "cursor-pointer hover:bg-surface-inset",
      )}
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
      {/* Impact accent stripe: impact severity by position + hue at the row edge. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-0.5", accentTone.accent)}
        aria-hidden
      />
      <div className="flex items-center gap-2 min-w-0">
        {direction === "upstream" ? (
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ArrowDownRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {isLocked && (
          <GitBranch className="h-3 w-3 shrink-0 text-primary" aria-label="Managed by GitOps" />
        )}
        <span className="truncate text-sm font-medium">{systemName}</span>
        {dependency.label && (
          <span className="truncate text-xs text-muted-foreground">
            ({dependency.label})
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
              {dependency.healthCheckRules.length} scope
              {dependency.healthCheckRules.length === 1 ? "" : "s"}
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
      <p className="text-sm text-status-down">{message}</p>
    );
  }

  // Extract system IDs from the chain
  const chainIds = chainMatch[1].match(UUID_REGEX) ?? [];
  if (chainIds.length === 0) {
    return (
      <p className="text-sm text-status-down">{message}</p>
    );
  }

  const chainNames = chainIds.map(
    (id) => systemNameMap.get(id) ?? id.slice(0, 8),
  );

  return (
    <div className="rounded-lg border border-status-down/30 bg-status-down/5 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-status-down shrink-0" />
        <p className="text-sm font-medium text-status-down">
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
                    ? "border-status-down/40 bg-status-down/10 text-status-down"
                    : "border-border bg-surface-inset text-foreground"
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
