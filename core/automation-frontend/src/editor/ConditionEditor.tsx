import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  DurationInput,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  TemplateValueInput,
  TimeOfDayInput,
  Toggle,
  VariablePicker,
  type DurationValue,
  type TemplateCompletionProvider,
  type VariableNode,
} from "@checkstack/ui";
import type {
  ConditionInput,
  Duration,
  NumericStateCondition,
  StateCondition,
  TimeCondition,
} from "@checkstack/automation-common";
import {
  defaultForKind,
  kindOf,
  type ConditionKind,
} from "./condition-kind";
import { SystemEntityPicker } from "./SystemEntityPicker";

export interface ConditionEditorProps {
  value: ConditionInput;
  onChange: (next: ConditionInput) => void;
  variableNodes: VariableNode[];
  /**
   * Staged completion provider (expression mode) for the inline
   * expression input. Conditions are bare expressions - no `{{ }}`
   * wrapper - so this is the `expressionCompletion` from
   * `useVariableScope`. The hierarchical `variableNodes` powers the
   * explicit "fx" picker.
   */
  completionProvider: TemplateCompletionProvider;
  /** Render without the wrapping card - used when inlining inside an action card. */
  bare?: boolean;
  /**
   * Suppress the inline kind `Select`. Used only for the top-level condition in
   * the Conditions-section sheet, where the kind is chosen up front via
   * `AddConditionDialog` (swap kind = delete + re-add, matching actions).
   * Nested combinator children and the action `condition`-guard body do NOT
   * set this, so their inline selector stays. The `expr` "fx" picker still
   * renders when the kind is `expr`, even with the selector hidden.
   */
  hideKindSelector?: boolean;
  depth?: number;
}

/**
 * Recursive editor over the `ConditionInput` union. Each level renders a
 * kind selector plus the matching body:
 *
 *   - expression  - TemplateValueInput + the VariablePicker "fx" trigger.
 *   - and / or     - list of child conditions (recursive).
 *   - not          - single child condition.
 *   - numeric_state - value (path/template) + operator + threshold.
 *   - time          - after / before (TimeOfDayInput) + weekday + timezone.
 *   - state         - entity + status + optional dwell (DurationInput).
 *
 * The raw expression stays the escape hatch for anything the structured
 * variants don't cover. No depth cap - operator can nest arbitrarily.
 */
