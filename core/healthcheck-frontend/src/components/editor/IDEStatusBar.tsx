import React from "react";
import type { TreeNodeId } from "./EditorTree";
import { AlertCircle, CheckCircle2 } from "lucide-react";

// =============================================================================
// TYPES
// =============================================================================

export interface ValidationIssue {
  nodeId: TreeNodeId;
  message: string;
}

interface IDEStatusBarProps {
  issues: ValidationIssue[];
  onIssueClick: (nodeId: TreeNodeId) => void;
}

// =============================================================================
// STATUS BAR
// =============================================================================

export const IDEStatusBar: React.FC<IDEStatusBarProps> = ({
  issues,
  onIssueClick,
}) => {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 mt-2 rounded-md border bg-card text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span>No issues found</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 mt-2 rounded-md border bg-card text-xs">
      <div className="flex items-center gap-1.5 text-destructive shrink-0">
        <AlertCircle className="h-3.5 w-3.5" />
        <span className="font-medium">
          {issues.length} {issues.length === 1 ? "issue" : "issues"}
        </span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto">
        {issues.map((issue, i) => (
          <button
            key={`${issue.nodeId}-${i}`}
            type="button"
            onClick={() => onIssueClick(issue.nodeId)}
            className="text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap underline-offset-2 hover:underline"
          >
            {issue.message}
          </button>
        ))}
      </div>
    </div>
  );
};
