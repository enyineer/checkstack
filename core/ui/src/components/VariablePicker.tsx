import React from "react";
import { ChevronRight, Code2, Search } from "lucide-react";
import { Input } from "./Input";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

/**
 * One node in the variable scope tree.
 *
 * Mirrors `VariableEntry` from `@checkstack/automation-common` — but this
 * package can't depend on automation-common (UI primitives live below the
 * automation layer), so the shape is duplicated here. The automation
 * editor adapts `VariableScope.entries` → `VariableNode[]` at the call
 * site.
 */
export interface VariableNode {
  /** Canonical dot-separated path, e.g. `artifact.integration-jira.issue.key`. */
  path: string;
  /**
   * Runtime-parseable `{{ }}` insertion form, e.g.
   * `artifacts["integration-jira.issue"].key`. Inserted in preference to
   * `path`; callers that don't supply it fall back to `path`.
   */
  templateRef?: string;
  /** Human-readable type label rendered next to the name. */
  type: string;
  description?: string;
  /** Nested entries for object types. */
  children?: VariableNode[];
  /**
   * When set, the entry only exists when one of these triggers fired —
   * picker renders an "Only when …" hint so the operator knows it might
   * be undefined at runtime.
   */
  conditionalOnTriggers?: string[];
}

export interface VariablePickerProps {
  /** Tree of in-scope variables. */
  scope: VariableNode[];
  /**
   * Called with the runtime-parseable text to insert (the node's
   * `templateRef`, falling back to `path`), e.g.
   * `trigger.payload.systemId` or `artifacts["integration-jira.issue"].key`.
   */
  onSelect: (templateRef: string) => void;
  /** Optional element rendered as the popover trigger. Defaults to a small "Insert variable" button. */
  trigger?: React.ReactNode;
  /** Controls open state; defaults to uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional class on the popover content. */
  contentClassName?: string;
}

/**
 * Hierarchical variable picker. Click the trigger button → a popover
 * opens with the tree of in-scope paths grouped under their parents
 * (`trigger`, `var`, `artifact`, `repeat`). Each row inserts
 * `{{ path }}` when clicked. A search input at the top filters across
 * the whole tree (matches against the dot-path), and matched ancestors
 * stay expanded so context is preserved.
 *
 * Designed for the explicit "fx" / "Insert variable" workflow inside the
 * automation editor. For inline `{{` autocomplete inside a text field,
 * use `TemplateValueInput`; for code editors, the `CodeEditor` already
 * pops the same dropdown through Monaco's completion provider.
 */
export const VariablePicker: React.FC<VariablePickerProps> = ({
  scope,
  onSelect,
  trigger,
  open,
  onOpenChange,
  contentClassName,
}) => {
  const [query, setQuery] = React.useState("");
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const filtered = React.useMemo(
    () => (query.trim() ? filterTree(scope, query.trim().toLowerCase()) : scope),
    [scope, query],
  );

  const handleSelect = (path: string) => {
    onSelect(path);
    setOpen(false);
    setQuery("");
  };

  const handleKeyDownOnInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Insert variable"
          >
            <Code2 className="h-3 w-3" />
            <span>fx</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className={`w-80 p-0 ${contentClassName ?? ""}`.trim()}
        align="start"
      >
        <div className="border-b border-border px-2 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDownOnInput}
              placeholder="Filter variables…"
              className="h-7 pl-7 font-mono text-xs"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground italic">
              No matching variables.
            </p>
          ) : (
            filtered.map((node) => (
              <VariableTreeNode
                key={node.path}
                node={node}
                depth={0}
                onSelect={handleSelect}
                forceExpand={query.trim().length > 0}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface VariableTreeNodeProps {
  node: VariableNode;
  depth: number;
  onSelect: (path: string) => void;
  forceExpand: boolean;
}

const VariableTreeNode: React.FC<VariableTreeNodeProps> = ({
  node,
  depth,
  onSelect,
  forceExpand,
}) => {
  const [expanded, setExpanded] = React.useState(depth === 0);
  const isExpanded = forceExpand || expanded;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className="group flex w-full items-center gap-1 text-xs hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="flex h-6 w-4 shrink-0 items-center justify-center rounded hover:bg-accent hover:text-accent-foreground"
            aria-label={isExpanded ? "Collapse" : "Expand"}
            aria-expanded={isExpanded}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          <span className="h-6 w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.templateRef ?? node.path)}
          className="flex flex-1 items-center gap-2 py-1 pr-2 text-left hover:bg-accent hover:text-accent-foreground"
          title={`Insert {{${node.templateRef ?? node.path}}}`}
        >
          <code className="flex-1 truncate font-mono">{leafName(node.path)}</code>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {node.type}
          </span>
        </button>
      </div>
      {node.conditionalOnTriggers && node.conditionalOnTriggers.length > 0 && (
        <p
          className="px-2 text-[10px] italic text-muted-foreground"
          style={{ paddingLeft: `${depth * 12 + 24}px` }}
        >
          Only when {node.conditionalOnTriggers.join(", ")}
        </p>
      )}
      {node.description && (
        <p
          className="px-2 pb-1 text-[10px] text-muted-foreground"
          style={{ paddingLeft: `${depth * 12 + 24}px` }}
        >
          {node.description}
        </p>
      )}
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <VariableTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function leafName(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Walk the tree and return a copy that only includes nodes whose path
 * (or any descendant's path) contains the query. Matched ancestors are
 * kept so the tree structure is preserved.
 */
function filterTree(
  nodes: VariableNode[],
  query: string,
): VariableNode[] {
  const out: VariableNode[] = [];
  for (const node of nodes) {
    const selfMatch = node.path.toLowerCase().includes(query);
    const childMatches = node.children
      ? filterTree(node.children, query)
      : undefined;
    if (selfMatch || (childMatches && childMatches.length > 0)) {
      out.push({
        ...node,
        children: childMatches,
      });
    }
  }
  return out;
}
