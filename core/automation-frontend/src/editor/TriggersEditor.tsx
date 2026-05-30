import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  DynamicForm,
  TemplateValueInput,
  Badge,
} from "@checkstack/ui";
import type {
  AutomationDefinition,
  Trigger,
} from "@checkstack/automation-common";
import { useAutomationRegistry, useVariableScope } from "./registry-context";
import { ItemPicker } from "./ItemPicker";
import { useTriggerIssues } from "./editor-validation";
import { collectTriggerIds, defaultTriggerId } from "./trigger-helpers";

/**
 * Build a minimal `AutomationDefinition` that only subscribes to the
 * given trigger and has no actions — used to feed `useVariableScope`
 * for a trigger's `filter:` field, where the in-scope variables are
 * just this specific trigger's payload (no upstream actions exist
 * yet, no other triggers are relevant because the filter runs
 * per-trigger). Memoised in the consumer so the resolver's `useMemo`
 * dep array stays stable across re-renders.
 */
function buildTriggerFilterDefinition(triggerEvent: string): AutomationDefinition {
  return {
    name: "_",
    triggers: [{ event: triggerEvent }],
    conditions: [],
    actions: [],
    mode: "single",
    max_runs: 1,
  };
}

export interface TriggersEditorProps {
  value: Trigger[];
  onChange: (next: Trigger[]) => void;
  disabled?: boolean;
}

/**
 * Editor for the automation's `triggers` array. Each trigger card has:
 *
 *   - Event picker (combobox over `listTriggers()` from the registry).
 *   - Optional operator-assigned `id` field — used as a discriminator
 *     in `choose: when: trigger.id == "x"` expressions.
 *   - Optional `filter` template that gates the trigger before any
 *     action runs.
 *   - When the selected trigger declares a `configSchema`, a
 *     DynamicForm renders the per-trigger configuration (e.g.
 *     `cronPattern` for `automation.cron`, `intervalSeconds` for
 *     `automation.interval`).
 *
 * The triggers list itself isn't drag-reorderable — order doesn't
 * affect runtime behaviour for triggers (any matching trigger fires
 * the automation), and a static list keeps the UI calmer.
 */
export const TriggersEditor: React.FC<TriggersEditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { triggers } = useAutomationRegistry();
  const pickerItems = React.useMemo(
    () =>
      triggers.map((t) => ({
        id: t.qualifiedId,
        label: t.displayName,
        description: t.description,
        category: t.category,
      })),
    [triggers],
  );

  const handleAdd = () => {
    // Assign a unique default id up front (deduped against existing triggers)
    // so the new trigger is immediately referenceable as `trigger.id` and the
    // field shows a value rather than appearing blank.
    const fresh: Trigger = { event: triggers[0]?.qualifiedId ?? "" };
    const id = defaultTriggerId(fresh, collectTriggerIds(value));
    onChange([...value, { ...fresh, id }]);
  };

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Triggers</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={disabled}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add trigger
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {value.length === 0 && (
          <p className="text-xs italic text-muted-foreground">
            An automation needs at least one trigger.
          </p>
        )}
        {value.map((trigger, index) => (
          <TriggerCard
            key={index}
            index={index}
            value={trigger}
            onChange={(next) => {
              const list = [...value];
              list[index] = next;
              onChange(list);
            }}
            onRemove={() => onChange(value.filter((_, i) => i !== index))}
            disabled={disabled}
            pickerItems={pickerItems}
            // Ids of the other triggers — used to keep this trigger's
            // auto-filled id unique when the operator clears the field.
            siblingIds={collectTriggerIds(value.filter((_, i) => i !== index))}
          />
        ))}
      </CardContent>
    </Card>
  );
};

const TriggerCard: React.FC<{
  index: number;
  value: Trigger;
  onChange: (next: Trigger) => void;
  onRemove: () => void;
  disabled?: boolean;
  pickerItems: Array<{ id: string; label: string; description?: string; category?: string }>;
  siblingIds: Set<string>;
}> = ({ index, value, onChange, onRemove, disabled, pickerItems, siblingIds }) => {
  const { triggers } = useAutomationRegistry();
  const selected = triggers.find((t) => t.qualifiedId === value.event);
  const issues = useTriggerIssues(index);

  // Templates inside the filter / config see only the selected
  // trigger's payload — there are no other triggers, no upstream
  // actions, and no variables in scope at filter-evaluation time.
  const filterScopeDefinition = React.useMemo(
    () => buildTriggerFilterDefinition(value.event),
    [value.event],
  );
  const { templateCompletion } = useVariableScope({
    definition: filterScopeDefinition,
    path: [{ slot: "root", index: 0 }],
  });

  return (
    <Card
      className={
        issues.length > 0
          ? "border-destructive/60 bg-muted/30 ring-1 ring-destructive/30"
          : "border-border/60 bg-muted/30"
      }
    >
      <CardContent className="space-y-3 p-3">
        {issues.length > 0 && (
          <ul className="space-y-0.5">
            {issues.map((issue, i) => (
              <li key={i} className="text-[11px] font-mono text-destructive">
                {issue}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Event</Label>
              <ItemPicker
                items={pickerItems}
                value={value.event}
                onSelect={(id) => onChange({ ...value, event: id })}
                placeholder="Pick a trigger event"
                disabled={disabled}
              />
              {selected && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {selected.ownerPluginId}
                  </Badge>
                  {selected.description}
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`trigger-id-${index}`}>
                  ID
                </Label>
                <Input
                  id={`trigger-id-${index}`}
                  value={value.id ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      id: event.target.value || undefined,
                    })
                  }
                  onBlur={() => {
                    // Never leave the id blank: re-fill a unique default so the
                    // trigger stays referenceable as `trigger.id` and is
                    // distinguishable from sibling triggers.
                    if (value.id) return;
                    onChange({ ...value, id: defaultTriggerId(value, siblingIds) });
                  }}
                  placeholder="Generated on blur"
                  disabled={disabled}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Filter template</Label>
                <TemplateValueInput
                  value={value.filter ?? ""}
                  onChange={(next) =>
                    onChange({ ...value, filter: next || undefined })
                  }
                  placeholder="{{ trigger.payload.severity == &quot;high&quot; }}"
                  completionProvider={templateCompletion}
                  disabled={disabled}
                />
              </div>
            </div>
            {selected?.configSchema && (
              <div className="space-y-1">
                <Label className="text-xs">Trigger configuration</Label>
                <DynamicForm
                  schema={selected.configSchema}
                  value={value.config ?? {}}
                  onChange={(next) =>
                    onChange({ ...value, config: next })
                  }
                />
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:bg-destructive/10"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove trigger"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
