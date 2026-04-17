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
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  DependencyApi,
  DEPENDENCY_CHANGED,
  DEPENDENCY_WARNINGS_CHANGED,
  type Dependency,
  type NodePosition,
} from "@checkstack/dependency-common";
import { Button, Badge, LoadingSpinner } from "@checkstack/ui";
import { Maximize2, Save, RefreshCw } from "lucide-react";

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
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DependencyEdge>([]);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

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

  // Save positions mutation
  const saveMutation = depClient.saveNodePositions.useMutation({
    onSuccess: () => {
      setHasUnsaved(false);
    },
  });

  // Build graph from data
  useEffect(() => {
    if (!systemsData?.systems || !depsData?.dependencies) return;

    const savedPositions = posData?.positions ?? [];
    const positions = autoLayout(
      systemsData.systems.map((s) => s.id),
      savedPositions,
    );

    const warnings = warningsData?.warnings ?? {};

    const newNodes: SystemNode[] = systemsData.systems.map((system) => {
      const pos = positions.get(system.id) ?? { x: 0, y: 0 };
      const warning = warnings[system.id];

      const nodeData: SystemNodeData = {
        label: system.name,
        systemId: system.id,
        status: "operational" as const, // TODO: integrate real health status
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
  }, [systemsData, depsData, posData, warningsData, setNodes, setEdges]);

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
    [onNodesChange],
  );

  // Save positions
  const { mutate: savePositions } = saveMutation;
  const handleSave = useCallback(() => {
    const positions: NodePosition[] = nodes.map((n) => ({
      systemId: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    }));

    savePositions({ positions });
  }, [nodes, savePositions]);

  // Listen for realtime dependency changes
  useSignal(DEPENDENCY_CHANGED, () => {
    void refetchDeps();
  });

  useSignal(DEPENDENCY_WARNINGS_CHANGED, () => {
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
          <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg">
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
                <span className="text-xs text-muted-foreground">
                  Multi-hop
                </span>
              </div>
            </div>
          </div>
        </Panel>
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
          <h1 className="text-2xl font-bold text-foreground">
            Dependency Map
          </h1>
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
