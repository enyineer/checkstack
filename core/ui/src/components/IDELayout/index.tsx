import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "../Badge";

// =============================================================================
// SHARED TYPES
// =============================================================================

/**
 * Generic validation issue for IDE-style editors.
 * nodeId identifies which tree node the issue belongs to.
 */
export interface ValidationIssue {
  nodeId: string;
  message: string;
}

// =============================================================================
// VALIDATION DOT
// =============================================================================

/**
 * Small red dot indicator shown on tree nodes with validation issues.
 */
export function IDEValidationDot({
  nodeId,
  issues,
}: {
  nodeId: string;
  issues: ValidationIssue[];
}) {
  const nodeIssues = issues.filter((i) => i.nodeId === nodeId);
  if (nodeIssues.length === 0) return;

  return (
    <span className="ml-auto flex h-2 w-2 rounded-full bg-destructive shrink-0" />
  );
}

// =============================================================================
// TREE NODE
// =============================================================================

interface IDETreeNodeProps {
  nodeId: string;
  label: string;
  icon: React.ElementType;
  selected: boolean;
  onClick: () => void;
  issues?: ValidationIssue[];
  indent?: boolean;
  badge?: string;
}

/**
 * Generic tree node for IDE-style left panel navigation.
 * Highlights when selected, shows validation dots and optional badges.
 */
export const IDETreeNode: React.FC<IDETreeNodeProps> = ({
  nodeId,
  label,
  icon: Icon,
  selected,
  onClick,
  issues = [],
  indent = false,
  badge,
}) => {
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
      <IDEValidationDot nodeId={nodeId} issues={issues} />
    </button>
  );
};

// =============================================================================
// TREE SECTION HEADER
// =============================================================================

/**
 * Section header for grouping tree nodes (e.g., "Check Items", "Permissions").
 */
export const IDETreeSection: React.FC<{ label: string }> = ({ label }) => (
  <div className="px-3 pt-4 pb-1">
    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
      {label}
    </span>
  </div>
);

// =============================================================================
// STATUS BAR
// =============================================================================

interface IDEStatusBarProps {
  issues: ValidationIssue[];
  onIssueClick: (nodeId: string) => void;
}

/**
 * Bottom status bar showing validation issue count with clickable navigation.
 */
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

// =============================================================================
// IDE LAYOUT
// =============================================================================

interface IDELayoutProps {
  /** Left panel tree content */
  tree: React.ReactNode;
  /** Right panel editor content */
  panel: React.ReactNode;
  /** Optional status bar issues (renders IDEStatusBar automatically) */
  issues?: ValidationIssue[];
  /** Callback when a status bar issue is clicked */
  onIssueClick?: (nodeId: string) => void;
}

/**
 * Two-column IDE layout shell: left tree panel + right editor panel + status bar.
 * Used by health check configuration editor and assignment editor.
 */
export const IDELayout: React.FC<IDELayoutProps> = ({
  tree,
  panel,
  issues,
  onIssueClick,
}) => {
  return (
    <>
      <div className="flex flex-col lg:flex-row gap-0 min-h-[60vh] border rounded-lg bg-card overflow-hidden">
        {/* Explorer Tree — Left Panel */}
        <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r bg-muted/30">
          {tree}
        </div>

        {/* Editor Panel — Right Panel */}
        <div className="flex-1 min-w-0">{panel}</div>
      </div>

      {/* Status Bar */}
      {issues && onIssueClick && (
        <IDEStatusBar issues={issues} onIssueClick={onIssueClick} />
      )}
    </>
  );
};
