import React, { useMemo } from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
} from "@checkstack/healthcheck-common";
import { Plus, Settings, Shield, ChevronRight } from "lucide-react";
import { isBuiltInCollector } from "../../hooks/useCollectors";
import type { ValidationIssue } from "./IDEStatusBar";
import { Badge } from "@checkstack/ui";

// =============================================================================
// TYPES
// =============================================================================

export type TreeNodeId =
  | "general"
  | "access"
  | "collector-picker"
  | `collector:${string}`;

interface EditorTreeProps {
  collectors: CollectorConfigEntry[];
  availableCollectors: CollectorDto[];
  selectedNode: TreeNodeId;
  onSelectNode: (nodeId: TreeNodeId) => void;
  onAddCollector: (collectorId: string) => void;
  validationIssues: ValidationIssue[];
  strategyId: string;
}

// =============================================================================
// VALIDATION INDICATOR
// =============================================================================

function ValidationDot({ nodeId, issues }: { nodeId: string; issues: ValidationIssue[] }) {
  const nodeIssues = issues.filter((i) => i.nodeId === nodeId);
  if (nodeIssues.length === 0) return;

  return (
    <span className="ml-auto flex h-2 w-2 rounded-full bg-destructive shrink-0" />
  );
}

// =============================================================================
// TREE NODE
// =============================================================================

function TreeNode({
  nodeId,
  label,
  icon: Icon,
  selected,
  onClick,
  issues,
  indent = false,
  badge,
}: {
  nodeId: string;
  label: string;
  icon: React.ElementType;
  selected: boolean;
  onClick: () => void;
  issues: ValidationIssue[];
  indent?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
        indent ? "pl-7" : ""
      } ${
        selected
          ? "bg-primary/10 text-primary border-l-2 border-primary"
          : "hover:bg-muted/50 border-l-2 border-transparent"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      <span className="truncate flex-1">{label}</span>
      {badge && (
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {badge}
        </Badge>
      )}
      <ValidationDot nodeId={nodeId} issues={issues} />
    </button>
  );
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
      <TreeNode
        nodeId="general"
        label="General"
        icon={Settings}
        selected={selectedNode === "general"}
        onClick={() => onSelectNode("general")}
        issues={validationIssues}
      />

      {/* Collectors Section Header */}
      <div className="px-3 pt-4 pb-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Check Items
        </span>
      </div>

      {/* Configured Collectors */}
      {collectors.map((entry) => {
        const collector = availableCollectors.find(
          (c) => c.id === entry.collectorId,
        );
        const builtIn = isBuiltInCollector(entry.collectorId, strategyId);

        return (
          <TreeNode
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

      {/* Access Control */}
      <div className="px-3 pt-4 pb-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Permissions
        </span>
      </div>

      <TreeNode
        nodeId="access"
        label="Access Control"
        icon={Shield}
        selected={selectedNode === "access"}
        onClick={() => onSelectNode("access")}
        issues={validationIssues}
      />
    </div>
  );
};
