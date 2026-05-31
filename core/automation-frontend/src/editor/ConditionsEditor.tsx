import React from "react";
import {
  ActionCard,
  type ActionCardMenuItem,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type { ConditionInput } from "@checkstack/automation-common";
import { AddConditionDialog } from "./AddConditionDialog";
import { ConditionEditor } from "./ConditionEditor";
import { defaultForKind } from "./condition-kind";
import { ItemSheet } from "./ItemSheet";
import { useConditionIssues } from "./editor-validation";
import { summarizeCondition } from "./item-summary";

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
      <CardTitle className="text-base">Conditions</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 p-3">
      {value.length === 0 && (
        <p className="text-xs italic text-muted-foreground">
          No pre-run gating. Add a condition to require it before the
          actions run.
        </p>
      )}
      {value.map((condition, index) => (
        <ConditionCard
          key={index}
          index={index}
          value={condition}
          onChange={(next) => {
            const list = [...value];
            list[index] = next;
            onChange(list);
          }}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
          onDuplicate={() =>
            // Conditions carry no id, so a structural clone (inserted
            // directly after the original) is all that's needed.
            onChange([
              ...value.slice(0, index + 1),
              structuredClone(condition),
              ...value.slice(index + 1),
            ])
          }
          variableNodes={variableNodes}
          completionProvider={completionProvider}
          disabled={disabled}
        />
      ))}
      <AddConditionDialog
        disabled={disabled}
        onAdd={(kind) => onChange([...value, defaultForKind(kind)])}
      />
    </CardContent>
  </Card>
);

const ConditionCard: React.FC<{
  index: number;
  value: ConditionInput;
  onChange: (next: ConditionInput) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  variableNodes: VariableNode[];
  completionProvider: TemplateCompletionProvider;
  disabled?: boolean;
}> = ({
  index,
  value,
  onChange,
  onRemove,
  onDuplicate,
  variableNodes,
  completionProvider,
  disabled,
}) => {
  const issues = useConditionIssues(index);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  React.useEffect(() => {
    if (issues.length > 0) setSheetOpen(true);
  }, [issues.length]);

  const summary = summarizeCondition(value);
  const title = `Condition ${index + 1}`;

  const menuItems: ActionCardMenuItem[] = disabled
    ? []
    : [
        { label: "Duplicate", icon: "Copy", onClick: onDuplicate },
        {
          label: "Delete",
          icon: "Trash2",
          onClick: onRemove,
          variant: "destructive",
        },
      ];

  return (
    <>
      <ActionCard
        id={`condition-${index}`}
        title={title}
        summary={summary}
        category="Condition"
        icon="Funnel"
        onOpenSheet={() => setSheetOpen(true)}
        actions={menuItems}
        errors={issues}
      />
      <ItemSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={title}
        description="Pre-run condition"
      >
        <ConditionEditor
          value={value}
          onChange={onChange}
          variableNodes={variableNodes}
          completionProvider={completionProvider}
          bare
          // Kind is chosen up front via AddConditionDialog; to change it the
          // operator deletes + re-adds, matching how actions work. Nested
          // clauses keep their inline selector (this prop isn't threaded down).
          hideKindSelector
        />
      </ItemSheet>
    </>
  );
};
