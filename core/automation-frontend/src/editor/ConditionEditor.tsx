import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TemplateValueInput,
  VariablePicker,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type { ConditionInput } from "@checkstack/automation-common";

type CombinatorKind = "expr" | "and" | "or" | "not";

function kindOf(condition: ConditionInput): CombinatorKind {
  if (typeof condition === "string") return "expr";
  if ("and" in condition) return "and";
  if ("or" in condition) return "or";
  return "not";
}

function defaultForKind(kind: CombinatorKind): ConditionInput {
  switch (kind) {
    case "expr": {
      return "";
    }
    case "and": {
      return { and: [""] };
    }
    case "or": {
      return { or: [""] };
    }
    case "not": {
      return { not: "" };
    }
  }
}

export interface ConditionEditorProps {
  value: ConditionInput;
  onChange: (next: ConditionInput) => void;
  variableNodes: VariableNode[];
  /**
   * Staged completion provider (expression mode) for the inline
   * expression input. Conditions are bare expressions — no `{{ }}`
   * wrapper — so this is the `expressionCompletion` from
   * `useVariableScope`. The hierarchical `variableNodes` powers the
   * explicit "fx" picker.
   */
  completionProvider: TemplateCompletionProvider;
  /** Render without the wrapping card — used when inlining inside an action card. */
  bare?: boolean;
  depth?: number;
}

/**
 * Recursive editor over the `ConditionInput` discriminated union
 * (`string | { and } | { or } | { not }`). Each level renders:
 *
 *   - A kind selector ("expression" | "and" | "or" | "not").
 *   - The matching body:
 *       expr → TemplateValueInput with `{{` autocomplete + the
 *              VariablePicker "fx" trigger inline.
 *       and / or → list of child conditions with add/remove buttons,
 *                  each child rendered through this same component.
 *       not → single child condition.
 *
 * No depth cap — operator can nest arbitrarily, mirroring the runtime.
 */
export const ConditionEditor: React.FC<ConditionEditorProps> = ({
  value,
  onChange,
  variableNodes,
  completionProvider,
  bare,
  depth = 0,
}) => {
  const kind = kindOf(value);

  const body = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={kind}
          onValueChange={(next) =>
            onChange(defaultForKind(next as CombinatorKind))
          }
        >
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expr">expression</SelectItem>
            <SelectItem value="and">and</SelectItem>
            <SelectItem value="or">or</SelectItem>
            <SelectItem value="not">not</SelectItem>
          </SelectContent>
        </Select>
        {kind === "expr" && (
          <VariablePicker
            scope={variableNodes}
            onSelect={(path) => {
              // Conditions are bare expressions — insert the raw path,
              // not a `{{ … }}`-wrapped reference.
              const before = typeof value === "string" ? value : "";
              const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
              onChange(`${before}${sep}${path}`);
            }}
          />
        )}
      </div>

      {kind === "expr" && (
        <TemplateValueInput
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(next)}
          placeholder="trigger.payload.severity == &quot;high&quot;"
          completionProvider={completionProvider}
        />
      )}

      {(kind === "and" || kind === "or") && (
        <CombinatorList
          kind={kind}
          children={
            kind === "and"
              ? (value as { and: ConditionInput[] }).and
              : (value as { or: ConditionInput[] }).or
          }
          onChange={(nextChildren) =>
            onChange(
              kind === "and"
                ? { and: nextChildren }
                : { or: nextChildren },
            )
          }
          variableNodes={variableNodes}
          completionProvider={completionProvider}
          depth={depth + 1}
        />
      )}

      {kind === "not" && (
        <ConditionEditor
          value={(value as { not: ConditionInput }).not}
          onChange={(next) => onChange({ not: next })}
          variableNodes={variableNodes}
          completionProvider={completionProvider}
          bare
          depth={depth + 1}
        />
      )}
    </div>
  );

  if (bare) return body;
  return (
    <Card>
      <CardContent className="p-3">{body}</CardContent>
    </Card>
  );
};

const CombinatorList: React.FC<{
  kind: "and" | "or";
  children: ConditionInput[];
  onChange: (next: ConditionInput[]) => void;
  variableNodes: VariableNode[];
  completionProvider: TemplateCompletionProvider;
  depth: number;
}> = ({ children: items, onChange, variableNodes, completionProvider, depth }) => (
  <div className="space-y-2 border-l border-border pl-3">
    {items.map((child, index) => (
      <div key={index} className="flex items-start gap-2">
        <div className="flex-1">
          <ConditionEditor
            value={child}
            onChange={(next) => {
              const nextChildren = [...items];
              nextChildren[index] = next;
              onChange(nextChildren);
            }}
            variableNodes={variableNodes}
            completionProvider={completionProvider}
            bare
            depth={depth}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10"
          onClick={() => onChange(items.filter((_, i) => i !== index))}
          aria-label="Remove condition"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    ))}
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onChange([...items, ""])}
      className="h-7 text-xs"
    >
      <Plus className="mr-1 h-3 w-3" />
      Add clause
    </Button>
  </div>
);
