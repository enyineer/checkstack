import React from "react";
import { Settings, Gauge, Database, Radio, Plus, Check } from "lucide-react";
import { IDETreeNode, IDETreeSection } from "@checkstack/ui";

// =============================================================================
// TYPES
// =============================================================================

export type AssignmentNodeId =
  | `general:${string}`
  | `thresholds:${string}`
  | `retention:${string}`
  | `execution:${string}`;

interface AssignmentConfig {
  configurationId: string;
  configurationName: string;
  enabled: boolean;
  satelliteCount: number;
}

interface AssignmentTreeProps {
  assigned: AssignmentConfig[];
  available: Array<{ id: string; name: string; strategyId: string }>;
  selectedNode: AssignmentNodeId | undefined;
  onSelectNode: (nodeId: AssignmentNodeId) => void;
  onToggleAssignment: (configId: string, assigned: boolean) => void;
  isLocked?: boolean;
}

// =============================================================================
// ASSIGNMENT TREE
// =============================================================================

export const AssignmentTree: React.FC<AssignmentTreeProps> = ({
  assigned,
  available,
  selectedNode,
  onSelectNode,
  onToggleAssignment,
  isLocked,
}) => {
  return (
    <div className="py-2">
      <IDETreeSection label="Assigned Health Checks" />

      {assigned.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground italic">
          No health checks assigned
        </p>
      )}

      {assigned.map((assoc) => (
        <div key={assoc.configurationId}>
          {/* Config header — not clickable as a node, just a label */}
          <div className="px-3 py-1.5 text-xs font-medium text-foreground flex items-center gap-2 mt-1">
            <Check className="h-3 w-3 text-primary shrink-0" />
            <span className="truncate">{assoc.configurationName}</span>
            {!assoc.enabled && (
              <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded">
                off
              </span>
            )}
          </div>

          {/* Sub-nodes */}
          <IDETreeNode
            nodeId={`general:${assoc.configurationId}`}
            label="General"
            icon={Settings}
            selected={selectedNode === `general:${assoc.configurationId}`}
            onClick={() => onSelectNode(`general:${assoc.configurationId}`)}
            indent
          />
          <IDETreeNode
            nodeId={`thresholds:${assoc.configurationId}`}
            label="Thresholds"
            icon={Gauge}
            selected={selectedNode === `thresholds:${assoc.configurationId}`}
            onClick={() => onSelectNode(`thresholds:${assoc.configurationId}`)}
            indent
          />
          <IDETreeNode
            nodeId={`retention:${assoc.configurationId}`}
            label="Retention"
            icon={Database}
            selected={selectedNode === `retention:${assoc.configurationId}`}
            onClick={() => onSelectNode(`retention:${assoc.configurationId}`)}
            indent
          />
          <IDETreeNode
            nodeId={`execution:${assoc.configurationId}`}
            label="Execution"
            icon={Radio}
            selected={selectedNode === `execution:${assoc.configurationId}`}
            onClick={() => onSelectNode(`execution:${assoc.configurationId}`)}
            indent
            badge={assoc.satelliteCount > 0 ? `${assoc.satelliteCount}` : undefined}
          />
        </div>
      ))}

      {/* Available (unassigned) health checks */}
      {!isLocked && available.length > 0 && (
        <>
          <IDETreeSection label="Available" />
          {available.map((config) => (
            <button
              key={config.id}
              type="button"
              onClick={() => onToggleAssignment(config.id, false)}
              className="flex items-center gap-2 w-full px-3 py-2 pl-7 text-sm text-left transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-2 border-transparent"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1">{config.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {config.strategyId.split(".").pop()}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
};