export const ConditionEditor: React.FC<ConditionEditorProps> = ({
  value,
  onChange,
  variableNodes,
  completionProvider,
  bare,
  hideKindSelector,
  depth = 0,
}) => {
  const kind = kindOf(value);

  const body = (
    <div className="space-y-2">
      {/* The top row holds the kind selector and the `expr` "fx" picker. Render
          it when EITHER is present; omit it entirely (e.g. hidden selector on a
          non-expr top-level condition) so no empty row remains. */}
      {(!hideKindSelector || kind === "expr") && (
        <div className="flex items-center gap-2">
          {!hideKindSelector && (
            <Select
              value={kind}
              onValueChange={(next) =>
                onChange(defaultForKind(next as ConditionKind))
              }
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Structured kinds are the common case and lead the list. */}
                <SelectGroup>
                  <SelectLabel>Structured</SelectLabel>
                  <SelectItem value="numeric_state">numeric state</SelectItem>
                  <SelectItem value="time">time of day</SelectItem>
                  <SelectItem value="state">system state</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Logical</SelectLabel>
                  <SelectItem value="and">and</SelectItem>
                  <SelectItem value="or">or</SelectItem>
                  <SelectItem value="not">not</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                {/* Raw expression stays the escape hatch for anything the
                    structured variants don't cover — de-emphasised at the
                    bottom, but still reachable. */}
                <SelectGroup>
                  <SelectLabel>Advanced</SelectLabel>
                  <SelectItem value="expr">expression</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {kind === "expr" && (
            <VariablePicker
              scope={variableNodes}
              onSelect={(path) => {
                // Conditions are bare expressions - insert the raw path,
                // not a `{{ … }}`-wrapped reference.
                const before = typeof value === "string" ? value : "";
                const sep =
                  before.length > 0 && !before.endsWith(" ") ? " " : "";
                onChange(`${before}${sep}${path}`);
              }}
            />
          )}
        </div>
      )}

      {kind === "expr" && (
        <TemplateValueInput
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(next)}
          placeholder="trigger.payload.severity == &quot;high&quot;"
          mode="expression"
          completionProvider={completionProvider}
        />
      )}

      {kind === "numeric_state" && (
        <NumericStateBody
          value={value as NumericStateCondition}
          onChange={onChange}
          variableNodes={variableNodes}
          completionProvider={completionProvider}
        />
      )}

      {kind === "time" && (
        <TimeBody value={value as TimeCondition} onChange={onChange} />
      )}

      {kind === "state" && (
        <StateBody value={value as StateCondition} onChange={onChange} />
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

// ─── numeric_state ─────────────────────────────────────────────────────

type NumericOp = "above" | "below" | "between";

function numericOpOf(c: NumericStateCondition["numeric_state"]): NumericOp {
  if (c.above !== undefined && c.below !== undefined) return "between";
  if (c.below !== undefined) return "below";
  return "above";
}

const NumericStateBody: React.FC<{
  value: NumericStateCondition;
  onChange: (next: ConditionInput) => void;
  variableNodes: VariableNode[];
  completionProvider: TemplateCompletionProvider;
}> = ({ value, onChange, variableNodes, completionProvider }) => {
  const ns = value.numeric_state;
  const op = numericOpOf(ns);
  const patch = (next: Partial<NumericStateCondition["numeric_state"]>) =>
    onChange({ numeric_state: { ...ns, ...next } });

  return (
    <div className="space-y-2 border-l border-border pl-3">
      <div className="space-y-1">
        <Label className="text-xs">Value (path or template)</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <TemplateValueInput
              value={typeof ns.value === "string" ? ns.value : String(ns.value)}
              onChange={(next) => patch({ value: next })}
              placeholder="health.system.p95_latency_ms"
              mode="expression"
              completionProvider={completionProvider}
            />
          </div>
          <VariablePicker
            scope={variableNodes}
            onSelect={(path) => patch({ value: path })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={op}
          onValueChange={(next) => {
            // Reset to a clean shape for the chosen operator.
            if (next === "above") {
              patch({ above: ns.above ?? 0, below: undefined });
            } else if (next === "below") {
              patch({ above: undefined, below: ns.below ?? 0 });
            } else {
              patch({ above: ns.above ?? 0, below: ns.below ?? 0 });
            }
          }}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="above">above (&gt;)</SelectItem>
            <SelectItem value="below">below (&lt;)</SelectItem>
            <SelectItem value="between">between</SelectItem>
          </SelectContent>
        </Select>
        {op !== "below" && (
          <Input
            type="number"
            className="w-28"
            placeholder="above"
            value={ns.above ?? ""}
            onChange={(event) =>
              patch({
                above:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        )}
        {op !== "above" && (
          <Input
            type="number"
            className="w-28"
            placeholder="below"
            value={ns.below ?? ""}
            onChange={(event) =>
              patch({
                below:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        )}
      </div>
    </div>
  );
};

// ─── time ──────────────────────────────────────────────────────────────

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const TimeBody: React.FC<{
  value: TimeCondition;
  onChange: (next: ConditionInput) => void;
}> = ({ value, onChange }) => {
  const t = value.time;
  const patch = (next: Partial<TimeCondition["time"]>) =>
    onChange({ time: { ...t, ...next } });
  const weekdays = t.weekday ?? [];

  const toggleDay = (day: number) => {
    const next = weekdays.includes(day)
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].toSorted((a, b) => a - b);
    patch({ weekday: next.length > 0 ? next : undefined });
  };

  return (
    <div className="space-y-3 border-l border-border pl-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">After</Label>
          <TimeOfDayInput
            value={t.after}
            onChange={(next) => patch({ after: next })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Before</Label>
          <TimeOfDayInput
            value={t.before}
            onChange={(next) => patch({ before: next })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Weekdays (any when none selected)</Label>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((d) => {
            const active = weekdays.includes(d.value);
            return (
              <Button
                key={d.value}
                type="button"
                variant={active ? "primary" : "outline"}
                size="sm"
                className="h-7 w-11 text-xs"
                onClick={() => toggleDay(d.value)}
                aria-pressed={active}
              >
                {d.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Timezone (IANA, defaults to UTC)</Label>
        <Input
          className="max-w-xs font-mono text-xs"
          value={t.timezone ?? ""}
          placeholder="Europe/Berlin"
          onChange={(event) =>
            patch({ timezone: event.target.value || undefined })
          }
        />
      </div>
    </div>
  );
};

// ─── state ─────────────────────────────────────────────────────────────

const StateBody: React.FC<{
  value: StateCondition;
  onChange: (next: ConditionInput) => void;
}> = ({ value, onChange }) => {
  const s = value.state;
  const patch = (next: Partial<StateCondition["state"]>) =>
    onChange({ state: { ...s, ...next } });
  const hasDwell = s.for !== undefined;

  return (
    <div className="space-y-2 border-l border-border pl-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">System (entity)</Label>
          <SystemEntityPicker
            value={s.entity}
            onChange={(next) => patch({ entity: next })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select
            value={s.status}
            onValueChange={(next) =>
              patch({ status: next as StateCondition["state"]["status"] })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="healthy">healthy</SelectItem>
              <SelectItem value="degraded">degraded</SelectItem>
              <SelectItem value="unhealthy">unhealthy</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Toggle
          checked={hasDwell}
          onCheckedChange={(checked) =>
            patch({ for: checked ? { minutes: 30 } : undefined })
          }
        />
        <Label className="text-xs">Require held for a minimum duration</Label>
      </div>
      {hasDwell && (
        <DurationInput
          value={s.for as DurationValue | undefined}
          onChange={(next) => patch({ for: (next as Duration) ?? undefined })}
        />
      )}
    </div>
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
