import React, { useMemo } from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
} from "@checkstack/healthcheck-common";
import { Plus, Settings, Shield, ChevronRight, Server } from "lucide-react";
import { isBuiltInCollector } from "../../hooks/useCollectors";
import {
  IDETreeNode,
  IDETreeSection,
  type ValidationIssue,
} from "@checkstack/ui";
import { ExtensionSlot } from "@checkstack/frontend-api";
import { HealthCheckConfigIDENodeSlot } from "../../slots";

// =============================================================================
// TYPES
// =============================================================================

export type TreeNodeId =
  | "general"
  | "access"
  | "systems"
  | "collector-picker"
  | `collector:${string}`
  | (string & {});

interface EditorTreeProps {
  collectors: CollectorConfigEntry[];
  availableCollectors: CollectorDto[];
  selectedNode: TreeNodeId;
  onSelectNode: (nodeId: TreeNodeId) => void;
  onAddCollector: (collectorId: string) => void;
  validationIssues: ValidationIssue[];
  strategyId: string;
  configId?: string;
  showSystemsNode?: boolean;
  selectedSystemCount?: number;
  /**
   * EDIT mode: the fully-rendered "Assignment" tree section (per-system
   * assignment nodes + the assign picker). Kept opaque so the tree stays
   * dumb; create mode uses the simpler `showSystemsNode` multi-select
   * instead.
   */
  assignmentSection?: React.ReactNode;
  /**
   * Whether to show the Access Control node. Hidden for callers without any
   * config-plane capability (a pure system manager reaches the editor for
   * its Assignment section but cannot read or edit the configuration's team
   * grants).
   */
  showAccessNode?: boolean;
}

// =============================================================================
// EDITOR TREE
// =============================================================================

export const EditorTree: React.FC<EditorTreeProps> = ({
  collectors,
  availableCollectors,
  selectedNode,
  onSelectNode,
  validationIssues,
  strategyId,
  configId,
  showSystemsNode = false,
  selectedSystemCount = 0,
  assignmentSection,
  showAccessNode = true,
}) => {
  // Check if there are addable collectors remaining
  const hasAddableCollectors = useMemo(() => {
    const configuredIds = new Set(collectors.map((c) => c.collectorId));
    return availableCollectors.some(
      (c) => !configuredIds.has(c.id) || c.allowMultiple,
    );
  }, [collectors, availableCollectors]);

  return (
    <div className="py-2">
      {/* General */}
      <IDETreeNode
        nodeId="general"
        label="General"
        icon={Settings}
        selected={selectedNode === "general"}
        onClick={() => onSelectNode("general")}
        issues={validationIssues}
      />

      {/* Collectors Section Header */}
      <IDETreeSection label="Check Items" />

      {/* Configured Collectors */}
      {collectors.map((entry) => {
        const collector = availableCollectors.find(
          (c) => c.id === entry.collectorId,
        );
        const builtIn = isBuiltInCollector(entry.collectorId, strategyId);

        return (
          <IDETreeNode
            key={entry.id}
            nodeId={`collector:${entry.id}`}
            label={collector?.displayName ?? entry.collectorId}
            icon={ChevronRight}
            selected={selectedNode === `collector:${entry.id}`}
            onClick={() => onSelectNode(`collector:${entry.id}`)}
            issues={validationIssues}
            indent
            badge={builtIn ? "Built-in" : undefined}
          />
        );
      })}

      {/* Add Collector Button */}
      {hasAddableCollectors && (
        <button
          type="button"
          onClick={() => onSelectNode("collector-picker")}
          className={`flex items-center gap-2 w-full px-3 py-2 pl-7 text-sm text-left transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-2 ${
            selectedNode === "collector-picker"
              ? "border-primary bg-primary/10 text-primary"
              : "border-transparent"
          }`}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="truncate">Add check item...</span>
        </button>
      )}

      {showSystemsNode && (
        <>
          <IDETreeSection label="Assignment" />
          <IDETreeNode
            nodeId="systems"
            label="Systems"
            icon={Server}
            selected={selectedNode === "systems"}
            onClick={() => onSelectNode("systems")}
            issues={validationIssues}
            badge={
              selectedSystemCount > 0 ? String(selectedSystemCount) : undefined
            }
          />
        </>
      )}

      {/* Edit-mode assignment management (per-system nodes + assign picker). */}
      {assignmentSection}

      {/* Access Control */}
      {showAccessNode && (
        <>
          <IDETreeSection label="Permissions" />

          <IDETreeNode
            nodeId="access"
            label="Access Control"
            icon={Shield}
            selected={selectedNode === "access"}
            onClick={() => onSelectNode("access")}
            issues={validationIssues}
          />
        </>
      )}

      {/* Plugin Configuration Slots */}
      {configId && (
        <ExtensionSlot
          slot={HealthCheckConfigIDENodeSlot}
          context={{
            configurationId: configId,
            strategyId,
            selectedNode,
            onSelectNode,
          }}
        />
      )}
    </div>
  );
};
