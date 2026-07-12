import React from "react";
import {
  Settings,
  Gauge,
  Database,
  Radio,
  Bell,
  Plus,
  Server,
} from "lucide-react";
import { IDETreeNode, IDETreeSection } from "@checkstack/ui";
import { ExtensionSlot } from "@checkstack/frontend-api";
import { AssignmentIDENodeSlot } from "../../slots";
import {
  ASSIGNMENT_PICKER_NODE,
  buildAssignmentExtensionNodeId,
  buildAssignmentNodeId,
  extensionSelectedNodeForSystem,
} from "./assignment-node.logic";

interface AssignmentSummary {
  systemId: string;
  systemName: string;
  enabled: boolean;
  satelliteCount: number;
}

interface AssignmentTreeSectionProps {
  configId: string;
  assignments: AssignmentSummary[];
  selectedNode: string;
  onSelectNode: (nodeId: string) => void;
  /** Per-system write verdict (assignment writes are system-plane). */
  canManageSystem: (systemId: string) => boolean;
  /**
   * Config-plane gate for the Retention node: retention is authorized on the
   * CONFIGURATION (`getRetentionConfig`/`updateRetentionConfig` are idParam
   * on configurationId), so a pure system manager cannot read it - the node
   * is hidden rather than shown broken.
   */
  showRetention: boolean;
}

/**
 * The "Assignment" section of the check editor's tree (edit mode): one node
 * group per assigned system, each with the per-assignment panels, plus the
 * "Assign to system..." picker entry. Check-centric inverse of the former
 * system-centric AssignmentTree.
 */
export const AssignmentTreeSection: React.FC<AssignmentTreeSectionProps> = ({
  configId,
  assignments,
  selectedNode,
  onSelectNode,
  canManageSystem,
  showRetention,
}) => {
  return (
    <>
      <IDETreeSection label="Assignment" />

      {assignments.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground italic">
          Not assigned - this check is not running
        </p>
      )}

      {assignments.map((assignment) => {
        const { systemId } = assignment;
        const panelNode = (panel: Parameters<typeof buildAssignmentNodeId>[0]["panel"]) =>
          buildAssignmentNodeId({ systemId, panel });
        return (
          <div key={systemId}>
            {/* System header - not clickable as a node, just a label */}
            <div className="px-3 py-1.5 text-xs font-medium text-foreground flex items-center gap-2 mt-1">
              <Server className="h-3 w-3 text-primary shrink-0" />
              <span className="truncate">{assignment.systemName}</span>
              {!assignment.enabled && (
                <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded">
                  off
                </span>
              )}
            </div>

            <IDETreeNode
              nodeId={panelNode("general")}
              label="General"
              icon={Settings}
              selected={selectedNode === panelNode("general")}
              onClick={() => onSelectNode(panelNode("general"))}
              indent
            />
            <IDETreeNode
              nodeId={panelNode("thresholds")}
              label="Thresholds"
              icon={Gauge}
              selected={selectedNode === panelNode("thresholds")}
              onClick={() => onSelectNode(panelNode("thresholds"))}
              indent
            />
            {showRetention && (
              <IDETreeNode
                nodeId={panelNode("retention")}
                label="Retention"
                icon={Database}
                selected={selectedNode === panelNode("retention")}
                onClick={() => onSelectNode(panelNode("retention"))}
                indent
              />
            )}
            <IDETreeNode
              nodeId={panelNode("execution")}
              label="Execution"
              icon={Radio}
              selected={selectedNode === panelNode("execution")}
              onClick={() => onSelectNode(panelNode("execution"))}
              indent
              badge={
                assignment.satelliteCount > 0
                  ? `${assignment.satelliteCount}`
                  : undefined
              }
            />
            <IDETreeNode
              nodeId={panelNode("notifications")}
              label="Notifications"
              icon={Bell}
              selected={selectedNode === panelNode("notifications")}
              onClick={() => onSelectNode(panelNode("notifications"))}
              indent
            />
            {/* Extension nodes (e.g. anomaly): the slot context keeps its
                original shape, but selection is wrapped per system - the
                extension's config-keyed node ids would otherwise collide
                across systems (see assignment-node.logic.ts). */}
            <ExtensionSlot
              slot={AssignmentIDENodeSlot}
              context={{
                systemId,
                configurationId: configId,
                selectedNode: extensionSelectedNodeForSystem({
                  selectedNode,
                  systemId,
                }),
                onSelectNode: (extensionNodeId) =>
                  onSelectNode(
                    buildAssignmentExtensionNodeId({
                      systemId,
                      extensionNodeId,
                    }),
                  ),
                isLocked: !canManageSystem(systemId),
              }}
            />
          </div>
        );
      })}

      {/* Assign entry - styled like the tree's "Add check item..." button.
          Always offered: the picker panel itself explains when the caller
          manages no systems (assigning is system-plane). */}
      <button
        type="button"
        onClick={() => onSelectNode(ASSIGNMENT_PICKER_NODE)}
        className={`flex items-center gap-2 w-full px-3 py-2 pl-7 text-sm text-left transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-2 ${
          selectedNode === ASSIGNMENT_PICKER_NODE
            ? "border-primary bg-primary/10 text-primary"
            : "border-transparent"
        }`}
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span className="truncate">Assign to system...</span>
      </button>
    </>
  );
};
