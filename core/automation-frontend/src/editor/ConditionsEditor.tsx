import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type { ConditionInput } from "@checkstack/automation-common";
import { ConditionEditor } from "./ConditionEditor";

/**
 * Top-level pre-run conditions. Every condition in this list must pass
 * for the actions section to even start — same semantics as Home
 * Assistant's `condition:` block.
 *
 * Each condition reuses the recursive `ConditionEditor`, so combinators
 * (`and` / `or` / `not`) nest the same way they do inside an inline
 * `choose: when` clause.
 *
 * Variable scope at this point is just `trigger.*` — no upstream
 * variables or artifacts exist before the action list starts. We get
 * that scope from the same `useVariableScope` hook by passing the root
 * path; the parent computes it once and threads it down here.
 */
export const ConditionsEditor: React.FC<{
  value: ConditionInput[];
  onChange: (next: ConditionInput[]) => void;
  variableNodes: VariableNode[];
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({ value, onChange, variableNodes, completionProvider, disabled }) => (
  <Card>
    <CardHeader className="border-b">
      <div className="flex items-center justify-between">
        <CardTitle className="text-base">Conditions</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, ""])}
          disabled={disabled}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add condition
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-2 p-3">
      {value.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No pre-run gating. Add a condition to require it before the
          actions run.
        </p>
      ) : (
        value.map((condition, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1">
              <ConditionEditor
                value={condition}
                onChange={(next) => {
                  const list = [...value];
                  list[index] = next;
                  onChange(list);
                }}
                variableNodes={variableNodes}
                completionProvider={completionProvider}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:bg-destructive/10"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              disabled={disabled}
              aria-label="Remove condition"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);
