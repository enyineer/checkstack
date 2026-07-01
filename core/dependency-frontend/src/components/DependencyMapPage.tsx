import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type Connection,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  usePluginClient,
  wrapInSuspense,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import {
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  DependencyApi,
  type Dependency,
  type NodePosition,
} from "@checkstack/dependency-common";
import {
  Button,
  Badge,
  LoadingSpinner,
  PageLayout,
  useToast,
  usePerformance,
  cn,
  toastError,
} from "@checkstack/ui";
import { Maximize2, Save, RefreshCw, Trash2, GitBranch } from "lucide-react";
import type { ImpactType } from "@checkstack/dependency-common";
import { DependencyEdgeForm } from "./DependencyEdgeForm";
import { useProvenanceLocks } from "@checkstack/gitops-frontend";

import {
  SystemNodeComponent,
  type SystemNode,
  type SystemNodeData,
} from "./canvas/SystemNode";
import {
  DependencyEdgeComponent,
  type DependencyEdge,
  type DependencyEdgeData,
} from "./canvas/DependencyEdge";
import { extractErrorMessage } from "@checkstack/common";
import { autoLayout } from "./dependencyDisplay.logic";

const nodeTypes = { system: SystemNodeComponent };
const edgeTypes = { dependency: DependencyEdgeComponent };

