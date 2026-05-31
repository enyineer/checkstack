import React from "react";
import { DynamicIcon } from "@checkstack/ui";
import {
  CONDITION_KIND_META,
  type ConditionKind,
  type ConditionKindGroup,
} from "./condition-kind";
import { PickerDialogShell, PickerRow } from "./picker-dialog";

export interface AddConditionDialogProps {
  /** Append a condition of the picked kind (seeded via `defaultForKind`). */
  onAdd: (kind: ConditionKind) => void;
  disabled?: boolean;
}

/** Picker group order — structured first (common case), advanced last. */
const GROUP_ORDER: ConditionKindGroup[] = ["Structured", "Logical", "Advanced"];

const ALL_KINDS = Object.values(CONDITION_KIND_META);

/**
 * Home-Assistant-style condition type picker. The operator picks the condition
 * kind up front (grouped by `CONDITION_KIND_META.group`, searchable on label /
 * description); on pick the consumer (`ConditionsEditor`) appends a seeded
 * default for that kind. Mirrors the Actions "Add step" picker but is
 * single-list.
 */
export const AddConditionDialog: React.FC<AddConditionDialogProps> = ({
  onAdd,
  disabled,
}) => (
  <PickerDialogShell
    addLabel="Add condition"
    title="Add condition"
    searchPlaceholder="Search conditions…"
    disabled={disabled}
  >
    {({ query, close }) => {
      const filtered = query
        ? ALL_KINDS.filter(
            (meta) =>
              meta.label.toLowerCase().includes(query) ||
              meta.description.toLowerCase().includes(query) ||
              meta.kind.toLowerCase().includes(query),
          )
        : ALL_KINDS;

      const grouped = GROUP_ORDER.map((group) => ({
        group,
        items: filtered.filter((meta) => meta.group === group),
      })).filter(({ items }) => items.length > 0);

      if (grouped.length === 0) {
        return (
          <p className="px-1 py-6 text-center text-xs italic text-muted-foreground">
            No matching conditions.
          </p>
        );
      }

      return (
        <div className="space-y-3">
          {grouped.map(({ group, items }) => (
            <div key={group} className="space-y-1">
              <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              {items.map((meta) => (
                <PickerRow
                  key={meta.kind}
                  icon={<DynamicIcon name={meta.icon} className="h-4 w-4" />}
                  title={meta.label}
                  description={meta.description}
                  onClick={() => {
                    onAdd(meta.kind);
                    close();
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      );
    }}
  </PickerDialogShell>
);
