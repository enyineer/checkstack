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
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi, SYSTEM_STATUS_CHANGED } from "@checkstack/healthcheck-common";
import {
  DependencyApi,
  DEPENDENCY_CHANGED,
  DEPENDENCY_WARNINGS_CHANGED,
  type Dependency,
  type NodePosition,
} from "@checkstack/dependency-common";
import {
  Button,
  Badge,
  LoadingSpinner,
  useToast,
} from "@checkstack/ui";
import { Maximize2, Save, RefreshCw, Trash2 } from "lucide-react";
import type { ImpactType } from "@checkstack/dependency-common";
import { DependencyEdgeForm } from "./DependencyEdgeForm";

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

const nodeTypes = { system: SystemNodeComponent };
const edgeTypes = { dependency: DependencyEdgeComponent };

/**
 * Auto-layout for nodes without saved positions.
 * Places nodes in a grid pattern with reasonable spacing.
 */
function autoLayout(
  systemIds: string[],
  savedPositions: NodePosition[],
): Map<string, { x: number; y: number }> {
  const posMap = new Map<string, { x: number; y: number }>();
  const savedMap = new Map(savedPositions.map((p) => [p.systemId, p]));

  const unpositioned = systemIds.filter((id) => !savedMap.has(id));
  const cols = Math.ceil(Math.sqrt(unpositioned.length));
  const spacingX = 250;
  const spacingY = 120;

  // Apply saved positions
  for (const pos of savedPositions) {
    posMap.set(pos.systemId, { x: pos.x, y: pos.y });
  }

  // Auto-position remaining systems
  for (const [index, id] of unpositioned.entries()) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    posMap.set(id, {
      x: col * spacingX + 100,
      y: row * spacingY + 100,
    });
  }

  return posMap;
}

function DependencyMapContent() {
  const depClient = usePluginClient(DependencyApi);
  const catalogClient = usePluginClient(CatalogApi);
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DependencyEdge>([]);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

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
  const { data: posData, refetch: refetchPositions } =
    depClient.getNodePositions.useQuery();

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

  // Fetch real health statuses for all systems
  const { data: healthData, refetch: refetchHealth } =
    healthCheckClient.getBulkSystemHealthStatus.useQuery(
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
        error instanceof Error ? error.message : "Failed to create dependency";

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
      toast.error(error instanceof Error ? error.message : "Failed to update");
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
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });

  // Handle edge connection (drag from source handle to target handle)
  const { mutate: createDependency } = createMutation;
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      createDependency({
        sourceSystemId: connection.source,
        targetSystemId: connection.target,
        impactType: "degraded",
        transitive: false,
      });
    },
    [createDependency],
  );

  // Build graph from data
  useEffect(() => {
    if (!systemsData?.systems || !depsData?.dependencies) return;

    const savedPositions = posData?.positions ?? [];
    const positions = autoLayout(
      systemsData.systems.map((s) => s.id),
      savedPositions,
    );

    const warnings = warningsData?.warnings ?? {};
    const healthStatuses = healthData?.statuses ?? {};

    const newNodes: SystemNode[] = systemsData.systems.map((system) => {
      const pos = positions.get(system.id) ?? { x: 0, y: 0 };
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
      };

      return {
        id: system.id,
        type: "system" as const,
        position: pos,
        data: nodeData,
      };
    });

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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
          },
          data: edgeData,
        };
      },
    );

    setNodes(newNodes);
    setEdges(newEdges);
  }, [systemsData, depsData, posData, warningsData, healthData, setNodes, setEdges]);

  // Track node position changes for saving
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

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

  // Listen for realtime dependency changes
  useSignal(DEPENDENCY_CHANGED, () => {
    void refetchDeps();
  });

  useSignal(DEPENDENCY_WARNINGS_CHANGED, () => {
    void refetchWarnings();
  });

  useSignal(SYSTEM_STATUS_CHANGED, () => {
    void refetchHealth();
    void refetchWarnings();
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const loading = systemsLoading || depsLoading;

  if (loading) {
    return (
      <div className="h-[calc(100vh-12rem)] flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-12rem)] rounded-xl border border-border overflow-hidden bg-background/50">
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
            if (status === "down") return "rgb(239 68 68)";
            if (status === "degraded") return "rgb(245 158 11)";
            return "rgb(16 185 129)";
          }}
          maskColor="rgba(0, 0, 0, 0.2)"
        />

        {/* Top-right panel with actions */}
        <Panel position="top-right" className="flex gap-2">
          {hasUnsaved && (
            <Badge variant="warning" className="animate-pulse">
              Unsaved
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending || !hasUnsaved}
            className="bg-card/90 backdrop-blur-sm"
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
            className="bg-card/90 backdrop-blur-sm"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fitView({ padding: 0.3 })}
            className="bg-card/90 backdrop-blur-sm"
          >
            <Maximize2 className="h-4 w-4 mr-1" />
            Fit
          </Button>
        </Panel>

        {/* Bottom-left legend */}
        <Panel position="bottom-left">
          <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg max-w-64">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
              Impact Legend
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
        {selectedEdge && (
          <Panel position="top-left">
            <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-4 w-72 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Edit Dependency
                </p>
                <p className="text-xs text-muted-foreground">
                  {systemNameMap.get(selectedEdge.sourceSystemId) ??
                    selectedEdge.sourceSystemId}
                  {" → "}
                  {systemNameMap.get(selectedEdge.targetSystemId) ??
                    selectedEdge.targetSystemId}
                </p>
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
                  disabled={deleteMutation.isPending}
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
                    Cancel
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
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

/**
 * Dependency Map page — wrapped in ReactFlowProvider and Suspense.
 */
const DependencyMapPageContent = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dependency Map</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Interactive topology view of system dependencies. Drag nodes to
            rearrange — positions auto-save.
          </p>
        </div>
      </div>
      <ReactFlowProvider>
        <DependencyMapContent />
      </ReactFlowProvider>
    </div>
  );
};

export const DependencyMapPage = wrapInSuspense(DependencyMapPageContent);