function DependencyMapContent() {
  const { isLowPower } = usePerformance();
  const depClient = usePluginClient(DependencyApi);
  const catalogClient = usePluginClient(CatalogApi);
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const { fitView } = useReactFlow();
  // GitOps owns the *source* system's `dependencies` extension. We use the
  // bulk hook to gate edge mutations per edge based on the source's lock.
  const { getLock: getSystemLock } = useProvenanceLocks();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DependencyEdge>([]);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Edge editor state
  const [selectedEdge, setSelectedEdge] = useState<
    | {
        id: string;
        sourceSystemId: string;
        targetSystemId: string;
        impactType: ImpactType;
        transitive: boolean;
        healthCheckRules: { healthCheckId: string; overrideImpactType: ImpactType }[];
      }
    | undefined
  >();

  // Fetch systems
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Fetch all dependencies
  const {
    data: depsData,
    isLoading: depsLoading,
    refetch: refetchDeps,
  } = depClient.getAllDependencies.useQuery();

  // Fetch saved positions
  const {
    data: posData,
    isLoading: posLoading,
    refetch: refetchPositions,
  } = depClient.getNodePositions.useQuery();

  // Fetch warnings for all systems
  const systemIds = useMemo(
    () => systemsData?.systems.map((s) => s.id) ?? [],
    [systemsData],
  );

  const { data: warningsData, refetch: refetchWarnings } =
    depClient.getWarnings.useQuery(
      { systemIds },
      { enabled: systemIds.length > 0 },
    );

  // A dependency edge can only ORIGINATE from a system the user may MANAGE:
  // `createDependency` requires MANAGE on the SOURCE (the target is not
  // access-checked). Gate the drag-to-connect source handle and the create
  // mutation on this, so users don't attempt a guaranteed-to-fail request.
  const accessApi = useApi(accessApiRef);
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systemIds,
  });

  // Fetch real health statuses for all systems — kept fresh via SignalAutoInvalidator
  // (foreignSignals declares SYSTEM_STATUS_CHANGED on the dependency plugin).
  const { data: healthData } = healthCheckClient.getBulkSystemHealthStatus.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0 },
  );

  // Save positions mutation
  const saveMutation = depClient.saveNodePositions.useMutation({
    onSuccess: () => {
      setHasUnsaved(false);
    },
  });

  // System name lookup
  const systemNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of systemsData?.systems ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  }, [systemsData]);

  // UUID regex for parsing cycle errors
  const UUID_REGEX =
    /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi;

  // Create dependency mutation (for drag-to-connect)
  const toast = useToast();
  const createMutation = depClient.createDependency.useMutation({
    onSuccess: () => {
      toast.success("Dependency created");
      void refetchDeps();
      void refetchWarnings();
    },
    onError: (error) => {
      const message =
        extractErrorMessage(error, "Failed to create dependency");

      // Check for cycle error and resolve names
      if (message.includes("circular chain")) {
        const ids = message.match(UUID_REGEX) ?? [];
        const names = ids.map((id) => systemNameMap.get(id) ?? id.slice(0, 8));
        toast.error(`Circular dependency: ${names.join(" → ")}`);
      } else {
        toast.error(message);
      }
    },
  });

  // Update dependency mutation (for edge editor)
  const updateMutation = depClient.updateDependency.useMutation({
    onSuccess: () => {
      toast.success("Dependency updated");
      setSelectedEdge(undefined);
      void refetchDeps();
      void refetchWarnings();
    },
    onError: (error) => {
      toastError(toast, "Failed to update", error);
    },
  });

  // Delete dependency mutation (for edge editor)
  const deleteMutation = depClient.deleteDependency.useMutation({
    onSuccess: () => {
      toast.success("Dependency deleted");
      setSelectedEdge(undefined);
      void refetchDeps();
      void refetchWarnings();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete", error);
    },
  });

  // Handle edge connection (drag from source handle to target handle)
  const { mutate: createDependency } = createMutation;
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      // Creating a dependency requires MANAGE on the SOURCE system. Bail out
      // before firing a request the backend is guaranteed to reject.
      if (!canManageSystem(connection.source)) {
        toast.error(
          "You can only add dependencies from systems you manage.",
        );
        return;
      }

      const sourceLocked = getSystemLock({
        kind: "System",
        entityId: connection.source,
      }).isLocked;
      if (sourceLocked) {
        toast.error(
          "Source system is managed by GitOps - declare the dependency in its YAML.",
        );
        return;
      }

      createDependency({
        sourceSystemId: connection.source,
        targetSystemId: connection.target,
        impactType: "degraded",
        transitive: false,
      });
    },
    [createDependency, getSystemLock, canManageSystem, toast],
  );

  // Track node positions for saving and for preserving in-memory positions
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Build nodes from systems, positions, warnings, and health data.
  // Position resolution priority:
  //   1. Current in-memory position (user may have dragged but not saved yet)
  //   2. Saved position from the backend
  //   3. Auto-layout fallback for brand-new systems with no position at all

  useEffect(() => {
    if (!systemsData?.systems || !posData) return;

    const savedPositions = posData?.positions ?? [];
    const warnings = warningsData?.warnings ?? {};
    const healthStatuses = healthData?.statuses ?? {};
    const deps = depsData?.dependencies ?? [];

    // Compute per-system dependency counts
    const upstreamCountMap = new Map<string, number>();
    const downstreamCountMap = new Map<string, number>();
    for (const dep of deps) {
      upstreamCountMap.set(
        dep.sourceSystemId,
        (upstreamCountMap.get(dep.sourceSystemId) ?? 0) + 1,
      );
      downstreamCountMap.set(
        dep.targetSystemId,
        (downstreamCountMap.get(dep.targetSystemId) ?? 0) + 1,
      );
    }

    // Lookup maps for position resolution
    const savedPositionMap = new Map(
      savedPositions.map((p) => [p.systemId, { x: p.x, y: p.y }]),
    );
    const currentPositionMap = new Map<string, { x: number; y: number }>();
    for (const node of nodesRef.current) {
      currentPositionMap.set(node.id, node.position);
    }

    // Auto-layout only for systems that have no saved and no in-memory position
    const unpositioned = systemsData.systems
      .map((s) => s.id)
      .filter((id) => !savedPositionMap.has(id) && !currentPositionMap.has(id));
    const fallbackPositions = autoLayout({
      systemIds: unpositioned,
      savedPositions: [],
    });

    const newNodes: SystemNode[] = systemsData.systems.map((system) => {
      const pos =
        currentPositionMap.get(system.id) ??
        savedPositionMap.get(system.id) ??
        fallbackPositions.get(system.id) ?? { x: 0, y: 0 };

      const warning = warnings[system.id];

      // Map real health status to node status
      const healthStatus = healthStatuses[system.id];
      let selfStatus: "operational" | "degraded" | "down" = "operational";
      if (healthStatus) {
        if (healthStatus.status === "unhealthy") {
          selfStatus = "down";
        } else if (healthStatus.status === "degraded") {
          selfStatus = "degraded";
        }
      }

      const nodeData: SystemNodeData = {
        label: system.name,
        systemId: system.id,
        status: selfStatus,
        derivedState: warning?.derivedState,
        upstreamCount: upstreamCountMap.get(system.id) ?? 0,
        downstreamCount: downstreamCountMap.get(system.id) ?? 0,
        // Only systems the user manages may ORIGINATE a dependency edge, so
        // only they expose an enabled outgoing (source) connection handle.
        canManage: canManageSystem(system.id),
      };

      return {
        id: system.id,
        type: "system" as const,
        position: pos,
        data: nodeData,
      };
    });

    setNodes(newNodes);
  }, [
    systemsData,
    posData,
    warningsData,
    healthData,
    depsData,
    canManageSystem,
    setNodes,
  ]);

  // Build edges separately — only depends on dependency data
  useEffect(() => {
    if (!depsData?.dependencies) return;

    const newEdges: DependencyEdge[] = depsData.dependencies.map(
      (dep: Dependency) => {
        const edgeData: DependencyEdgeData = {
          impactType: dep.impactType,
          transitive: dep.transitive,
          label: dep.label,
        };

        return {
          id: dep.id,
          source: dep.sourceSystemId,
          target: dep.targetSystemId,
          type: "dependency" as const,
          animated: dep.transitive,
          data: edgeData,
        };
      },
    );

    setEdges(newEdges);
  }, [depsData, setEdges]);

  // Track node position changes for saving

  const handleNodesChange = useCallback(
    (changes: NodeChange<SystemNode>[]) => {
      onNodesChange(changes);

      // Check if any position changes happened
      const hasPositionChange = changes.some(
        (c) => c.type === "position" && c.dragging === false,
      );

      if (hasPositionChange) {
        setHasUnsaved(true);

        // Auto-save after 2 seconds of inactivity
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          handleSave();
        }, 2000);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave reads from nodesRef (always current); including it would cause infinite re-render loops via setHasUnsaved
    [onNodesChange],
  );

  // Save positions — reads from nodesRef to avoid stale closure
  const { mutate: savePositions } = saveMutation;
  const handleSave = useCallback(() => {
    const positions: NodePosition[] = nodesRef.current.map((n) => ({
      systemId: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    }));

    savePositions({ positions });
  }, [savePositions]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const loading = systemsLoading || depsLoading || posLoading;

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 rounded-[var(--d-card-r)] border border-border overflow-hidden bg-surface-inset">
      <ReactFlow<SystemNode, DependencyEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={(_event, edge) => {
          const dep = depsData?.dependencies.find((d) => d.id === edge.id);
          if (dep) {
            setSelectedEdge({
              id: dep.id,
              sourceSystemId: dep.sourceSystemId,
              targetSystemId: dep.targetSystemId,
              impactType: dep.impactType,
              transitive: dep.transitive,
              healthCheckRules:
                dep.healthCheckRules?.map((r) => ({
                  healthCheckId: r.healthCheckId,
                  overrideImpactType: r.overrideImpactType,
                })) ?? [],
            });
          }
        }}
        onPaneClick={() => setSelectedEdge(undefined)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "dependency",
        }}
      >
        <Background gap={20} size={1} className="!bg-background" />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
        />
        <MiniMap
          className="!bg-card !border-border !shadow-lg"
          nodeColor={(n) => {
            const data = n.data as SystemNodeData;
            const status = data.derivedState ?? data.status ?? "operational";
            if (status === "down") return "hsl(var(--status-down))";
            if (status === "degraded") return "hsl(var(--status-warn))";
            return "hsl(var(--status-ok))";
          }}
          maskColor="rgba(0, 0, 0, 0.2)"
        />

        {/* Top-right panel with actions */}
        <Panel position="top-right" className="flex flex-wrap justify-end gap-2 max-w-[calc(100vw-2rem)]">
          {hasUnsaved && (
            <Badge
              variant="warning"
              className={cn(!isLowPower && "animate-pulse")}
            >
              Unsaved
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending || !hasUnsaved}
            className={cn(isLowPower ? "bg-card" : "bg-card/90 backdrop-blur-sm")}
          >
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? "Saving..." : "Save Layout"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetchDeps();
              void refetchWarnings();
              void refetchPositions();
            }}
            className={cn(isLowPower ? "bg-card" : "bg-card/90 backdrop-blur-sm")}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fitView({ padding: 0.3 })}
            className={cn(isLowPower ? "bg-card" : "bg-card/90 backdrop-blur-sm")}
          >
            <Maximize2 className="h-4 w-4 mr-1" />
            Fit
          </Button>
        </Panel>

        {/* Bottom-left legend */}
        <Panel position="bottom-left">
          <div
            className={cn(
              "border border-border rounded-lg p-3 shadow-lg max-w-[calc(100vw-2rem)] sm:max-w-64",
              isLowPower ? "bg-card" : "bg-card/90 backdrop-blur-sm",
            )}
          >
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
              Legend
            </p>

            {/* Direction legend */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-teal-400/60 border-2 border-background shrink-0" />
                <span className="text-xs text-muted-foreground">
                  Used by (incoming)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-violet-400/60 border-2 border-background shrink-0" />
                <span className="text-xs text-muted-foreground">
                  Depends on (outgoing)
                </span>
              </div>
            </div>

            {/* Impact legend */}
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
              Impact
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-sky-400/60 rounded" />
                <span className="text-xs text-muted-foreground">
                  Informational
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-amber-400/70 rounded" />
                <span className="text-xs text-muted-foreground">Degraded</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-red-400/80 rounded" />
                <span className="text-xs text-muted-foreground">Critical</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-[1px] border-t border-dashed border-muted-foreground/50" />
                <span className="text-xs text-muted-foreground">Multi-hop</span>
              </div>
            </div>
            <details className="mt-2.5 group">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                How multi-hop works
              </summary>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground leading-relaxed">
                <p>
                  A <strong className="text-foreground">multi-hop</strong> edge
                  looks through its target's own dependencies. A{" "}
                  <strong className="text-foreground">single-hop</strong> edge
                  only reacts to its direct target's status.
                </p>
                <div className="space-y-1 font-mono text-[11px]">
                  <p className="text-destructive">
                    A ⟶<sup>multi</sup> B ⟶ C<sub>down</sub> → A warned
                  </p>
                  <p className="text-emerald-400">
                    A ⟶<sup>single</sup> B ⟶ C<sub>down</sub> → A safe
                  </p>
                </div>
                <p>
                  B is operational in both cases. Multi-hop sees through B to
                  C's failure; single-hop only sees B directly.
                </p>
              </div>
            </details>
          </div>
        </Panel>

        {/* Edge editor panel */}
        {selectedEdge && (() => {
          const edgeSourceLocked = getSystemLock({
            kind: "System",
            entityId: selectedEdge.sourceSystemId,
          }).isLocked;
          return (
          <Panel position="top-left">
            <div
              className={cn(
                "border border-border rounded-lg shadow-lg p-4 w-[calc(100vw-2rem)] sm:w-72 space-y-3",
                isLowPower ? "bg-card" : "bg-card/95 backdrop-blur-sm",
              )}
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {edgeSourceLocked ? "Dependency (GitOps)" : "Edit Dependency"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {systemNameMap.get(selectedEdge.sourceSystemId) ??
                    selectedEdge.sourceSystemId}
                  {" → "}
                  {systemNameMap.get(selectedEdge.targetSystemId) ??
                    selectedEdge.targetSystemId}
                </p>
                {edgeSourceLocked && (
                  <p className="text-xs text-warning">
                    The source system is managed by GitOps. Edit the
                    dependency in its YAML.
                  </p>
                )}
              </div>
              <DependencyEdgeForm
                impactType={selectedEdge.impactType}
                onImpactTypeChange={(impactType) =>
                  setSelectedEdge({ ...selectedEdge, impactType })
                }
                transitive={selectedEdge.transitive}
                onTransitiveChange={(transitive) =>
                  setSelectedEdge({ ...selectedEdge, transitive })
                }
                targetSystemId={selectedEdge.targetSystemId}
                healthCheckRules={selectedEdge.healthCheckRules}
                onHealthCheckRulesChange={(rules) =>
                  setSelectedEdge({ ...selectedEdge, healthCheckRules: rules })
                }
                compact
              />
              <div className="flex gap-2 justify-between">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    deleteMutation.mutate({
                      id: selectedEdge.id,
                      systemId: selectedEdge.sourceSystemId,
                    })
                  }
                  disabled={deleteMutation.isPending || edgeSourceLocked}
                  title={edgeSourceLocked ? "Managed by GitOps" : undefined}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedEdge(undefined)}
                  >
                    {edgeSourceLocked ? "Close" : "Cancel"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      updateMutation.mutate({
                        id: selectedEdge.id,
                        systemId: selectedEdge.sourceSystemId,
                        impactType: selectedEdge.impactType,
                        transitive: selectedEdge.transitive,
                        healthCheckRules:
                          selectedEdge.healthCheckRules.length > 0
                            ? selectedEdge.healthCheckRules
                            : [],
                      })
                    }
                    disabled={updateMutation.isPending || edgeSourceLocked}
                    title={edgeSourceLocked ? "Managed by GitOps" : undefined}
                  >
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
          );
        })()}
      </ReactFlow>
    </div>
  );
}

/**
 * Dependency Map page — standard PageLayout header (matching the GitBranch nav
 * icon), full-height so the canvas fills the viewport. Wrapped in
 * ReactFlowProvider and Suspense.
 */
const DependencyMapPageContent = () => {
  return (
    <PageLayout
      title="Dependency Map"
      subtitle="Interactive topology view of system dependencies. Drag nodes to rearrange; positions auto-save."
      icon={GitBranch}
      fillHeight
    >
      <ReactFlowProvider>
        <DependencyMapContent />
      </ReactFlowProvider>
    </PageLayout>
  );
};

export const DependencyMapPage = wrapInSuspense(DependencyMapPageContent);
