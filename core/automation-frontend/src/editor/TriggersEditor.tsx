import React from "react";
import {
  ActionCard,
  type ActionCardMenuItem,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  DynamicForm,
  DurationInput,
  TemplateValueInput,
  Toggle,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VariablePicker,
  type DurationValue,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type {
  AutomationDefinition,
  Duration,
  Trigger,
  Window,
} from "@checkstack/automation-common";
import { useAutomationRegistry, useVariableScope } from "./registry-context";
import { AddTriggerDialog } from "./AddTriggerDialog";
import { ItemSheet } from "./ItemSheet";
import { useTriggerIssues } from "./editor-validation";
import {
  collectTriggerIds,
  defaultTriggerId,
  makeTrigger,
} from "./trigger-helpers";
import { summarizeTrigger } from "./item-summary";

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
    concurrency_scope: "automation",
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
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-base">Triggers</CardTitle>
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
            onDuplicate={() => {
              // Clone the trigger with a fresh, unique id (deduped against
              // every sibling) inserted directly after the original.
              const taken = collectTriggerIds(value);
              const { id: _id, ...rest } = trigger;
              const id = defaultTriggerId(rest, taken);
              onChange([
                ...value.slice(0, index + 1),
                { ...rest, id },
                ...value.slice(index + 1),
              ]);
            }}
            disabled={disabled}
            // Ids of the other triggers — used to keep this trigger's
            // auto-filled id unique when the operator clears the field.
            siblingIds={collectTriggerIds(value.filter((_, i) => i !== index))}
          />
        ))}
        <AddTriggerDialog
          disabled={disabled}
          onAdd={(event) =>
            // Assign a unique default id up front (deduped against existing
            // triggers) so the new trigger is immediately referenceable as
            // `trigger.id` and the field shows a value rather than blank.
            onChange([
              ...value,
              makeTrigger({ event, taken: collectTriggerIds(value) }),
            ])
          }
        />
      </CardContent>
    </Card>
  );
};

const TriggerCard: React.FC<{
  index: number;
  value: Trigger;
  onChange: (next: Trigger) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  disabled?: boolean;
  siblingIds: Set<string>;
}> = ({
  index,
  value,
  onChange,
  onRemove,
  onDuplicate,
  disabled,
  siblingIds,
}) => {
  const { triggers } = useAutomationRegistry();
  const selected = triggers.find((t) => t.qualifiedId === value.event);
  const issues = useTriggerIssues(index);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  // Templates inside the filter / config see only the selected
  // trigger's payload — there are no other triggers, no upstream
  // actions, and no variables in scope at filter-evaluation time.
  const filterScopeDefinition = React.useMemo(
    () => buildTriggerFilterDefinition(value.event),
    [value.event],
  );
  const { templateCompletion, expressionCompletion, variableNodes } =
    useVariableScope({
      definition: filterScopeDefinition,
      path: [{ slot: "root", index: 0 }],
    });

  // Surface a problem rather than hide it behind a collapsed row + closed
  // sheet.
  React.useEffect(() => {
    if (issues.length > 0) setSheetOpen(true);
  }, [issues.length]);

  const title = selected?.displayName ?? value.event ?? "Trigger";
  const summary = summarizeTrigger(value);

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
        id={`trigger-${index}`}
        title={title}
        summary={summary}
        category="Trigger"
        icon="Zap"
        onOpenSheet={() => setSheetOpen(true)}
        actions={menuItems}
        errors={issues}
      />
      <ItemSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={title}
        description="Trigger"
      >
        {selected && (
          // Read-only context for the configured trigger — the event/kind is
          // chosen up front in the Add dialog, so it isn't editable here.
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {selected.ownerPluginId}
            </Badge>
            {selected.description}
          </div>
        )}
        {selected?.configSchema && (
          <div className="space-y-1">
            <Label className="text-xs">Trigger configuration</Label>
            <DynamicForm
              schema={selected.configSchema}
              value={value.config ?? {}}
              onChange={(next) => onChange({ ...value, config: next })}
            />
          </div>
        )}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
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
                  // Never leave the id blank: re-fill a unique default
                  // so the trigger stays referenceable as `trigger.id`
                  // and is distinguishable from sibling triggers.
                  if (value.id) return;
                  onChange({
                    ...value,
                    id: defaultTriggerId(value, siblingIds),
                  });
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
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Toggle
                checked={value.for !== undefined}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    for: checked ? { minutes: 30 } : undefined,
                  })
                }
                disabled={disabled}
              />
              <Label className="text-xs">
                Dwell: fire only if the matched state still holds after
              </Label>
            </div>
            {value.for !== undefined && (
              <DurationInput
                value={value.for as DurationValue}
                onChange={(next) =>
                  onChange({
                    ...value,
                    for: (next as Duration) ?? undefined,
                  })
                }
                disabled={disabled}
              />
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Toggle
                checked={value.window !== undefined}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    window: checked
                      ? { count: 3, minutes: 60, refire: "every" }
                      : undefined,
                  })
                }
                disabled={disabled}
              />
              <Label className="text-xs">
                Rate: fire only after N occurrences within a window
              </Label>
            </div>
            {value.window !== undefined && (
              <WindowInput
                value={value.window}
                onChange={(next) => onChange({ ...value, window: next })}
                completionProvider={expressionCompletion}
                variableNodes={variableNodes}
                contextKeyLabel={selected?.contextKeyLabel}
                disabled={disabled}
              />
            )}
          </div>
        </div>
      </ItemSheet>
    </>
  );
};

