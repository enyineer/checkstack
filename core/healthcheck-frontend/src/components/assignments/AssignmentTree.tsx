import React, { useMemo, useState } from "react";
import {
  Settings,
  Gauge,
  Database,
  Radio,
  Plus,
  Check,
  Bell,
  Search,
} from "lucide-react";
import { IDETreeNode, IDETreeSection, Input } from "@checkstack/ui";
import { ExtensionSlot } from "@checkstack/frontend-api";
import { AssignmentIDENodeSlot } from "../../slots";

// =============================================================================
// TYPES
// =============================================================================

export type AssignmentNodeId = string;

interface AssignmentConfig {
  configurationId: string;
  configurationName: string;
  enabled: boolean;
  satelliteCount: number;
}

interface AssignmentTreeProps {
  systemId: string;
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
  systemId,
  assigned,
  available,
  selectedNode,
  onSelectNode,
  onToggleAssignment,
  isLocked,
}) => {
  const [availableQuery, setAvailableQuery] = useState("");
  const filteredAvailable = useMemo(() => {
    const q = availableQuery.trim().toLowerCase();
    if (!q) return available;
    return available.filter((c) => {
      const strategyTail = c.strategyId.split(".").pop() ?? "";
      return (
        c.name.toLowerCase().includes(q) || strategyTail.toLowerCase().includes(q)
      );
    });
  }, [available, availableQuery]);

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
          <IDETreeNode
            nodeId={`notifications:${assoc.configurationId}`}
            label="Notifications"
            icon={Bell}
            selected={
              selectedNode === `notifications:${assoc.configurationId}`
            }
            onClick={() =>
              onSelectNode(`notifications:${assoc.configurationId}`)
            }
            indent
          />
          <ExtensionSlot 
            slot={AssignmentIDENodeSlot} 
            context={{
              systemId,
              configurationId: assoc.configurationId,
              selectedNode,
              onSelectNode,
              isLocked
            }} 
          />
        </div>
      ))}

      {/* Available (unassigned) health checks */}
      {!isLocked && available.length > 0 && (
        <>
          <IDETreeSection label="Available" />
          <div className="px-3 pb-1">
            <div className="flex items-center gap-2 rounded-md border border-input bg-surface-inset px-2 focus-within:ring-1 focus-within:ring-ring">
              <Search className="pointer-events-none h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                value={availableQuery}
                onChange={(e) => setAvailableQuery(e.target.value)}
                placeholder="Filter health checks…"
                autoComplete="off"
                aria-label="Filter available health checks"
                className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>
          {filteredAvailable.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground italic">
              No matching health checks
            </p>
          ) : (
            filteredAvailable.map((config) => (
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
            ))
          )}
        </>
      )}
    </div>
  );
};
