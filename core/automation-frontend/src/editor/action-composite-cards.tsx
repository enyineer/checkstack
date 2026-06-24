import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TemplateValueInput,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type {
  ActionInput,
  ActionPath,
  ActionPathStep,
  ChooseInput,
  ConditionInput,
  ParallelInput,
  RepeatInput,
  SequenceInput,
  RepeatMode,
} from "@checkstack/automation-common";
import { ConditionEditor } from "./ConditionEditor";
import { ActionListEditor } from "./ActionListEditor";

/**
 * `choose:` — list of `when` clauses, each gating a nested sequence,
 * plus an optional `else` sequence. The when-clauses themselves use
 * the same recursive `ConditionEditor` the top-level pre-run
 * conditions use. Each when-clause's sequence renders the same
 * `ActionListEditor` the top level uses — that's how nesting works,
 * top-down composition all the way down.
 */
export const ChooseActionBody: React.FC<{
  value: ChooseInput;
  onChange: (next: ChooseInput) => void;
  path: ActionPath;
  variableNodes: VariableNode[];
  /** Expression-mode provider for the `when` clauses (bare expressions). */
  expressionCompletion: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({
  value,
  onChange,
  path,
  variableNodes,
  expressionCompletion,
  disabled,
}) => {
  const handleBranchChange = (
    branchIndex: number,
    update: (branch: { when: ConditionInput; sequence: ActionInput[] }) => {
      when: ConditionInput;
      sequence: ActionInput[];
    },
  ) => {
    const next = [...value.choose];
    next[branchIndex] = update(next[branchIndex]!);
    onChange({ ...value, choose: next });
  };

  return (
    <div className="space-y-3">
      {value.choose.map((branch, branchIndex) => {
        const branchPath: ActionPath = [
          ...path,
          { slot: "choose-when", whenIndex: branchIndex, index: 0 } as ActionPathStep,
        ];
        return (
          <Card key={branchIndex} className="border-border/60 bg-muted/30">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  When (branch {branchIndex + 1})
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    onChange({
                      ...value,
                      choose: value.choose.filter((_, i) => i !== branchIndex),
                    })
                  }
                  disabled={disabled}
                  aria-label="Remove branch"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <ConditionEditor
                value={branch.when}
                onChange={(when) =>
                  handleBranchChange(branchIndex, (b) => ({ ...b, when }))
                }
                variableNodes={variableNodes}
                completionProvider={expressionCompletion}
                bare
              />
              <Label className="text-xs">Then run</Label>
              <ActionListEditor
                value={branch.sequence}
                onChange={(sequence) =>
                  handleBranchChange(branchIndex, (b) => ({ ...b, sequence }))
                }
                parentPath={branchPath.slice(0, -1)}
                slotForChildren={{ slot: "choose-when", whenIndex: branchIndex }}
                disabled={disabled}
              />
            </CardContent>
          </Card>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            ...value,
            choose: [...value.choose, { when: "", sequence: [] }],
          })
        }
        disabled={disabled}
        className="h-7 text-xs"
      >
        <Plus className="mr-1 h-3 w-3" />
        Add branch
      </Button>

      <Card className="border-dashed border-border/60 bg-muted/20">
        <CardContent className="space-y-2 p-3">
          <Label className="text-xs">Else (optional)</Label>
          <ActionListEditor
            value={value.else ?? []}
            onChange={(next) =>
              onChange({ ...value, else: next.length === 0 ? undefined : next })
            }
            parentPath={path}
            slotForChildren={{ slot: "choose-else" }}
            disabled={disabled}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export const ParallelActionBody: React.FC<{
  value: ParallelInput;
  onChange: (next: ParallelInput) => void;
  path: ActionPath;
  disabled?: boolean;
}> = ({ value, onChange, path, disabled }) => (
  <div className="space-y-2">
    <Label className="text-xs">Branches (run concurrently)</Label>
    <ActionListEditor
      value={value.parallel}
      onChange={(parallel) => onChange({ ...value, parallel })}
      parentPath={path}
      slotForChildren={{ slot: "parallel" }}
      disabled={disabled}
    />
  </div>
);

export const SequenceActionBody: React.FC<{
  value: SequenceInput;
  onChange: (next: SequenceInput) => void;
  path: ActionPath;
  disabled?: boolean;
}> = ({ value, onChange, path, disabled }) => (
  <div className="space-y-2">
    <Label className="text-xs">Steps</Label>
    <ActionListEditor
      value={value.sequence}
      onChange={(sequence) => onChange({ ...value, sequence })}
      parentPath={path}
      slotForChildren={{ slot: "sequence" }}
      disabled={disabled}
    />
  </div>
);

type RepeatModeKind = "count" | "for_each" | "while" | "until";

function repeatModeKind(mode: RepeatMode): RepeatModeKind {
  if ("count" in mode) return "count";
  if ("for_each" in mode) return "for_each";
  if ("while" in mode) return "while";
  return "until";
}

export const RepeatActionBody: React.FC<{
  value: RepeatInput;
  onChange: (next: RepeatInput) => void;
  path: ActionPath;
  /** Template-mode provider for the for_each / while / until expressions. */
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({ value, onChange, path, completionProvider, disabled }) => {
  const kind = repeatModeKind(value.repeat);

  const changeKind = (next: RepeatModeKind) => {
    const sequence = value.repeat.sequence;
    switch (next) {
    case "count": {
      onChange({ ...value, repeat: { count: 3, sequence } });
    
    break;
    }
    case "for_each": {
      onChange({ ...value, repeat: { for_each: "", sequence } });
    
    break;
    }
    case "while": {
      onChange({ ...value, repeat: { while: "", sequence } });
    
    break;
    }
    default: {
      onChange({ ...value, repeat: { until: "", sequence } });
    }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Mode</Label>
        <Select
          value={kind}
          onValueChange={(next) => changeKind(next as RepeatModeKind)}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="count">count</SelectItem>
            <SelectItem value="for_each">for_each</SelectItem>
            <SelectItem value="while">while</SelectItem>
            <SelectItem value="until">until</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {kind === "count" && (
        <div className="space-y-1">
          <Label className="text-xs">Iterations</Label>
          <Input
            type="number"
            min={1}
            max={10_000}
            value={(value.repeat as { count: number }).count}
            onChange={(event) =>
              onChange({
                ...value,
                repeat: {
                  ...value.repeat,
                  count: Math.max(1, Number(event.target.value)),
                },
              })
            }
            disabled={disabled}
          />
        </div>
      )}

      {(kind === "for_each" || kind === "while" || kind === "until") && (
        <div className="space-y-1">
          <Label className="text-xs">
            {kind === "for_each"
              ? "Iterable expression (renders to JSON array)"
              : "Condition (expression)"}
          </Label>
          <TemplateValueInput
            mode="expression"
            value={
              kind === "for_each"
                ? (value.repeat as { for_each: string }).for_each
                : kind === "while"
                  ? (value.repeat as { while: string }).while
                  : (value.repeat as { until: string }).until
            }
            onChange={(next) => {
              const sequence = value.repeat.sequence;
              if (kind === "for_each") {
                onChange({ ...value, repeat: { for_each: next, sequence } });
              } else if (kind === "while") {
                onChange({
                  ...value,
                  repeat: {
                    while: next,
                    sequence,
                    max_iterations: (
                      value.repeat as { max_iterations?: number }
                    ).max_iterations,
                  },
                });
              } else {
                onChange({
                  ...value,
                  repeat: {
                    until: next,
                    sequence,
                    max_iterations: (
                      value.repeat as { max_iterations?: number }
                    ).max_iterations,
                  },
                });
              }
            }}
            placeholder={
              kind === "for_each"
                ? "{{ trigger.payload.items }}"
                : "{{ var.done == false }}"
            }
            completionProvider={completionProvider}
            disabled={disabled}
          />
        </div>
      )}

      {(kind === "while" || kind === "until") && (
        <div className="space-y-1">
          <Label className="text-xs">Max iterations (safety net)</Label>
          <Input
            type="number"
            min={1}
            max={10_000}
            value={
              (value.repeat as { max_iterations?: number }).max_iterations ?? 1000
            }
            onChange={(event) => {
              const max_iterations = Math.max(1, Number(event.target.value));
              if (kind === "while") {
                onChange({
                  ...value,
                  repeat: {
                    while: (value.repeat as { while: string }).while,
                    max_iterations,
                    sequence: value.repeat.sequence,
                  },
                });
              } else {
                onChange({
                  ...value,
                  repeat: {
                    until: (value.repeat as { until: string }).until,
                    max_iterations,
                    sequence: value.repeat.sequence,
                  },
                });
              }
            }}
            disabled={disabled}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Sequence (runs each iteration)</Label>
        <ActionListEditor
          value={value.repeat.sequence}
          onChange={(sequence) =>
            onChange({
              ...value,
              repeat: {
                ...value.repeat,
                sequence,
              } as typeof value.repeat,
            })
          }
          parentPath={path}
          slotForChildren={{ slot: "repeat" }}
          disabled={disabled}
        />
      </div>
    </div>
  );
};