/**
 * Editor for a trigger's windowed-count / rate gate. Count + minutes number
 * inputs, a re-fire mode select, and an optional "Partition by" expression
 * that overrides the dimension the count is bucketed by. Matches the
 * surrounding compact editor style.
 */
const WindowInput: React.FC<{
  value: Window;
  onChange: (next: Window) => void;
  /**
   * BARE-expression completion provider (`expressionCompletion` from
   * `useVariableScope`) — `partitionBy` is evaluated like a condition (no
   * `{{ }}` wrapper), so it uses the same provider the condition expression
   * field does, NOT the template provider used for `{{ }}` fields.
   */
  completionProvider: TemplateCompletionProvider;
  /** Hierarchical scope for the "fx" VariablePicker insert affordance. */
  variableNodes: VariableNode[];
  /** Built-in partition dimension label (e.g. "system"); undefined ⇒ per automation. */
  contextKeyLabel?: string;
  disabled?: boolean;
}> = ({
  value,
  onChange,
  completionProvider,
  variableNodes,
  contextKeyLabel,
  disabled,
}) => {
  const defaultPartition = contextKeyLabel
    ? `per ${contextKeyLabel}`
    : "per automation";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Count</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={value.count}
            onChange={(e) => {
              const count = Number.parseInt(e.target.value, 10);
              onChange({ ...value, count: Number.isFinite(count) ? count : 1 });
            }}
            disabled={disabled}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Within (minutes)</Label>
          <Input
            type="number"
            min={1}
            max={1440}
            value={value.minutes}
            onChange={(e) => {
              const minutes = Number.parseInt(e.target.value, 10);
              onChange({
                ...value,
                minutes: Number.isFinite(minutes) ? minutes : 1,
              });
            }}
            disabled={disabled}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Re-fire</Label>
          <Select
            value={value.refire}
            onValueChange={(next) =>
              onChange({ ...value, refire: next === "once" ? "once" : "every" })
            }
            disabled={disabled}
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="every">every occurrence</SelectItem>
              <SelectItem value="once">once (crossing edge)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Partition by</Label>
          {!disabled && (
            <VariablePicker
              scope={variableNodes}
              onSelect={(path) => {
                // partitionBy is a bare expression — insert the raw path, not
                // a `{{ … }}`-wrapped reference (matches the condition editor).
                const before = value.partitionBy ?? "";
                const sep =
                  before.length > 0 && !before.endsWith(" ") ? " " : "";
                onChange({ ...value, partitionBy: `${before}${sep}${path}` });
              }}
            />
          )}
        </div>
        <TemplateValueInput
          value={value.partitionBy ?? ""}
          onChange={(next) =>
            // Store the RAW value (don't `.trim()` on change): trimming strips
            // the trailing space the user must type to reach the operator
            // stage, swallowing it mid-type. Only a blank / whitespace-only
            // value clears the field. The gate trims when it evaluates.
            onChange({
              ...value,
              partitionBy: next.trim() === "" ? undefined : next,
            })
          }
          placeholder={`Leave blank to count ${defaultPartition}`}
          completionProvider={completionProvider}
          disabled={disabled}
        />
        <p className="text-muted-foreground text-xs">
          Bare expression (no <code>{"{{ }}"}</code>) for the key the count is
          bucketed by. Blank counts {defaultPartition}.
        </p>
      </div>
    </div>
  );
};
